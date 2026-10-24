'use strict';

/**
 * @fileoverview Settlement state machine for one fill of an L1/L2 liquidity
 * order (`functions/liquiditySwap`, `types/liquidityBook`). Each side runs its
 * own `LiquiditySwap`; they exchange the signed `LiquidityTake`,
 * `LiquidityTakeAccept`, and `LiquiditySwapFunded` bodies over any transport
 * (Fabric `CONTRACT_MESSAGE` in practice).
 *
 * The party giving L1 owns the preimage: it issues a BOLT11 invoice locked to
 * `H = SHA256(P)` and funds the Taproot HTLC (claim: `H` + L2 giver; refund:
 * CLTV + L1 giver). The L2 giver pays only once the HTLC is confirmed and its
 * address, amount, and invoice check out; paying reveals `P`, which claims
 * the HTLC.
 *
 * States: `new → proposed → accepted → prepaid? → l1Funded → l2Paid →
 * l1Claimed`, or `refunded` / `aborted`. Chain and Lightning access go
 * through adapters (see {@link LiquiditySwap.bitcoinAdapter} and
 * {@link LiquiditySwap.lightningAdapter}) so the machine runs without daemons
 * in tests.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const bitcoin = require('bitcoinjs-lib');
const swap = require('../functions/liquiditySwap');
const inventoryHtlc = require('../functions/inventoryHtlc');

const STATES = Object.freeze({
  NEW: 'new',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  PREPAID: 'prepaid',
  L1_FUNDED: 'l1Funded',
  L2_PAID: 'l2Paid',
  L1_CLAIMED: 'l1Claimed',
  REFUNDED: 'refunded',
  ABORTED: 'aborted'
});

const TRANSITIONS = Object.freeze({
  new: ['proposed', 'accepted', 'aborted'],
  proposed: ['accepted', 'aborted'],
  accepted: ['prepaid', 'l1Funded', 'aborted'],
  prepaid: ['l1Funded', 'aborted'],
  l1Funded: ['l2Paid', 'l1Claimed', 'refunded'],
  l2Paid: ['l1Claimed'],
  l1Claimed: [],
  refunded: [],
  aborted: []
});

/**
 * Blocks a refund lock the taker chose may exceed the order's (propagation slack).
 * @private
 */
const LOCK_SLACK_BLOCKS = 2;
const DEFAULT_INVOICE_EXPIRY_SECONDS = 3600;
const MIN_INVOICE_EXPIRY_SECONDS = swap.MIN_INVOICE_EXPIRY_SECONDS;

/** @private */
function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** @private */
function privBuffer (value, label) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'hex');
  if (buf.length !== 32) throw new Error(`LiquiditySwap: ${label} must be a 32-byte private key`);
  return buf;
}

class LiquiditySwap extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Object} settings.order signed `LiquidityOrder` body
   * @param {string} settings.role `maker` or `taker`
   * @param {Buffer|string} settings.identityKey private key that signs this side's bodies (maker: the order's `makerPubkey`)
   * @param {Buffer|string} settings.htlcKey private key for this side's HTLC leaf
   * @param {string} [settings.lightningNodeId] this side's node id (required for takers)
   * @param {Object} settings.adapters `{ bitcoin, lightning }`
   * @param {number} [settings.secondsPerBlock=600]
   * @param {number} [settings.marginSeconds=3600] invoice must expire this long before the refund lock opens
   * @param {number} [settings.minClaimBlocks=6]
   * @param {number} [settings.minConfirmations=1] HTLC confirmations before the L2 giver pays
   * @param {number} [settings.invoiceExpirySeconds=3600] upper bound on the swap invoice's expiry
   * @param {Function} [settings.now] clock in ms (tests)
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      secondsPerBlock: swap.DEFAULT_SECONDS_PER_BLOCK,
      marginSeconds: swap.DEFAULT_INVOICE_MARGIN_SECONDS,
      minClaimBlocks: swap.DEFAULT_MIN_CLAIM_BLOCKS,
      minConfirmations: swap.DEFAULT_MIN_CONFIRMATIONS,
      invoiceExpirySeconds: DEFAULT_INVOICE_EXPIRY_SECONDS,
      now: () => Date.now()
    }, settings);

    const verified = swap.verifyBody(settings.order);
    if (!verified.ok || verified.body.type !== swap.BODY_TYPES.ORDER) {
      throw new Error(`LiquiditySwap: invalid order (${verified.reason || 'not a LiquidityOrder'})`);
    }
    if (!['maker', 'taker'].includes(settings.role)) throw new Error('LiquiditySwap: role must be "maker" or "taker"');
    const adapters = settings.adapters || {};
    if (!adapters.bitcoin || !adapters.lightning) throw new Error('LiquiditySwap: adapters.bitcoin and adapters.lightning are required');

    this.order = verified.body;
    this.orderId = verified.id;
    this.isMaker = settings.role === 'maker';
    this.role = swap.roleFor({ side: this.order.side, isMaker: this.isMaker });
    this.adapters = adapters;
    this._identityKey = privBuffer(settings.identityKey, 'identityKey');
    this._htlcKey = privBuffer(settings.htlcKey, 'htlcKey');
    this.identityPubkey = swap.pubkeyFromPrivate(this._identityKey);
    this.htlcPubkey = swap.pubkeyFromPrivate(this._htlcKey);
    if (this.isMaker && this.identityPubkey !== this.order.makerPubkey) {
      throw new Error('LiquiditySwap: maker identityKey does not match the order');
    }
    this.lightningNodeId = settings.lightningNodeId || (this.isMaker ? this.order.lightningNodeId : null);

    this._state = {
      status: STATES.NEW,
      take: null,
      takeId: null,
      accept: null,
      funded: null,
      quote: null,
      terms: null,
      escrow: null,
      preimageHex: null,
      prepayPaymentHash: null,
      fundingStartedAt: null,
      fundingTxid: null,
      fundingTxHex: null,
      claimTxid: null,
      refundTxid: null,
      history: []
    };
    this._funding = false;
  }

  static get STATES () { return STATES; }
  static get TRANSITIONS () { return TRANSITIONS; }

  /** @returns {string} current state */
  get status () { return this._state.status; }
  /** @returns {boolean} */
  get isL1Giver () { return this.role === 'l1Giver'; }
  /** @returns {Object|null} */
  get take () { return this._state.take; }
  /** @returns {string|null} */
  get takeId () { return this._state.takeId; }
  /** @returns {Object|null} */
  get accept () { return this._state.accept; }
  /** @returns {Object|null} */
  get funded () { return this._state.funded; }
  /** @returns {Object|null} amounts for this fill */
  get quote () { return this._state.quote; }
  /** @returns {Object|null} L1 giver's `{ paymentHashHex, invoice, refundLockHeight, prepayInvoice? }` */
  get terms () { return this._state.terms; }
  /** @returns {Object|null} swap HTLC (`buildSwapEscrow`) */
  get escrow () { return this._state.escrow; }

  /** @private */
  _transition (to, detail = {}) {
    const from = this._state.status;
    if (!TRANSITIONS[from].includes(to)) throw new Error(`LiquiditySwap: cannot move from ${from} to ${to}`);
    this._state.status = to;
    this._state.history.push(Object.assign({ from, to, at: this.settings.now() }, detail));
    this.emit('debug', `[LIQUIDITY:SWAP] ${this.takeId || this.orderId} ${from} → ${to}`);
    this.emit('state', { from, to, swap: this });
  }

  /** @private */
  _expect (statuses, role) {
    if (!statuses.includes(this._state.status)) {
      throw new Error(`LiquiditySwap: expected state ${statuses.join(' | ')}, got ${this._state.status}`);
    }
    if (role && this.role !== role) throw new Error(`LiquiditySwap: only the ${role} may do this`);
  }

  /** @private */
  _fail (message) {
    const err = new Error(`LiquiditySwap: ${message}`);
    if (this.listenerCount('error') > 0) this.emit('error', err);
    return err;
  }

  /**
   * Counterparty identity key.
   * @private
   */
  get _counterpartyPubkey () {
    return this.isMaker ? (this._state.take && this._state.take.takerPubkey) : this.order.makerPubkey;
  }

  /**
   * Counterparty HTLC key.
   * @private
   */
  get _counterpartyHtlcPubkey () {
    if (this.isMaker) return this._state.take ? this._state.take.takerHtlcPubkey : null;
    return this._state.accept ? this._state.accept.makerHtlcPubkey : null;
  }

  /**
   * Counterparty Lightning node.
   * @private
   */
  get _counterpartyNodeId () {
    return this.isMaker ? (this._state.take && this._state.take.takerNodeId) : this.order.lightningNodeId;
  }

  /** @private */
  _invoiceExpirySeconds () {
    const blocks = this.order.refundLockBlocks - this.settings.minClaimBlocks - this.settings.minConfirmations - 1;
    const fit = Math.floor((blocks * this.settings.secondsPerBlock) - this.settings.marginSeconds);
    const expiry = Math.min(this.settings.invoiceExpirySeconds, fit);
    if (expiry < MIN_INVOICE_EXPIRY_SECONDS) throw this._fail('refund lock too short for a safe invoice expiry');
    return expiry;
  }

  /**
   * Preimage, invoice, and refund lock for the L1 giver.
   * @private
   */
  async _issueL1GiverTerms (label) {
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    const preimage = inventoryHtlc.randomPreimage32();
    const paymentHashHex = sha256Hex(preimage);
    const invoice = await this.adapters.lightning.createInvoice({
      amountMsat: this._state.quote.l2Msat,
      label,
      description: `Fabric L1/L2 swap ${this._state.quote.amountSats} sats`,
      preimageHex: preimage.toString('hex'),
      expirySeconds: this._invoiceExpirySeconds()
    });
    if (String(invoice.paymentHash || '').toLowerCase() !== paymentHashHex) {
      throw this._fail('Lightning node did not lock the invoice to the swap preimage');
    }
    this._state.preimageHex = preimage.toString('hex');
    return {
      paymentHashHex,
      invoice: invoice.bolt11,
      refundLockHeight: tip + this.order.refundLockBlocks
    };
  }

  /**
   * Check the L1 giver's terms as the L2 giver: refund lock in range and an
   * invoice that is safe to pay later.
   * @private
   */
  async _checkL1GiverTerms (terms) {
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    const blocksLeft = terms.refundLockHeight - tip;
    if (blocksLeft > this.order.refundLockBlocks + LOCK_SLACK_BLOCKS) throw this._fail('refund lock longer than the order allows');
    await this._checkInvoice(terms, tip);
  }

  /** @private */
  async _checkInvoice (terms, tip) {
    const decoded = await this.adapters.lightning.decodeInvoice(terms.invoice);
    const v = swap.validateSwapInvoice({
      decoded,
      paymentHashHex: terms.paymentHashHex,
      expectedMsat: this._state.quote.l2Msat,
      payee: this._counterpartyNodeId,
      refundLockHeight: terms.refundLockHeight,
      tipHeight: tip,
      nowSeconds: Math.floor(this.settings.now() / 1000),
      secondsPerBlock: this.settings.secondsPerBlock,
      marginSeconds: this.settings.marginSeconds,
      minClaimBlocks: this.settings.minClaimBlocks
    });
    if (!v.ok) throw this._fail(v.reason);
  }

  /**
   * Taker: propose filling `amountSats` of the order.
   * @param {Object} opts
   * @param {number} opts.amountSats
   * @returns {Promise<Object>} signed `LiquidityTake` body to send to the maker
   */
  async createTake ({ amountSats }) {
    if (this.isMaker) throw new Error('LiquiditySwap: only the taker creates a take');
    this._expect([STATES.NEW]);
    if (!this.lightningNodeId) throw new Error('LiquiditySwap: taker needs lightningNodeId');
    this._state.quote = swap.quote({ side: this.order.side, premiumPpm: this.order.premiumPpm, feeSats: this.order.feeSats, amountSats });
    const nonce = swap.randomNonce();
    const fields = {
      type: swap.BODY_TYPES.TAKE,
      orderId: this.orderId,
      side: this.order.side,
      premiumPpm: this.order.premiumPpm,
      amountSats: this._state.quote.amountSats,
      takerPubkey: this.identityPubkey,
      takerHtlcPubkey: this.htlcPubkey,
      takerNodeId: this.lightningNodeId,
      createdAt: this.settings.now(),
      nonce
    };
    if (this.isL1Giver) Object.assign(fields, await this._issueL1GiverTerms(`liquidity-swap:${this.orderId}:${nonce}`));
    const take = swap.signBody(fields, this._identityKey);
    const v = swap.validateTake(this.order, take, { now: this.settings.now() });
    if (!v.ok) throw this._fail(v.reason);
    this._state.take = take;
    this._state.takeId = swap.bodyId(take);
    if (this.isL1Giver) this._state.terms = swap.l1GiverTerms(this.order, take, null);
    this._transition(STATES.PROPOSED);
    return take;
  }

  /**
   * Maker: accept a taker's signed take.
   * @param {Object} takeBody
   * @returns {Promise<Object>} signed `LiquidityTakeAccept` body to send back
   */
  async acceptTake (takeBody) {
    if (!this.isMaker) throw new Error('LiquiditySwap: only the maker accepts a take');
    this._expect([STATES.NEW]);
    const verified = swap.verifyBody(takeBody);
    if (!verified.ok || verified.body.type !== swap.BODY_TYPES.TAKE) throw this._fail(`invalid take (${verified.reason || 'wrong type'})`);
    const take = verified.body;
    const v = swap.validateTake(this.order, take, { now: this.settings.now() });
    if (!v.ok) throw this._fail(v.reason);
    this._state.take = take;
    this._state.takeId = verified.id;
    this._state.quote = swap.quote({ side: this.order.side, premiumPpm: this.order.premiumPpm, feeSats: this.order.feeSats, amountSats: take.amountSats });

    const fields = {
      type: swap.BODY_TYPES.TAKE_ACCEPT,
      orderId: this.orderId,
      takeId: verified.id,
      makerPubkey: this.identityPubkey,
      makerHtlcPubkey: this.htlcPubkey,
      createdAt: this.settings.now()
    };
    if (this.isL1Giver) {
      Object.assign(fields, await this._issueL1GiverTerms(`liquidity-swap:${verified.id}`));
      if (this.order.prepaySats > 0) {
        const prepay = await this.adapters.lightning.createInvoice({
          amountMsat: this.order.prepaySats * 1000,
          label: `liquidity-swap-prepay:${verified.id}`,
          description: 'Fabric L1/L2 swap prepay (non-refundable)',
          expirySeconds: this._invoiceExpirySeconds()
        });
        fields.prepayInvoice = prepay.bolt11;
        this._state.prepayPaymentHash = String(prepay.paymentHash || '').toLowerCase();
      }
    } else {
      await this._checkL1GiverTerms(swap.l1GiverTerms(this.order, take, null));
    }
    const accept = swap.signBody(fields, this._identityKey);
    const ok = swap.validateTakeAccept(this.order, take, accept);
    if (!ok.ok) throw this._fail(ok.reason);
    this._state.accept = accept;
    this._state.terms = swap.l1GiverTerms(this.order, take, accept);
    this._transition(STATES.ACCEPTED);
    return accept;
  }

  /**
   * Taker: apply the maker's signed acceptance.
   * @param {Object} acceptBody
   * @returns {Promise<LiquiditySwap>}
   */
  async applyAccept (acceptBody) {
    if (this.isMaker) throw new Error('LiquiditySwap: only the taker applies an accept');
    this._expect([STATES.PROPOSED]);
    const verified = swap.verifyBody(acceptBody);
    if (!verified.ok || verified.body.type !== swap.BODY_TYPES.TAKE_ACCEPT) throw this._fail(`invalid accept (${verified.reason || 'wrong type'})`);
    const accept = verified.body;
    const v = swap.validateTakeAccept(this.order, this._state.take, accept);
    if (!v.ok) throw this._fail(v.reason);
    this._state.accept = accept;
    const terms = swap.l1GiverTerms(this.order, this._state.take, accept);
    if (!this.isL1Giver) {
      await this._checkL1GiverTerms(terms);
      if (terms.prepayInvoice) {
        const decoded = await this.adapters.lightning.decodeInvoice(terms.prepayInvoice);
        if (swap.invoiceAmountMsat(decoded) !== this.order.prepaySats * 1000) throw this._fail('prepay invoice amount does not match the order');
        if (String(decoded.payee || '').toLowerCase() !== this._counterpartyNodeId) throw this._fail('prepay invoice payee is not the maker node');
      }
    }
    this._state.terms = terms;
    this._transition(STATES.ACCEPTED);
    return this;
  }

  /**
   * L2 giver: pay the maker's prepay invoice (orders with `prepaySats`).
   * @returns {Promise<Object>} payment result
   */
  async prepay () {
    this._expect([STATES.ACCEPTED], 'l2Giver');
    if (!this._state.terms.prepayInvoice) throw new Error('LiquiditySwap: no prepay invoice');
    const result = await this.adapters.lightning.pay(this._state.terms.prepayInvoice);
    this._transition(STATES.PREPAID);
    return result;
  }

  /**
   * L1 giver: fund the HTLC. A maker that asked for a prepay funds only once
   * its node reports the prepay invoice paid. Funding happens at most once:
   * the escrow is recorded before the send, and once the send returns the
   * swap is `l1Funded` (refundable, no longer abortable) even if the funding
   * notice cannot be built — that error is thrown after the transition.
   * @returns {Promise<Object>} signed `LiquiditySwapFunded` body to send
   */
  async fund () {
    this._expect([STATES.ACCEPTED, STATES.PREPAID], 'l1Giver');
    if (this._funding || this._state.fundingStartedAt != null) throw this._fail('HTLC funding already started');
    this._funding = true;
    try {
      return await this._fund();
    } finally {
      this._funding = false;
    }
  }

  /** @private */
  async _fund () {
    if (this._state.prepayPaymentHash && this._state.status === STATES.ACCEPTED) {
      const paid = await this.adapters.lightning.isInvoicePaid(this._state.prepayPaymentHash);
      if (!paid) throw this._fail('prepay not received yet');
      this._transition(STATES.PREPAID);
    }
    const terms = this._state.terms;
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    if (terms.refundLockHeight - tip < this.settings.minClaimBlocks + this.settings.minConfirmations) {
      throw this._fail('refund lock too close to fund safely');
    }
    const escrow = swap.buildSwapEscrow({
      networkName: this.order.network,
      l2GiverPubkeyHex: this._counterpartyHtlcPubkey,
      l1GiverPubkeyHex: this.htlcPubkey,
      paymentHashHex: terms.paymentHashHex,
      refundLockHeight: terms.refundLockHeight,
      amountSats: this._state.quote.l1Sats
    });
    this._state.escrow = escrow;
    this._state.fundingStartedAt = this.settings.now();
    let sent;
    try {
      sent = await this.adapters.bitcoin.fundAddress(escrow.paymentAddress, escrow.amountSats);
    } catch (err) {
      // Adapters reject only when nothing was sent, so funding may be retried.
      this._state.fundingStartedAt = null;
      throw err;
    }
    const txid = (sent && sent.txid) || null;
    const txHex = (sent && sent.txHex) || null;
    this._state.fundingTxid = txid;
    this._state.fundingTxHex = txHex;

    let funded = null;
    let problem = null;
    try {
      let vout = sent && sent.vout;
      if (txHex) {
        const tx = bitcoin.Transaction.fromHex(txHex);
        vout = inventoryHtlc.findP2trVoutForAddress(tx, escrow.paymentAddress, inventoryHtlc.networkForFabricName(this.order.network));
      }
      if (!Number.isInteger(vout) || vout < 0) throw new Error('funding transaction has no HTLC output');
      funded = swap.signBody({
        type: swap.BODY_TYPES.FUNDED,
        takeId: this._state.takeId,
        l1GiverPubkey: this.identityPubkey,
        txid,
        vout,
        paymentAddress: escrow.paymentAddress,
        amountSats: escrow.amountSats,
        createdAt: this.settings.now()
      }, this._identityKey);
    } catch (err) {
      problem = err;
    }
    this._state.funded = funded;
    this._transition(STATES.L1_FUNDED, { txid });
    if (problem) {
      throw this._fail(`HTLC funded but no funding notice (${problem.message}); refund after height ${terms.refundLockHeight}`);
    }
    return funded;
  }

  /**
   * L2 giver: check the L1 giver's funding notice against the chain. Returns
   * `{ ok: false, pending: true }` until the HTLC has `minConfirmations`
   * (call again later); throws when the funding is wrong.
   * @param {Object} fundedBody
   * @returns {Promise<{ ok: boolean, pending: (boolean|undefined), confirmations: number }>}
   */
  async applyFunded (fundedBody) {
    this._expect([STATES.ACCEPTED, STATES.PREPAID], 'l2Giver');
    const verified = swap.verifyBody(fundedBody);
    if (!verified.ok || verified.body.type !== swap.BODY_TYPES.FUNDED) throw this._fail(`invalid funding notice (${verified.reason || 'wrong type'})`);
    const funded = verified.body;
    if (funded.takeId !== this._state.takeId) throw this._fail('funding notice names another take');
    if (funded.l1GiverPubkey !== this._counterpartyPubkey) throw this._fail('funding notice is not from the counterparty');
    if (funded.amountSats !== this._state.quote.l1Sats) throw this._fail('funded amount does not match the take');
    const terms = this._state.terms;
    const check = swap.validateSwapEscrow({
      networkName: this.order.network,
      l2GiverPubkeyHex: this.htlcPubkey,
      l1GiverPubkeyHex: this._counterpartyHtlcPubkey,
      paymentHashHex: terms.paymentHashHex,
      refundLockHeight: terms.refundLockHeight,
      amountSats: this._state.quote.l1Sats,
      paymentAddress: funded.paymentAddress
    });
    if (!check.ok) throw this._fail(check.reason);

    const tx = await this.adapters.bitcoin.getTransaction(funded.txid);
    if (!tx || !tx.txHex) return { ok: false, pending: true, confirmations: 0 };
    const parsed = bitcoin.Transaction.fromHex(tx.txHex);
    if (parsed.getId() !== funded.txid) throw this._fail('funding transaction id mismatch');
    const vout = inventoryHtlc.findP2trVoutForAddress(parsed, check.escrow.paymentAddress, inventoryHtlc.networkForFabricName(this.order.network));
    if (vout !== funded.vout) throw this._fail('funding output is not at the advertised vout');
    if (Number(parsed.outs[vout].value) < funded.amountSats) throw this._fail('HTLC output is smaller than the take');
    const confirmations = Number(tx.confirmations) || 0;
    if (confirmations < this.settings.minConfirmations) return { ok: false, pending: true, confirmations };

    await this._checkInvoice(terms, Number(await this.adapters.bitcoin.getTipHeight()));
    this._state.escrow = check.escrow;
    this._state.funded = funded;
    this._state.fundingTxid = funded.txid;
    this._state.fundingTxHex = tx.txHex;
    this._transition(STATES.L1_FUNDED, { txid: funded.txid });
    return { ok: true, confirmations };
  }

  /**
   * L2 giver: pay the swap invoice and keep the revealed preimage.
   * @returns {Promise<string>} preimage hex
   */
  async payInvoice () {
    this._expect([STATES.L1_FUNDED], 'l2Giver');
    const terms = this._state.terms;
    await this._checkInvoice(terms, Number(await this.adapters.bitcoin.getTipHeight()));
    const result = await this.adapters.lightning.pay(terms.invoice);
    const preimageHex = String((result && result.paymentPreimage) || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(preimageHex) || sha256Hex(Buffer.from(preimageHex, 'hex')) !== terms.paymentHashHex) {
      throw this._fail('payment did not reveal the swap preimage');
    }
    this._state.preimageHex = preimageHex;
    this._transition(STATES.L2_PAID);
    return preimageHex;
  }

  /**
   * L2 giver: claim the HTLC with the preimage.
   * @param {Object} [opts]
   * @param {string} [opts.destinationAddress] defaults to `bitcoin.getNewAddress()`
   * @param {number} [opts.feeSats=1000]
   * @returns {Promise<string>} claim txid
   */
  async claim (opts = {}) {
    this._expect([STATES.L2_PAID], 'l2Giver');
    const escrow = this._state.escrow;
    const destinationAddress = opts.destinationAddress || await this.adapters.bitcoin.getNewAddress();
    const bundle = inventoryHtlc.prepareInventoryHtlcSellerClaimPsbt({
      networkName: this.order.network,
      fundedTxHex: this._state.fundingTxHex,
      paymentAddress: escrow.paymentAddress,
      claimScript: escrow.claimScriptHex,
      refundScript: escrow.refundScriptHex,
      preimage32: Buffer.from(this._state.preimageHex, 'hex'),
      destinationAddress,
      feeSats: opts.feeSats != null ? opts.feeSats : 1000
    });
    const signed = inventoryHtlc.signAndExtractInventoryHtlcSellerClaim(bundle, this._htlcKey);
    const txid = await this.adapters.bitcoin.broadcast(signed.txHex);
    this._state.claimTxid = txid || signed.txid;
    this._transition(STATES.L1_CLAIMED, { txid: this._state.claimTxid });
    return this._state.claimTxid;
  }

  /**
   * L1 giver: ask the node whether the swap invoice was paid.
   * @returns {Promise<boolean>}
   */
  async checkPaid () {
    this._expect([STATES.L1_FUNDED], 'l1Giver');
    const paid = await this.adapters.lightning.isInvoicePaid(this._state.terms.paymentHashHex);
    if (paid) this._transition(STATES.L2_PAID);
    return Boolean(paid);
  }

  /**
   * L1 giver: note the counterparty's claim transaction (it carries the
   * preimage) and finish.
   * @param {string} txHex
   * @returns {boolean} whether the transaction claims this swap's HTLC
   */
  observeClaim (txHex) {
    this._expect([STATES.L1_FUNDED, STATES.L2_PAID], 'l1Giver');
    const found = inventoryHtlc.extractPreimageFromClaimTx(txHex, this._state.terms.paymentHashHex);
    if (!found.ok) return false;
    const txid = bitcoin.Transaction.fromHex(txHex).getId();
    this._state.claimTxid = txid;
    this._transition(STATES.L1_CLAIMED, { txid });
    return true;
  }

  /**
   * L1 giver: take the HTLC back after the refund lock when the invoice was
   * never paid.
   * @param {Object} [opts]
   * @param {string} [opts.destinationAddress]
   * @param {number} [opts.feeSats=1000]
   * @returns {Promise<string>} refund txid
   */
  async refund (opts = {}) {
    this._expect([STATES.L1_FUNDED], 'l1Giver');
    const terms = this._state.terms;
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    if (tip < terms.refundLockHeight) throw this._fail(`refund lock opens at height ${terms.refundLockHeight} (tip ${tip})`);
    const escrow = this._state.escrow;
    let fundedTxHex = this._state.fundingTxHex;
    const fundingTxid = this._state.fundingTxid || (this._state.funded && this._state.funded.txid);
    if (!fundedTxHex && fundingTxid) {
      const tx = await this.adapters.bitcoin.getTransaction(fundingTxid);
      fundedTxHex = tx && tx.txHex;
    }
    if (!fundedTxHex) throw this._fail('funding transaction not found');
    const destinationAddress = opts.destinationAddress || await this.adapters.bitcoin.getNewAddress();
    const bundle = inventoryHtlc.prepareInventoryHtlcBuyerRefundPsbt({
      networkName: this.order.network,
      fundedTxHex,
      paymentAddress: escrow.paymentAddress,
      claimScript: escrow.claimScriptHex,
      refundScript: escrow.refundScriptHex,
      refundLocktimeHeight: terms.refundLockHeight,
      destinationAddress,
      feeSats: opts.feeSats != null ? opts.feeSats : 1000
    });
    const signed = inventoryHtlc.signAndExtractInventoryHtlcBuyerRefund(bundle, this._htlcKey);
    const txid = await this.adapters.bitcoin.broadcast(signed.txHex);
    this._state.refundTxid = txid || signed.txid;
    this._transition(STATES.REFUNDED, { txid: this._state.refundTxid });
    return this._state.refundTxid;
  }

  /**
   * Walk away before any L1 funds move.
   * @param {string} [reason]
   */
  abort (reason = 'aborted') {
    this._expect([STATES.NEW, STATES.PROPOSED, STATES.ACCEPTED, STATES.PREPAID]);
    if (this._funding || this._state.fundingStartedAt != null) throw this._fail('HTLC funding already started; refund after the lock instead');
    this._transition(STATES.ABORTED, { reason: String(reason) });
  }

  /**
   * JSON for persistence. The preimage is a secret until the invoice is paid;
   * it is included only with `includeSecrets` (the L1 giver needs it back
   * after a restart). Private keys are never included.
   * @param {Object} [opts]
   * @param {boolean} [opts.includeSecrets=false]
   * @returns {Object}
   */
  toJSON (opts = {}) {
    const s = this._state;
    const out = {
      type: 'LiquiditySwap',
      version: 1,
      order: this.order,
      orderId: this.orderId,
      role: this.isMaker ? 'maker' : 'taker',
      settlementRole: this.role,
      lightningNodeId: this.lightningNodeId,
      status: s.status,
      take: s.take,
      takeId: s.takeId,
      accept: s.accept,
      funded: s.funded,
      quote: s.quote,
      terms: s.terms,
      escrow: s.escrow,
      prepayPaymentHash: s.prepayPaymentHash,
      fundingStartedAt: s.fundingStartedAt,
      fundingTxid: s.fundingTxid,
      fundingTxHex: s.fundingTxHex,
      claimTxid: s.claimTxid,
      refundTxid: s.refundTxid,
      history: s.history.slice()
    };
    if (opts && opts.includeSecrets) out.preimageHex = s.preimageHex;
    return out;
  }

  /**
   * Restore a swap saved with {@link LiquiditySwap#toJSON}. The keys must be
   * the ones the saved take / accept were made with, or the swap could not
   * fund, claim, or refund its HTLC.
   * @param {Object} json
   * @param {Object} settings constructor settings (keys, adapters, …) without `order` / `role`
   * @returns {LiquiditySwap}
   */
  static fromJSON (json, settings = {}) {
    if (!json || json.type !== 'LiquiditySwap') throw new Error('LiquiditySwap: not a saved swap');
    const restored = new LiquiditySwap(Object.assign({}, settings, {
      order: json.order,
      role: json.role,
      lightningNodeId: settings.lightningNodeId || json.lightningNodeId
    }));
    if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, json.status)) throw new Error(`LiquiditySwap: unknown state ${json.status}`);
    const savedHtlcPubkey = restored.isMaker
      ? (json.accept && json.accept.makerHtlcPubkey)
      : (json.take && json.take.takerHtlcPubkey);
    if (savedHtlcPubkey && savedHtlcPubkey !== restored.htlcPubkey) {
      throw new Error('LiquiditySwap: htlcKey does not match the saved swap');
    }
    if (!restored.isMaker && json.take && json.take.takerPubkey !== restored.identityPubkey) {
      throw new Error('LiquiditySwap: identityKey does not match the saved take');
    }
    Object.assign(restored._state, {
      status: json.status,
      take: json.take || null,
      takeId: json.takeId || null,
      accept: json.accept || null,
      funded: json.funded || null,
      quote: json.quote || null,
      terms: json.terms || null,
      escrow: json.escrow || null,
      preimageHex: json.preimageHex || null,
      prepayPaymentHash: json.prepayPaymentHash || null,
      fundingStartedAt: json.fundingStartedAt != null ? json.fundingStartedAt : null,
      fundingTxid: json.fundingTxid || null,
      fundingTxHex: json.fundingTxHex || null,
      claimTxid: json.claimTxid || null,
      refundTxid: json.refundTxid || null,
      history: Array.isArray(json.history) ? json.history.slice() : []
    });
    return restored;
  }

  /**
   * Lightning adapter over `services/lightning` (Core Lightning).
   * @param {Object} lightning a `Lightning` service instance
   * @returns {Object} `{ createInvoice, decodeInvoice, pay, isInvoicePaid }`
   */
  static lightningAdapter (lightning) {
    return {
      async createInvoice ({ amountMsat, label, description, preimageHex, expirySeconds }) {
        const options = {};
        if (preimageHex) options.preimage = preimageHex;
        if (expirySeconds != null) options.expiry = expirySeconds;
        return lightning.createInvoice(amountMsat, label, description, options);
      },
      async decodeInvoice (bolt11) {
        // `decodepay` is deprecated since CLN 24.11; `decode` returns the same bolt11 fields.
        try {
          const decoded = await lightning.callRpc('decode', [bolt11]);
          if (decoded && decoded.valid !== false && decoded.payment_hash) return decoded;
        } catch {}
        return lightning.decodePay(bolt11);
      },
      async pay (bolt11) {
        return lightning.pay(bolt11);
      },
      async isInvoicePaid (paymentHashHex) {
        const result = await lightning.callRpc('listinvoices', { payment_hash: paymentHashHex });
        const invoices = (result && result.invoices) || [];
        return invoices.some((inv) => inv.status === 'paid');
      }
    };
  }

  /**
   * Bitcoin adapter over `services/bitcoin` (bitcoind JSON-RPC, wallet
   * loaded). Reading the counterparty's funding transaction needs it in the
   * mempool or `txindex=1`.
   * @param {Object} service a `Bitcoin` service instance
   * @param {Object} [options]
   * @param {String} [options.wallet] named bitcoind wallet for funding and addresses (default: the node's default wallet)
   * @returns {Object} `{ getTipHeight, fundAddress, getTransaction, broadcast, getNewAddress }`
   */
  static bitcoinAdapter (service, options = {}) {
    const wallet = options && options.wallet;
    const rpc = (method, params = []) => service._makeRPCRequest(method, params);
    const walletRpc = (method, params = []) => (wallet
      ? service._makeWalletRequest(method, params, wallet)
      : rpc(method, params));
    return {
      async getTipHeight () {
        return Number(await rpc('getblockcount'));
      },
      async fundAddress (address, amountSats) {
        const txid = await walletRpc('sendtoaddress', [address, Number((amountSats / 1e8).toFixed(8))]);
        const tx = await walletRpc('gettransaction', [txid]);
        return { txid, txHex: tx && tx.hex };
      },
      async getTransaction (txid) {
        try {
          const tx = await rpc('getrawtransaction', [txid, true]);
          return { txHex: tx.hex, confirmations: Number(tx.confirmations) || 0 };
        } catch {
          return null;
        }
      },
      async broadcast (txHex) {
        return rpc('sendrawtransaction', [txHex]);
      },
      async getNewAddress () {
        return walletRpc('getnewaddress', ['', 'bech32m']);
      }
    };
  }
}

module.exports = LiquiditySwap;
module.exports.LiquiditySwap = LiquiditySwap;
