'use strict';

/**
 * @fileoverview Consumer budget agent for the Fabric document market.
 *
 * A `Market` holds a sats budget and a list of wanted documents (by id,
 * optionally Tree root + blob total). On each `tick()` it refreshes peer
 * inventories (filtered by `merkleRootHex` / `maxSats`), asks the local
 * `DocumentBook` for the cheapest / fastest / most reliable blob plan,
 * and — when the plan fits `perPlanMaxSats` and the remaining budget — opens
 * one purchase session per blob (`createDocumentPurchaseSession`, one HTLC per
 * seller per blob). Paid sealed blobs are verified before paying: the seller's
 * free ciphertext must be held and committed by the root. With `quotes`, a
 * per-buyer `DocumentBlobQuote` replaces the static payment hash; that is not
 * atomic (the wrapped key can only be checked once the seller claims), so it
 * is opt-in. The session is then funded on a payment channel or through the
 * injected `pay` callback (L1 HTLC), confirmed with `verify`, and the paid
 * `DocumentRequest` goes out. Delivery, refund, and fraud outcomes feed back
 * into the offer book's local telemetry.
 *
 * Budget: every sat is in exactly one bucket — `reservedSats` (committed to
 * a session that has not paid yet, including fundings whose outcome is
 * unknown), `lockedSats` (paid into an HTLC that is not resolved: delivery
 * pending, timed out awaiting refund, channel HTLC in flight), `spentSats`
 * (delivered, claimed, or fulfilled). `spentSats + reservedSats + lockedSats
 * <= budgetSats` always holds; sats return to the budget only once an HTLC
 * provably cannot pay out (refund confirmed, channel HTLC failed, or funding
 * definitively absent past `fundingSafetyMs`).
 *
 * Follows the Fabric Agent contract: `start()` / `stop()` / `tick()`, state
 * under `_state.content`, `debug` / `error` events. No wire changes: it only
 * drives existing `Peer` / `ChannelBook` methods and existing message types.
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { HTLC_MINIMUM_SATS } = require('../constants');
const Service = require('../types/service');
const DocumentBook = require('../types/documentBook');
const Htlc = require('../types/htlc');
const { networkForFabricName } = require('../types/policy');
const { assertTestNetwork } = require('../functions/bitcoinNetworkAllowlist');
const { contentHashHexFromObject } = require('../functions/documentPaymentHash');
const { settlementDedupeKey } = require('../functions/documentBlobManifest');

/** @private */
const HEX64 = /^[0-9a-f]{64}$/i;

/** @private statuses whose amount is reserved (nothing paid, or payment outcome unknown) */
const RESERVED_STATUSES = ['open', 'quote_pending', 'awaiting_funding', 'funding', 'funding_unknown', 'channel_pending'];
/** @private statuses whose amount sits in an unresolved HTLC */
const LOCKED_STATUSES = ['delivery_pending', 'settling', 'refund_pending'];
/** @private statuses that may still receive the blob key */
const KEY_STATUSES = ['delivery_pending', 'settling', 'refund_pending', 'claimed'];
/** @private statuses before any payment went out (prepay = verify-before-pay) */
const PREPAY_STATUSES = ['open', 'quote_pending'];
/** @private sessions that block another purchase of the same blob */
const BLOCKING_STATUSES = RESERVED_STATUSES.concat(['delivery_pending', 'settling']);

/**
 * Translate `proximityWeight` (0..1) into offer-book ranking weights: higher
 * proximity shifts weight from price toward measured latency + hops.
 * @param {number} proximityWeight
 * @returns {{ price: number, latency: number, peerScore: number, completeness: number }}
 */
function weightsForProximity (proximityWeight) {
  const p = Math.min(1, Math.max(0, Number(proximityWeight) || 0));
  // Keep reliability (peerScore) and completeness fixed; split the remaining 0.7.
  const latency = 0.1 + (0.5 * p);
  const price = 0.7 - latency;
  return { price, latency, peerScore: 0.2, completeness: 0.1 };
}

/**
 * Seller-scoped settlement key: one purchase of a blob per seller. A failed
 * or refunded purchase from one seller never blocks buying the blob from
 * another.
 * @param {Object} session
 * @returns {string}
 */
function sellerDedupeKey (session = {}) {
  return `${settlementDedupeKey(session)}|${String(session.sellerId || session.seller || '')}`;
}

/** @private */
function errorMessage (e) {
  return e && e.message ? e.message : String(e);
}

/** @private */
function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** @private origin name from a Peer event origin (object or string) */
function originName (origin) {
  if (!origin) return null;
  if (typeof origin === 'object') return origin.name || origin.address || origin.id || null;
  return String(origin);
}

class Market extends Service {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.budgetSats=0] Total sats this agent may commit.
   * @param {number} [settings.perPlanMaxSats=0] Cap per document plan (0 = only the budget caps).
   * @param {number} [settings.proximityWeight=0.5] 0 = cheapest wins, 1 = nearest / fastest wins.
   * @param {number} [settings.tickMs=15000] Scheduler interval (0 = manual `tick()` only).
   * @param {number} [settings.inventoryEveryMs=30000] Minimum spacing between inventory refreshes per want.
   * @param {number} [settings.deliveryTimeoutMs=600000] Paid sessions without delivery time out after this (0 = never); funded L1 HTLCs then wait for refund.
   * @param {number} [settings.prepayTimeoutMs=60000] Verify-before-pay: wait this long for the seller's free ciphertext (and quote).
   * @param {boolean} [settings.verifyBeforePay=true] Pay a sealed blob only once its ciphertext is held and committed by the root.
   * @param {boolean} [settings.quotes=false] Ask sellers for a per-buyer `DocumentBlobQuote` and pay its hash. Not atomic: a seller can quote a wrapped key that does not unwrap, claim the HTLC, and leave only a fraud proof (`documentBlobQuoteFraud`). Static hashes are atomic.
   * @param {boolean} [settings.credit=true] Take a seller's credit offer (`creditRateSats`) when a channel with it can pay: the key comes first, and the blob is paid with a channel transfer only once it opens. A blob that does not open is never paid.
   * @param {Object|boolean} [settings.seed] Seed after download: sell every received convergent document again as the same tree, on these `Peer#publishSealedDocument` terms (`{ rateSats, creditRateSats, creditLimitSats }`; `true` = free).
   * @param {number} [settings.fundingSafetyMs=3600000] A funding whose outcome is unknown is released only after the address is reported unfunded this long after the last pay attempt.
   * @param {number} [settings.minHtlcLockBlocks=24] Refuse L1 HTLCs whose refund locktime is closer than this to the tip (or past).
   * @param {number} [settings.maxHtlcLockBlocks=4032] Refuse L1 HTLCs that lock funds longer than this (0 = no cap).
   * @param {number} [settings.channelExpirySlackBlocks=6] Blocks added to the channel's minimum HTLC expiry delta (tip skew).
   * @param {string|Function} [settings.refundAddress] Destination for buyer refunds (`(session) => address` allowed).
   * @param {number} [settings.refundFeeSats=150] Fee for the buyer refund transaction.
   * @param {number} [settings.refundConfirmations=1] Confirmations before a refund releases its budget.
   * @param {string|Buffer} [settings.refundPrivateKey] Buyer refund key (defaults to the Peer key when it matches).
   * @param {Function} [settings.tipHeight] `() => number` chain tip (else `attach({ tipHeight })`, the channel book, or `onBlock`).
   * @param {Function} [settings.now] clock override (`() => ms`), for tests.
   * @param {string} [settings.network='regtest'] Bitcoin test network (mainnet refused).
   * @param {Object} [settings.book] `DocumentBook` settings.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Market',
      budgetSats: 0,
      perPlanMaxSats: 0,
      proximityWeight: 0.5,
      tickMs: 15000,
      inventoryEveryMs: 30000,
      deliveryTimeoutMs: 10 * 60 * 1000,
      prepayTimeoutMs: 60 * 1000,
      verifyBeforePay: true,
      quotes: false,
      credit: true,
      fundingSafetyMs: 60 * 60 * 1000,
      minHtlcLockBlocks: 24,
      maxHtlcLockBlocks: 4032,
      channelExpirySlackBlocks: 6,
      refundFeeSats: 150,
      refundConfirmations: 1,
      network: 'regtest',
      book: {}
    }, settings);
    this.settings.network = assertTestNetwork(this.settings.network, 'Market');

    this.peer = null;
    this.book = (settings.book instanceof DocumentBook) ? settings.book : new DocumentBook(this.settings.book || {});
    this._pay = null;
    this._verify = null;
    this._addressFunded = null;
    this._getTransaction = null;
    this._broadcast = null;
    this._confirmations = null;
    this._tipFn = null;
    this._tip = null;
    this._timer = null;
    this._bound = null;
    this._opening = null;
    this._channels = null;
    this._channelsBound = null;
    // seller-scoped dedupe key → settlementId of the session that may have paid it
    this.paidSettlements = new Map();

    this._state.content = {
      status: 'idle',
      budgetSats: Math.max(0, Math.floor(Number(this.settings.budgetSats) || 0)),
      spentSats: 0,
      reservedSats: 0,
      lockedSats: 0,
      wants: {},
      sessions: {},
      completed: {},
      lastTick: null
    };

    return this;
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  /**
   * @param {Object} deps
   * @param {Object} deps.peer `@fabric/core` Peer (inventory, requests, delivery events).
   * @param {DocumentBook} [deps.book] shared offer book (defaults to the agent's own).
   * @param {Function} [deps.pay] `async (session) => txid | { txid, txHex }` — funds the session HTLC address.
   * @param {Function} [deps.verify] `async (session, txid) => boolean` — L1 / Hub payment proof.
   * @param {Function} [deps.addressFunded] `async (address, session) => boolean | { funded, txid?, txHex? } | null` — `null` = unknown.
   * @param {Function} [deps.getTransaction] `async (txid) => txHex` — funding tx for refunds.
   * @param {Function} [deps.broadcast] `async (txHex, session) => txid` — broadcast a signed refund.
   * @param {Function} [deps.confirmations] `async (txid) => number` — refund confirmation depth.
   * @param {Function} [deps.tipHeight] `() => number` chain tip.
   * @param {Object} [deps.channels] `ChannelBook` (`types/channelBook`, or `{ sessionFor, tipHeight, publish }`).
   * @returns {Market}
   */
  attach (deps = {}) {
    if (deps.book instanceof DocumentBook) this.book = deps.book;
    if (typeof deps.pay === 'function') this._pay = deps.pay;
    if (typeof deps.verify === 'function') this._verify = deps.verify;
    if (typeof deps.addressFunded === 'function') this._addressFunded = deps.addressFunded;
    if (typeof deps.getTransaction === 'function') this._getTransaction = deps.getTransaction;
    if (typeof deps.broadcast === 'function') this._broadcast = deps.broadcast;
    if (typeof deps.confirmations === 'function') this._confirmations = deps.confirmations;
    if (typeof deps.tipHeight === 'function') this._tipFn = deps.tipHeight;
    if (deps.channels && typeof deps.channels.sessionFor === 'function') {
      this._unbindChannels();
      this._channels = deps.channels;
      if (typeof deps.channels.on === 'function') {
        this._channelsBound = {
          settled: (ev) => this.onChannelHtlcSettled(ev),
          action: (ev) => this._onChannelAction(ev)
        };
        deps.channels.on('htlcSettled', this._channelsBound.settled);
        deps.channels.on('channelAction', this._channelsBound.action);
      }
      this._reconcileChannels();
    }
    if (deps.peer) this._bindPeer(deps.peer);
    return this;
  }

  /** @private */
  _unbindChannels () {
    if (this._channels && this._channelsBound && typeof this._channels.removeListener === 'function') {
      this._channels.removeListener('htlcSettled', this._channelsBound.settled);
      this._channels.removeListener('channelAction', this._channelsBound.action);
    }
    this._channelsBound = null;
  }

  /** @private */
  _now () {
    return typeof this.settings.now === 'function' ? Number(this.settings.now()) : Date.now();
  }

  /**
   * Current chain tip: `settings.tipHeight`, then `attach({ tipHeight })`,
   * the channel book, then the last `onBlock` height.
   * @returns {number|null}
   */
  tipHeight () {
    for (const fn of [this.settings.tipHeight, this._tipFn, this._channels && this._channels.tipHeight && (() => this._channels.tipHeight())]) {
      if (typeof fn !== 'function') continue;
      let h = null;
      try { h = Number(fn()); } catch (_) { h = null; }
      if (Number.isFinite(h) && h > 0) return Math.floor(h);
    }
    return this._tip;
  }

  /** @private HTLC helpers know regtest / testnet / signet address params only */
  _htlcNetwork () {
    return this.settings.network === 'testnet4' ? 'testnet' : this.settings.network;
  }

  /**
   * Phase 4 rail: when a Fabric payment channel (`Channel.Session`) is open
   * with the seller and holds enough balance, pay for the chunk with an
   * off-chain HTLC instead of an L1 funding transaction.
   * @private
   * @param {Object} offer
   * @param {number} amountSats
   * @returns {Object|null} open `Channel.Session` able to pay `amountSats`
   */
  _channelFor (offer, amountSats) {
    if (!this._channels) return null;
    const sellerId = String(offer.sellerId || offer.sellerAddress || '');
    const channel = this._channels.sessionFor(sellerId, this._resolveSellerPubkeyHex(offer));
    if (!channel || channel.status !== 'open' || channel.balances.localSats < amountSats) return null;
    return channel;
  }

  /**
   * Credit rail: the seller offers the blob on credit (`creditRateSats`) and
   * an open channel with it can pay that on top of every credit purchase
   * not yet paid on it, above the channel reserve.
   * @private
   * @param {Object} offer
   * @returns {{ channel: Object, rateSats: number }|null}
   */
  _creditFor (offer) {
    if (this.settings.credit === false || !this._channels || !offer || offer.sealed !== true) return null;
    const rateSats = Math.floor(Number(offer.creditRateSats) || 0);
    if (!(rateSats > 0)) return null;
    if (Array.isArray(offer.paymentModes) && !offer.paymentModes.includes('credit')) return null;
    const sellerId = String(offer.sellerId || offer.sellerAddress || '');
    const channel = this._channels.sessionFor(sellerId, this._resolveSellerPubkeyHex(offer));
    if (!channel || channel.status !== 'open' || typeof channel.transfer !== 'function') return null;
    const reserve = channel.state && channel.state.policy ? Math.max(0, Number(channel.state.policy.channelReserveSats) || 0) : 0;
    const owed = Object.values(this._state.content.sessions)
      .filter((s) => s.rail === 'credit' && !s.creditPaid && String(s.channelId) === String(channel.channelId) && BLOCKING_STATUSES.includes(s.status))
      .reduce((n, s) => n + s.amountSats, 0);
    if (channel.balances.localSats - reserve - owed < rateSats) return null;
    return { channel, rateSats };
  }

  /**
   * What a blob from this offer costs us: its credit price when that rail is
   * usable and no dearer than the HTLC ask, else the HTLC ask.
   * @private
   */
  _priceOf (offer) {
    const rate = Math.max(0, Math.floor(Number(offer.rateSats) || 0));
    const credit = this._creditFor(offer);
    return credit && (rate === 0 || credit.rateSats <= rate) ? credit.rateSats : rate;
  }

  /** @private the channel session a purchase was offered on */
  _channelOf (session) {
    if (!this._channels) return null;
    const byId = typeof this._channels.get === 'function'
      ? this._channels.get(String(session.channelId))
      : null;
    if (byId) return byId;
    const ch = this._channels.sessionFor(session.sellerId, session.sellerPubkeyHex || null);
    return ch && (!session.channelId || String(ch.channelId) === String(session.channelId)) ? ch : null;
  }

  /**
   * `expireAfter` for a new channel HTLC: the channel's minimum delta
   * (`toSelfDelay + closeMarginBlocks + htlcSafetyBlocks`) plus
   * `channelExpirySlackBlocks`, clamped to what the channel lifetime allows.
   * @private
   * @param {Object} channel
   * @returns {{ height: (number|undefined), busy: (boolean|undefined), error: (string|undefined) }}
   */
  _channelExpiry (channel) {
    let bounds = null;
    if (typeof channel.htlcExpiryBounds === 'function') {
      bounds = channel.htlcExpiryBounds();
    } else {
      const tip = this.tipHeight();
      if (tip != null) {
        const Channel = require('../types/channel');
        bounds = { min: tip + Channel.minHtlcExpiryDelta(channel), max: Infinity };
      }
    }
    if (!bounds) return { busy: true, error: 'chain tip unknown' };
    const slack = Math.max(0, Math.floor(Number(this.settings.channelExpirySlackBlocks) || 0));
    let height = bounds.min + slack;
    if (this.settings.channelCltvDelta != null) {
      const tip = this.tipHeight();
      if (tip != null) height = Math.max(height, tip + Math.floor(Number(this.settings.channelCltvDelta) || 0));
    }
    if (height > bounds.max) height = bounds.max;
    if (!(height >= bounds.min)) return { error: `channel too close to expiry for an HTLC (min ${bounds.min} > max ${bounds.max})` };
    return { height };
  }

  /**
   * Offer the session's HTLC on its channel.
   * @private
   * @param {Object} session
   * @returns {{ status: ('offered'|'busy'|'unavailable'), reason: (string|undefined) }} `busy` = retry next tick (a round is mid-flight); `unavailable` = no usable channel (never confirm unpaid)
   */
  _settleOverChannel (session) {
    const paymentHashHex = session.paymentHashHex || session.contentHashHex;
    if (session.rail !== 'channel' || !this._channels || !paymentHashHex || !(session.amountSats > 0)) return { status: 'unavailable', reason: 'not a channel session' };
    const channel = this._channels.sessionFor(session.sellerId, session.sellerPubkeyHex || null);
    if (!channel || channel.status !== 'open') return { status: 'unavailable', reason: 'channel not open' };
    if (channel.balances.localSats < session.amountSats) return { status: 'unavailable', reason: 'insufficient channel balance' };
    if (channel.busy) return { status: 'busy', reason: 'channel round in flight' };
    const expiry = this._channelExpiry(channel);
    if (expiry.busy) return { status: 'busy', reason: expiry.error };
    if (expiry.error) return { status: 'unavailable', reason: expiry.error };
    let body;
    try {
      body = channel.offerHtlc({
        amountSats: session.amountSats,
        paymentHashHex,
        blobHashHex: session.blobHashHex || null,
        expireAfter: expiry.height
      });
    } catch (e) {
      const msg = errorMessage(e);
      return { status: /busy|tip unknown|in-flight|in flight/i.test(msg) ? 'busy' : 'unavailable', reason: msg };
    }
    session.rail = 'channel';
    session.channelId = channel.channelId;
    session.channelHtlcId = body.htlc ? body.htlc.id : null;
    session.channelExpireAfter = expiry.height;
    // The sats are in an HTLC from here on, whatever the publish does.
    this._moveBudget(session, 'locked');
    if (typeof this._channels.publish === 'function') this._channels.publish(body, channel);
    this.emit('channelHtlcOffered', { session, body });
    return { status: 'offered' };
  }

  /**
   * Channel-book settlement events (seller-fulfils), also used by the tick
   * reconcile and by hosts resolving an HTLC on chain. A fulfilled HTLC hands
   * the buyer the preimage and is spent; a failed one returns the sats to the
   * budget without blaming the seller for our own channel trouble. Each HTLC
   * outcome is applied once.
   * @param {Object} ev `{ channelId, htlcId, outcome: 'fulfilled'|'failed', preimageHex?, reason? }`
   * @returns {Object|null} the session
   */
  onChannelHtlcSettled (ev) {
    if (!ev || !ev.htlcId) return null;
    const session = Object.values(this._state.content.sessions).find((s) => s.rail === 'channel' && String(s.channelId) === String(ev.channelId) && String(s.channelHtlcId) === String(ev.htlcId));
    if (!session || session.htlcOutcome) return session || null;
    if (ev.outcome === 'fulfilled' && ev.preimageHex) {
      session.htlcOutcome = 'fulfilled';
      session.channelSettled = true;
      session.revealedKeyHex = String(ev.preimageHex).toLowerCase();
      // The sats left the channel whatever this session's status: always count them.
      this._moveBudget(session, 'spent');
      if (session.status === 'complete' || session.status === 'fraud') {
        this.commit();
        return session;
      }
      if (session.status === 'settling') this._complete(session, { keyHex: session.revealedKeyHex });
      else this._tryOpenWithKey(session);
    } else if (ev.outcome === 'failed') {
      session.htlcOutcome = 'failed';
      this._moveBudget(session, 'released');
      if (session.status === 'settling') {
        // Bytes already open; the HTLC simply never paid out.
        this._finish(session, 'complete', { buffer: null });
      } else if (!['complete', 'failed', 'fraud'].includes(session.status)) {
        this._fail(session, `channel HTLC failed: ${ev.reason || 'unknown'}`, { penalize: false });
      }
    }
    this.commit();
    return session;
  }

  /** @private channel watchdog actions for our HTLCs (on-chain timeout / claim) */
  _onChannelAction (action) {
    if (!action || !action.htlcId) return;
    const session = Object.values(this._state.content.sessions).find((s) => s.rail === 'channel' && String(s.channelId) === String(action.channelId) && String(s.channelHtlcId) === String(action.htlcId));
    if (!session || session.htlcOutcome) return;
    session.channelAction = { type: action.type, reason: action.reason || null, deadline: action.deadline || null };
    this.emit('sessionChannelAction', { session, action });
  }

  /**
   * Reconcile channel purchases against the book: a settlement whose
   * `htlcSettled` event was lost is applied from the session's `settled`
   * rows; an offered HTLC past its expiry is failed back (when the channel
   * is idle); an offer dropped from the channel releases its reservation.
   * @private
   */
  _reconcileChannels () {
    if (!this._channels) return;
    for (const s of Object.values(this._state.content.sessions)) {
      if (s.rail !== 'channel' || !s.channelHtlcId || s.htlcOutcome) continue;
      try { this._reconcileChannel(s); } catch (e) { this.emit('warning', `[MARKET] channel reconcile failed for ${s.settlementId}: ${errorMessage(e)}`); }
    }
  }

  /** @private */
  _reconcileChannel (session) {
    const channel = this._channelOf(session);
    if (!channel || !channel.state) return;
    const id = String(session.channelHtlcId);
    const st = channel.state;
    const settled = (st.settled || []).find((x) => String(x.id) === id);
    if (settled) {
      const pre = settled.outcome === 'fulfilled' && typeof channel.preimageFor === 'function' ? channel.preimageFor(settled.paymentHashHex) : null;
      if (settled.outcome === 'fulfilled' && pre) this.onChannelHtlcSettled({ channelId: session.channelId, htlcId: id, outcome: 'fulfilled', preimageHex: pre });
      else if (settled.outcome === 'failed') this.onChannelHtlcSettled({ channelId: session.channelId, htlcId: id, outcome: 'failed', reason: settled.reason || null });
      return;
    }
    const open = (st.htlcs || []).find((h) => String(h.id) === id);
    const signed = st.lastSigned && (st.lastSigned.htlcs || []).some((h) => String(h.id) === id);
    const queued = (st.rolledBack || []).some((i) => i && i.kind === 'offer' && i.htlc && String(i.htlc.id) === id);
    const dropped = (st.droppedIntents || []).some((i) => i && i.kind === 'offer' && i.htlc && String(i.htlc.id) === id);
    if (!open) {
      if (dropped || (!signed && !queued && !channel.busy)) {
        this.onChannelHtlcSettled({ channelId: session.channelId, htlcId: id, outcome: 'failed', reason: 'offer dropped from the channel' });
      }
      return;
    }
    const tip = this.tipHeight();
    const lock = open.expireAfter && typeof open.expireAfter === 'object' ? Number(open.expireAfter.height) : Number(open.expireAfter);
    if (tip == null || !(lock > 0) || tip < lock || channel.busy || channel.status !== 'open') return;
    try {
      const body = channel.failHtlc(id, 'expired');
      if (typeof this._channels.publish === 'function') this._channels.publish(body, channel);
    } catch (_) { return; }
    this.onChannelHtlcSettled({ channelId: session.channelId, htlcId: id, outcome: 'failed', reason: 'expired' });
  }

  /**
   * Open a held sealed blob with a preimage learned out of band (channel
   * fulfil, on-chain claim witness). A key that does not open the committed
   * blob is fraud evidence, never a delivery.
   * @private
   * @returns {boolean} opened
   */
  _tryOpenWithKey (session, keyHex = null) {
    const key = keyHex || session.revealedKeyHex;
    if (!key || !this.peer || typeof this.peer.openSealedBlobWithKey !== 'function') return false;
    let res = null;
    const outer = this._opening;
    this._opening = session.settlementId;
    try {
      res = this.peer.openSealedBlobWithKey({
        documentId: session.documentId,
        blobIndex: session.blobIndex,
        keyHex: key,
        paymentHashHex: session.paymentHashHex || session.contentHashHex
      });
    } catch (e) {
      res = { ok: false, error: errorMessage(e) };
    } finally {
      this._opening = outer;
    }
    if (res && res.ok) return true;
    const error = res && res.error ? String(res.error) : 'open failed';
    // Ciphertext not here yet: `documentCiphertextReceived` retries.
    if (!res || /no pending sealed blob|no held blob|keyHex must be/.test(error)) return false;
    this._onFraud(session, res.fraud ? 'bad-key' : 'wrong-bytes', error);
    return false;
  }

  /** @private */
  _bindPeer (peer) {
    if (this.peer === peer) return;
    this._unbindPeer();
    this.peer = peer;
    this._bound = {
      inventory: (ev) => this._onInventoryResponse(ev),
      received: (ev) => this._onDocumentReceived(ev),
      blob: (ev) => this._onBlobOpened(ev),
      ciphertext: (ev) => this._onCiphertextReceived(ev),
      quote: (ev) => this._onBlobQuote(ev),
      rejected: (ev) => this._onBlobRejected(ev)
    };
    peer.on('inventoryResponse', this._bound.inventory);
    peer.on('documentReceived', this._bound.received);
    peer.on('documentBlobOpened', this._bound.blob);
    peer.on('documentCiphertextReceived', this._bound.ciphertext);
    peer.on('documentBlobQuote', this._bound.quote);
    peer.on('documentBlobRejected', this._bound.rejected);
  }

  /** @private */
  _unbindPeer () {
    if (!this.peer || !this._bound) return;
    this.peer.removeListener('inventoryResponse', this._bound.inventory);
    this.peer.removeListener('documentReceived', this._bound.received);
    this.peer.removeListener('documentBlobOpened', this._bound.blob);
    this.peer.removeListener('documentCiphertextReceived', this._bound.ciphertext);
    this.peer.removeListener('documentBlobQuote', this._bound.quote);
    this.peer.removeListener('documentBlobRejected', this._bound.rejected);
    this._bound = null;
  }

  /** @private the ciphertext may land after the channel already revealed K_i */
  _onCiphertextReceived (ev) {
    if (!ev || !ev.documentId) return;
    for (const s of this._sessionsFor(ev.documentId, ev.blobIndex)) {
      if (s.revealedKeyHex && !s.fraud) this._tryOpenWithKey(s);
    }
  }

  // ---------------------------------------------------------------------
  // Budget + wants
  // ---------------------------------------------------------------------

  get budgetSats () { return this._state.content.budgetSats; }
  get spentSats () { return this._state.content.spentSats; }
  get reservedSats () { return this._state.content.reservedSats; }
  get lockedSats () { return this._state.content.lockedSats; }
  get committedSats () { return this.spentSats + this.reservedSats + this.lockedSats; }
  get remainingSats () { return Math.max(0, this.budgetSats - this.committedSats); }

  /**
   * Set the budget. It never drops below what is already committed
   * (`spent + reserved + locked`): lowering it that far just stops new buys.
   * @param {number} sats
   * @returns {Market}
   */
  setBudget (sats) {
    let n = Math.max(0, Math.floor(Number(sats) || 0));
    if (n < this.committedSats) {
      this.emit('warning', `[MARKET] budget ${n} is below the ${this.committedSats} sats already committed; holding at ${this.committedSats}`);
      n = this.committedSats;
    }
    this._state.content.budgetSats = n;
    this.commit();
    return this;
  }

  /**
   * Budget bucket a session's amount is counted in.
   * @private
   * @param {Object} session
   * @returns {('none'|'reserved'|'locked'|'spent'|'released')}
   */
  _bucketOf (session) {
    if (session.budget) return session.budget;
    // Sessions from before buckets were tracked.
    if (session._channelSpent) return 'spent';
    if (RESERVED_STATUSES.includes(session.status)) return 'reserved';
    if (LOCKED_STATUSES.includes(session.status)) return 'locked';
    if (session.status === 'complete' || session.status === 'claimed') return 'spent';
    return 'released';
  }

  /**
   * Move a session's amount between budget buckets. `spent` is final;
   * `released` is final except when money is later seen to have moved
   * after all (a funding the oracle missed), which is counted and flagged.
   * @private
   * @param {Object} session
   * @param {('reserved'|'locked'|'spent'|'released')} to
   * @returns {boolean} moved
   */
  _moveBudget (session, to) {
    const c = this._state.content;
    const from = session.budget ? session.budget : (session._reservedOnce ? this._bucketOf(session) : 'none');
    if (from === to || from === 'spent') return false;
    if (from === 'released' && to === 'released') return false;
    const amount = Math.max(0, Math.floor(Number(session.amountSats) || 0));
    const field = { reserved: 'reservedSats', locked: 'lockedSats', spent: 'spentSats' };
    if (field[from]) c[field[from]] = Math.max(0, c[field[from]] - amount);
    if (field[to]) c[field[to]] += amount;
    session.budget = to;
    session._reservedOnce = true;
    if (from === 'released' && amount > 0) {
      this.emit('warning', `[MARKET] session ${session.settlementId} moved ${amount} sats after it was released`);
    }
    this._checkBudget();
    return true;
  }

  /**
   * Invariant: `spentSats + reservedSats + lockedSats <= budgetSats`. Only a
   * payment discovered after its reservation was released can break it; that
   * is reported (`budgetExceeded`) and no new purchase fits until resolved.
   * @private
   * @returns {boolean}
   */
  _checkBudget () {
    const c = this._state.content;
    const committed = c.spentSats + c.reservedSats + c.lockedSats;
    if (committed <= c.budgetSats) return true;
    this.emit('budgetExceeded', { budgetSats: c.budgetSats, spentSats: c.spentSats, reservedSats: c.reservedSats, lockedSats: c.lockedSats });
    this.emit('warning', `[MARKET] budget invariant violated: spent ${c.spentSats} + reserved ${c.reservedSats} + locked ${c.lockedSats} > budget ${c.budgetSats}`);
    return false;
  }

  /**
   * Recompute the buckets from the sessions and compare with the counters.
   * @returns {{ ok: boolean, withinBudget: boolean, reservedSats: number, lockedSats: number, spentSats: number, counted: { reservedSats: number, lockedSats: number, spentSats: number } }}
   */
  audit () {
    const c = this._state.content;
    const counted = { reservedSats: 0, lockedSats: 0, spentSats: 0 };
    for (const s of Object.values(c.sessions)) {
      const amount = Math.max(0, Math.floor(Number(s.amountSats) || 0));
      const b = this._bucketOf(s);
      if (b === 'reserved') counted.reservedSats += amount;
      else if (b === 'locked') counted.lockedSats += amount;
      else if (b === 'spent') counted.spentSats += amount;
    }
    const withinBudget = c.spentSats + c.reservedSats + c.lockedSats <= c.budgetSats;
    const ok = withinBudget && counted.reservedSats === c.reservedSats && counted.lockedSats === c.lockedSats && counted.spentSats <= c.spentSats;
    return { ok, withinBudget, reservedSats: c.reservedSats, lockedSats: c.lockedSats, spentSats: c.spentSats, counted };
  }

  /**
   * Register a document to acquire.
   * @param {string} documentId
   * @param {Object} [opts]
   * @param {number} [opts.blobTotal] Known blob count (else the first offer's).
   * @param {string} [opts.merkleRootHex] Tree root selector for inventory + plans.
   * @param {number} [opts.maxSats] Per-document cap (defaults to `perPlanMaxSats`).
   * @returns {Object} want record
   */
  want (documentId, opts = {}) {
    const id = String(documentId || '').trim();
    if (!id) throw new Error('documentId is required');
    const root = opts.merkleRootHex && HEX64.test(String(opts.merkleRootHex)) ? String(opts.merkleRootHex).toLowerCase() : null;
    const record = {
      documentId: id,
      merkleRootHex: root,
      blobTotal: opts.blobTotal != null ? Math.max(1, Math.round(Number(opts.blobTotal))) : null,
      maxSats: opts.maxSats != null ? Math.max(0, Math.floor(Number(opts.maxSats))) : null,
      status: 'wanted',
      created: this._now(),
      lastInventoryAt: 0,
      sessions: [],
      lastError: null
    };
    this._state.content.wants[id] = record;
    this.commit();
    this.emit('debug', `[MARKET] want ${id}${root ? ' root=' + root.slice(0, 8) : ''}`);
    return record;
  }

  /**
   * Stop wanting a document. Sessions that never paid (`open`,
   * `quote_pending`, `channel_pending`) are cancelled and their reservations
   * released; sessions whose sats may already have moved (funding in flight
   * or unknown, awaiting host funding, HTLC unresolved) keep their budget and
   * still resolve through funding checks, refunds, or claims.
   * @param {string} documentId
   * @returns {boolean}
   */
  forget (documentId) {
    const id = String(documentId || '').trim();
    const w = this._state.content.wants[id];
    if (!w) return false;
    for (const sid of w.sessions) {
      const s = this._state.content.sessions[sid];
      if (!s) continue;
      if (['open', 'quote_pending', 'channel_pending'].includes(s.status)) {
        s.status = 'cancelled';
        s.error = 'want forgotten';
        this._moveBudget(s, 'released');
        this._dropDedupe(s);
      } else if (BLOCKING_STATUSES.includes(s.status) || LOCKED_STATUSES.includes(s.status)) {
        s.forgotten = true;
      }
    }
    delete this._state.content.wants[id];
    this.commit();
    return true;
  }

  /** @returns {Object[]} */
  listWants () {
    return Object.values(this._state.content.wants);
  }

  /** @returns {Object[]} */
  listSessions () {
    return Object.values(this._state.content.sessions);
  }

  /** @returns {Object} status summary (safe to expose over HTTP). */
  status () {
    const c = this._state.content;
    return {
      type: 'MarketAgentStatus',
      status: c.status,
      budgetSats: c.budgetSats,
      spentSats: c.spentSats,
      reservedSats: c.reservedSats,
      lockedSats: c.lockedSats,
      remainingSats: this.remainingSats,
      perPlanMaxSats: Math.max(0, Math.floor(Number(this.settings.perPlanMaxSats) || 0)),
      proximityWeight: Math.min(1, Math.max(0, Number(this.settings.proximityWeight) || 0)),
      wants: Object.values(c.wants).map((w) => ({
        documentId: w.documentId,
        merkleRootHex: w.merkleRootHex,
        blobTotal: w.blobTotal,
        maxSats: w.maxSats,
        status: w.status,
        sessions: w.sessions.length,
        lastError: w.lastError
      })),
      sessions: Object.values(c.sessions).map((s) => ({
        settlementId: s.settlementId,
        documentId: s.documentId,
        blobIndex: s.blobIndex != null ? s.blobIndex : null,
        seller: s.seller,
        amountSats: s.amountSats,
        status: s.status,
        budget: this._bucketOf(s),
        txid: s.txid || null
      })),
      completed: Object.keys(c.completed).length,
      lastTick: c.lastTick
    };
  }

  // ---------------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------------

  /** @returns {Object} offer-book weights derived from `proximityWeight`. */
  weights () {
    return weightsForProximity(this.settings.proximityWeight);
  }

  /**
   * Cap for one document plan: min(perPlanMaxSats, want.maxSats, remaining budget).
   * @param {Object} want
   * @returns {number}
   */
  planCap (want) {
    const caps = [this.remainingSats];
    const perPlan = Math.floor(Number(this.settings.perPlanMaxSats) || 0);
    if (perPlan > 0) caps.push(perPlan);
    if (want && want.maxSats != null && want.maxSats > 0) caps.push(want.maxSats);
    return Math.max(0, Math.min(...caps));
  }

  /**
   * Build the blob plan for a want without spending anything. Blobs this
   * agent already bought (or is buying) for the want are left out of the
   * cost.
   * @param {Object} want
   * @returns {{ ok: boolean, plan: (Map<number, Object>|undefined), costSats: (number|undefined), blobTotal: (number|undefined), error: (string|undefined) }}
   */
  planFor (want) {
    const id = want.documentId;
    const offers = this.book.listOffers(want.merkleRootHex ? { documentId: id, merkleRootHex: want.merkleRootHex } : { documentId: id });
    if (!offers.length) return { ok: false, error: 'no offers' };
    const blobTotal = want.blobTotal || Number(offers.find((o) => o.blobTotal != null && o.blobTotal > 0)?.blobTotal) || 1;
    const weights = this.weights();
    // Paid offers below the HTLC minimum can't be settled enforceably on either rail.
    const pick = { weights, merkleRootHex: want.merkleRootHex || undefined, minPaidSats: HTLC_MINIMUM_SATS };
    const plan = new Map();
    if (blobTotal > 1) {
      const picked = this.book.pickBlobPlan(id, blobTotal, pick);
      for (const [i, o] of picked.entries()) plan.set(i, o);
      if (plan.size < blobTotal) return { ok: false, error: `plan incomplete (${plan.size}/${blobTotal})`, plan, blobTotal };
    } else {
      const best = this.book.pickBest(id, pick);
      if (!best) return { ok: false, error: 'no offers' };
      plan.set(0, best);
    }
    // A seller already paid (or maybe paid) for a blob is not asked again:
    // take the next-best seller for that blob instead.
    for (const [i, o] of plan.entries()) {
      const indexed = blobTotal > 1 || o.blobIndex != null;
      if (!this._sellerPaidFor(id, indexed ? i : undefined, o)) continue;
      const alternatives = this.book.listOffers({ documentId: id, blobIndex: o.blobIndex != null ? o.blobIndex : undefined, merkleRootHex: o.merkleRootHex || want.merkleRootHex || undefined })
        .filter((x) => {
          const rate = Math.max(0, Math.floor(Number(x.rateSats) || 0));
          return (rate === 0 || rate >= HTLC_MINIMUM_SATS) && !this._sellerPaidFor(id, indexed ? i : undefined, x);
        });
      const next = alternatives.length ? this.book.rankOffers(alternatives, weights)[0] : null;
      if (next) plan.set(i, next);
    }
    // A plan is for one tree: every picked offer must agree on the root.
    const roots = new Set([...plan.values()].map((o) => o.merkleRootHex).filter(Boolean));
    if (roots.size > 1) return { ok: false, error: 'plan mixes merkle roots', plan, blobTotal };
    let costSats = 0;
    for (const [i, o] of plan.entries()) {
      const hash = contentHashHexFromObject(o);
      if (this._blobCovered(id, blobTotal > 1 || o.blobIndex != null ? i : undefined, hash, o.blobHashHex)) continue;
      if (this._holds(id, i, o, hash)) continue;
      costSats += this._priceOf(o);
    }
    return { ok: true, plan, costSats, blobTotal, merkleRootHex: roots.size ? [...roots][0] : (want.merkleRootHex || null) };
  }

  /** @private this seller holds a dedupe key (paid, or maybe paid) for the blob */
  _sellerPaidFor (documentId, blobIndex, offer) {
    const probe = {
      documentId,
      blobIndex,
      contentHashHex: contentHashHexFromObject(offer),
      sellerId: String(offer.sellerId || offer.sellerAddress || '')
    };
    return !!this._dedupeOwner(sellerDedupeKey(probe));
  }

  /**
   * True when a blob is already bought or a live purchase is working on it
   * (from any seller). The same chunk (blob hash and payment hash) in flight
   * at another index or under another document covers it too: once that
   * opens, this blob is taken from the Peer's held chunks.
   * @private
   */
  _blobCovered (documentId, blobIndex, contentHashHex, blobHashHex = null) {
    const idx = blobIndex != null ? Number(blobIndex) : null;
    const hash = contentHashHex ? String(contentHashHex).toLowerCase() : null;
    const blob = blobHashHex ? String(blobHashHex).toLowerCase() : null;
    return Object.values(this._state.content.sessions).some((s) => {
      if (s.documentId === documentId && (s.blobIndex != null ? Number(s.blobIndex) : null) === idx) {
        if (hash && s.contentHashHex && s.contentHashHex !== hash) return false;
        return s.status === 'complete' || s.status === 'claimed' || BLOCKING_STATUSES.includes(s.status);
      }
      return !!(blob && hash && !s.held && s.blobHashHex === blob && s.contentHashHex === hash && BLOCKING_STATUSES.includes(s.status));
    });
  }

  /**
   * The Peer already holds this sealed chunk (opened before, or one it
   * sells), so it opens without buying. A held open that failed for this blob
   * is not tried again: the blob is bought instead.
   * @private
   */
  _holds (documentId, blobIndex, offer, contentHashHex) {
    const peer = this.peer;
    if (!peer || typeof peer.heldChunk !== 'function' || typeof peer.adoptHeldChunk !== 'function') return false;
    if (!offer || offer.sealed !== true || !offer.blobHashHex || !contentHashHex || !offer.merkleRootHex) return false;
    const failed = Object.values(this._state.content.sessions).some((s) => s.held && s.status === 'failed' &&
      s.documentId === documentId && Number(s.blobIndex) === Number(blobIndex));
    if (failed) return false;
    try { return !!peer.heldChunk(offer.blobHashHex, contentHashHex); } catch (_) { return false; }
  }

  // ---------------------------------------------------------------------
  // Scheduler
  // ---------------------------------------------------------------------

  /**
   * Start the agent: mark `running` and arm the periodic `tick` when `tickMs > 0`.
   * @returns {Promise<Market>}
   */
  async start () {
    this.settings.network = assertTestNetwork(this.settings.network, 'Market');
    this._state.content.status = 'running';
    this.emit('debug', `[MARKET] starting budget agent (${this.budgetSats} sats)`);
    if (this.settings.tickMs > 0 && !this._timer) {
      this._timer = setInterval(() => {
        this.tick().catch((e) => this.emit('error', `[MARKET] tick failed: ${errorMessage(e)}`));
      }, this.settings.tickMs);
      if (typeof this._timer.unref === 'function') this._timer.unref();
    }
    this.commit();
    return this;
  }

  /**
   * Stop the agent: clear the tick timer and detach peer / channel listeners.
   * @returns {Promise<Market>}
   */
  async stop () {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._unbindPeer();
    this._unbindChannels();
    this._state.content.status = 'stopped';
    this.commit();
    return this;
  }

  /**
   * One scheduler pass: time out stale sessions, advance in-flight ones
   * (verify-before-pay, deferred channel rounds, unknown fundings, refunds,
   * channel reconcile), then refresh inventories, plan, and purchase within
   * budget.
   * @returns {Promise<Object>} summary `{ planned, opened, skipped, retried }`
   */
  async tick () {
    const summary = { planned: 0, opened: 0, skipped: 0, retried: 0 };
    this._state.content.lastTick = this._now();
    this._sweepTimeouts();
    this._reconcileChannels();
    for (const s of Object.values(this._state.content.sessions)) {
      try {
        switch (s.status) {
          case 'open': await this._settle(s); summary.retried++; break;
          case 'quote_pending': await this._advancePrepay(s); summary.retried++; break;
          case 'channel_pending': await this._fund(s); summary.retried++; break;
          case 'settling': this._complete(s, {}); summary.retried++; break;
          case 'awaiting_funding':
          case 'funding_unknown': await this._reconcileFunding(s); summary.retried++; break;
          case 'refund_pending': await this._refundStep(s); break;
          default: break;
        }
      } catch (e) {
        this.emit('warning', `[MARKET] session ${s.settlementId} step failed: ${errorMessage(e)}`);
      }
    }
    for (const want of Object.values(this._state.content.wants)) {
      // Blobs left to a shared chunk in flight elsewhere: once nothing here
      // is working, plan again (they open from the held chunks or are bought).
      if (want.status === 'buying' && !this._wantLive(want.documentId)) want.status = 'wanted';
      if (want.status !== 'wanted') continue;
      this._refreshInventory(want);
      const planned = this.planFor(want);
      if (!planned.ok) {
        want.lastError = planned.error;
        summary.skipped++;
        continue;
      }
      summary.planned++;
      const cap = this.planCap(want);
      if (planned.costSats > cap) {
        want.lastError = `plan costs ${planned.costSats} sats > cap ${cap}`;
        summary.skipped++;
        continue;
      }
      try {
        const opened = await this.purchasePlan(want, planned);
        summary.opened += opened.length;
      } catch (e) {
        want.lastError = errorMessage(e);
        this.emit('error', `[MARKET] purchase failed for ${want.documentId}: ${want.lastError}`);
      }
    }
    this.commit();
    return summary;
  }

  /** @private */
  _refreshInventory (want) {
    const peer = this.peer;
    if (!peer || !peer.connections) return;
    const now = this._now();
    if (now - (want.lastInventoryAt || 0) < this.settings.inventoryEveryMs) return;
    want.lastInventoryAt = now;
    const opts = { offerBtc: true, maxSats: this.planCap(want) || undefined };
    const buyer = this.buyerRefundPubkeyHex();
    if (buyer) opts.buyerRefundPublicKey = buyer;
    if (want.merkleRootHex) opts.merkleRootHex = want.merkleRootHex;
    for (const address of Object.keys(peer.connections)) {
      try { peer.requestPeerInventory(address, opts); } catch (_) { /* skip dead connection */ }
    }
  }

  /** @returns {string|null} compressed buyer refund key (Peer identity). */
  buyerRefundPubkeyHex () {
    const peer = this.peer;
    const key = peer && peer.key;
    const pub = key && key.pubkey;
    if (!pub) return null;
    const hex = Buffer.isBuffer(pub) ? pub.toString('hex') : String(pub);
    return /^[0-9a-f]{66}$/i.test(hex) ? hex.toLowerCase() : null;
  }

  // ---------------------------------------------------------------------
  // Purchasing
  // ---------------------------------------------------------------------

  /**
   * Open, verify, fund, confirm, and request every blob in a plan.
   * @param {Object} want
   * @param {{ plan: Map<number, Object>, blobTotal: number, costSats: number }} planned
   * @returns {Promise<Object[]>} opened sessions
   */
  async purchasePlan (want, planned) {
    const sessions = [];
    for (const [index, offer] of planned.plan.entries()) {
      const session = this.openSession(want, offer, index, planned.blobTotal);
      if (!session) continue;
      sessions.push(session);
    }
    if (!sessions.length) return sessions;
    want.status = 'buying';
    for (const session of sessions) {
      await this._settle(session);
    }
    return sessions;
  }

  /**
   * One purchase session for one blob (one HTLC per seller per blob). The
   * amount is reserved here; refused when it does not fit the remaining
   * budget, when the blob is already bought or being bought, or when this
   * seller was already paid (or may have been) for it.
   * @param {Object} want
   * @param {Object} offer
   * @param {number} blobIndex
   * @param {number} blobTotal
   * @returns {Object|null}
   */
  openSession (want, offer, blobIndex, blobTotal) {
    const contentHashHex = contentHashHexFromObject(offer);
    const indexed = blobTotal > 1 || offer.blobIndex != null;
    // A held chunk is opened locally: nothing to pay, nobody to pay.
    const held = indexed && this._holds(want.documentId, blobIndex, offer, contentHashHex);
    const rate = Math.max(0, Math.floor(Number(offer.rateSats) || 0));
    // Credit (pay after the blob opens) needs a payment hash to ask for and a blob to open.
    const credit = !held && indexed && contentHashHex ? this._creditFor(offer) : null;
    const onCredit = !!credit && (rate === 0 || credit.rateSats <= rate);
    const amountSats = held ? 0 : (onCredit ? credit.rateSats : rate);
    if (!onCredit && amountSats > 0 && amountSats < HTLC_MINIMUM_SATS) {
      want.lastError = `offer of ${amountSats} sats is below the ${HTLC_MINIMUM_SATS}-sat HTLC minimum`;
      return null;
    }
    if (amountSats > this.remainingSats) {
      want.lastError = `offer of ${amountSats} sats exceeds the ${this.remainingSats} sats left in the budget`;
      return null;
    }
    if (this._blobCovered(want.documentId, indexed ? blobIndex : undefined, contentHashHex, offer.blobHashHex)) return null;
    const sellerId = String(offer.sellerId || offer.sellerAddress || '');
    const probe = { documentId: want.documentId, blobIndex: indexed ? blobIndex : undefined, contentHashHex, sellerId };
    if (!held && this._dedupeOwner(sellerDedupeKey(probe))) {
      want.lastError = `already paid ${sellerId} for this blob`;
      return null;
    }
    let htlc = null;
    let paymentAddress = '';
    const channel = !onCredit && amountSats > 0 && contentHashHex ? this._channelFor(offer, amountSats) : null;
    if (!onCredit && amountSats > 0 && contentHashHex && !channel) {
      const built = this._buildHtlc(offer, contentHashHex, amountSats, want.documentId);
      if (built.error) {
        want.lastError = built.error;
        if (!built.local) this.book.recordDelivery(sellerId, { ok: false, kind: 'htlc' });
        return null;
      }
      htlc = built.htlc;
      paymentAddress = built.htlc ? built.htlc.paymentAddress : '';
    }
    const session = DocumentBook.createDocumentPurchaseSession({
      documentId: want.documentId,
      seller: offer.sellerAddress || offer.sellerId,
      contentHashHex,
      amountSats,
      paymentAddress,
      network: this.settings.network,
      blobIndex: indexed ? blobIndex : undefined,
      blobTotal: indexed ? blobTotal : undefined,
      blobHashHex: offer.blobHashHex,
      merkleRootHex: offer.merkleRootHex || want.merkleRootHex || undefined,
      htlc
    });
    session.sellerId = sellerId;
    session.dedupeKey = sellerDedupeKey(session);
    session.sellerPubkeyHex = this._resolveSellerPubkeyHex(offer) || null;
    session.paymentHashHex = contentHashHex || null;
    session.iv = offer.iv || null;
    session.sealed = offer.sealed === true;
    session.rootVerified = offer.rootVerified === true;
    if (held) session.held = true;
    if (channel) {
      session.rail = 'channel';
      session.channelId = channel.channelId;
    } else if (onCredit) {
      session.rail = 'credit';
      session.channelId = credit.channel.channelId;
    }
    session.openedAt = this._now();
    session.created = session.openedAt;
    this._state.content.sessions[session.settlementId] = session;
    this._moveBudget(session, 'reserved');
    if (!this._checkBudget()) {
      // Never reached through `remainingSats`; refuse rather than overcommit.
      this._moveBudget(session, 'released');
      delete this._state.content.sessions[session.settlementId];
      want.lastError = 'budget invariant would be violated';
      return null;
    }
    want.sessions.push(session.settlementId);
    this.emit('sessionOpened', session);
    return session;
  }

  /** @private settlement id holding a dedupe key, or null */
  _dedupeOwner (key) {
    if (!this.paidSettlements.has(key)) return null;
    const owner = this.paidSettlements.get(key);
    return owner || key;
  }

  /** @private */
  _dropDedupe (session) {
    if (session.dedupeKey && this.paidSettlements.get(session.dedupeKey) === session.settlementId) {
      this.paidSettlements.delete(session.dedupeKey);
    }
  }

  /**
   * Refund-locktime check against the tip: refuse a locktime that is past,
   * closer than `minHtlcLockBlocks`, or further than `maxHtlcLockBlocks`.
   * @private
   * @param {number} lock absolute height
   * @returns {string|null} error
   */
  _lockError (lock) {
    const tip = this.tipHeight();
    if (tip == null) return 'chain tip unknown — cannot check the HTLC refund locktime';
    const left = Math.floor(Number(lock)) - tip;
    const min = Math.max(1, Math.floor(Number(this.settings.minHtlcLockBlocks) || 0));
    const max = Math.max(0, Math.floor(Number(this.settings.maxHtlcLockBlocks) || 0));
    if (left < min) return `HTLC refund locktime ${lock} is ${left <= 0 ? 'already past' : 'too close'} at tip ${tip} (needs ≥ ${min} blocks)`;
    if (max > 0 && left > max) return `HTLC refund locktime ${lock} locks funds ${left} blocks past tip ${tip} (max ${max})`;
    return null;
  }

  /** @private */
  _buildHtlc (offer, contentHashHex, amountSats, documentId) {
    const buyerHex = this.buyerRefundPubkeyHex();
    const sellerHex = this._resolveSellerPubkeyHex(offer);
    const lock = this.peer && this.peer.settings && this.peer.settings.inventoryHtlcLocktimeHeight;
    if (!buyerHex || !sellerHex || !lock) {
      return { error: 'need buyer refund key, seller pubkey, and inventoryHtlcLocktimeHeight to build a buyer-bound HTLC' };
    }
    const ampSigner = offer.ampSignerPubkey || offer.wireSignerPubkey ||
      (offer.htlc && (offer.htlc.ampSignerPubkey || offer.htlc.sellerPublicKeyHex)) || null;
    if (ampSigner && !Htlc.pubkeysMatchXOnly(ampSigner, sellerHex)) {
      return { error: 'offer AMP signer does not match resolved seller pubkey — refusing to fund' };
    }
    const lockError = this._lockError(lock);
    if (lockError) return { error: lockError, local: true };
    const offerAddress = offer.htlc && offer.htlc.paymentAddress ? String(offer.htlc.paymentAddress).trim() : undefined;
    return this._htlcFor({ sellerHex, buyerHex, paymentHashHex: contentHashHex, lock: Number(lock), amountSats, documentId, offerAddress });
  }

  /** @private buyer-bound HTLC for one payment hash */
  _htlcFor (opts) {
    try {
      const verdict = Htlc.validateOffer({
        network: this._htlcNetwork(),
        claimPubkey: opts.sellerHex,
        refundPubkey: opts.buyerHex,
        paymentHash: opts.paymentHashHex,
        refundLocktime: opts.lock,
        paymentAddress: opts.offerAddress
      });
      if (!verdict.ok) return { error: verdict.error || 'HTLC offer validation failed' };
      const built = verdict.htlc;
      const hints = built.fundingHints({
        amountSats: opts.amountSats,
        label: String(opts.documentId).slice(0, 32)
      });
      return {
        htlc: {
          paymentAddress: built.address,
          paymentHashHex: built.paymentHashHex,
          claimScriptHex: built.claimScript.toString('hex'),
          refundScriptHex: built.refundScript.toString('hex'),
          refundLocktimeHeight: opts.lock,
          bitcoinUri: hints.bitcoinUri,
          sellerPubkey: opts.sellerHex,
          buyerRefundPubkey: opts.buyerHex
        }
      };
    } catch (e) {
      return { error: `could not build local HTLC: ${e.message}` };
    }
  }

  /** @private */
  _resolveSellerPubkeyHex (offer) {
    const direct = offer.sellerPubkey || offer.ampSignerPubkey || (offer.htlc && offer.htlc.sellerPublicKeyHex);
    if (direct && /^[0-9a-f]{66}$/i.test(String(direct))) return String(direct).toLowerCase();
    const sid = String(offer.sellerId || offer.sellerAddress || '').trim();
    const peers = (this.peer && this.peer.peers) || {};
    for (const row of Object.values(peers)) {
      if (!row || typeof row !== 'object') continue;
      const pk = row.publicKey || row.id;
      if (!pk) continue;
      if (String(row.id) === sid || String(row.address) === sid || String(pk) === sid) {
        const hex = String(pk).trim().toLowerCase();
        if (/^[0-9a-f]{66}$/.test(hex)) return hex;
      }
    }
    return null;
  }

  /**
   * Entry point after `openSession`: paid sealed blobs go through
   * verify-before-pay first; everything else is funded directly.
   * @private
   */
  async _settle (session) {
    if (session.held) return this._openHeld(session);
    if (session.rail === 'credit') return this._requestCredit(session);
    if (session.status === 'open' && this._needsPrepay(session)) return this._requestPrepay(session);
    return this._fund(session);
  }

  /**
   * Credit rail: ask the seller for the blob and its key on credit, naming
   * this session as the `creditRef`. Nothing moves yet, so the amount stays
   * reserved; it is paid (`_payCredit`) only once the blob opens. Seller
   * scoped like a paid purchase: this seller is not asked for the blob again.
   * @private
   */
  _requestCredit (session) {
    const owner = this._dedupeOwner(session.dedupeKey);
    if (owner && owner !== session.settlementId) return this._fail(session, 'another session already asked this seller for this blob', { penalize: false });
    this.paidSettlements.set(session.dedupeKey, session.settlementId);
    session.status = 'delivery_pending';
    session.confirmedAt = this._now();
    this._expect(session);
    const reqOpts = { maxSats: session.amountSats, blobIndex: session.blobIndex, credit: true, creditRef: session.settlementId };
    if (session.blobTotal != null) reqOpts.blobTotal = session.blobTotal;
    if (session.contentHashHex) reqOpts.contentHashHex = session.contentHashHex;
    let sent = false;
    try { sent = this.peer ? this.peer.requestDocument(session.documentId, session.seller, reqOpts) : false; } catch (_) { sent = false; }
    if (!sent) this.emit('debug', `[MARKET] could not send credit DocumentRequest for ${session.settlementId}`);
    this.emit('sessionConfirmed', session);
    this.commit();
    return session;
  }

  /**
   * Pay a credit purchase whose blob opened: a channel transfer naming the
   * session (`ChannelBook#transfer`, else the channel's own `transfer` +
   * `publish`). False when it cannot go out now (channel busy or gone); the
   * session then waits in `settling` and the tick retries.
   * @private
   * @returns {boolean} paid
   */
  _payCredit (session) {
    const channel = this._channelOf(session);
    if (!channel || channel.status !== 'open') {
      session.lastError = 'channel not open';
      return false;
    }
    if (channel.busy) {
      session.lastError = 'channel round in flight';
      return false;
    }
    let body = null;
    try {
      if (typeof this._channels.transfer === 'function') {
        body = this._channels.transfer(channel.channelId, session.amountSats, session.settlementId);
      } else {
        body = channel.transfer({ amountSats: session.amountSats, ref: session.settlementId });
        if (typeof this._channels.publish === 'function') this._channels.publish(body, channel);
      }
    } catch (e) {
      const msg = errorMessage(e);
      // Sent before a restart lost the session's flag.
      if (!/already paid/.test(msg)) {
        session.lastError = msg;
        return false;
      }
    }
    session.creditPaid = true;
    session.creditPaidAt = this._now();
    session.lastError = null;
    this.emit('creditTransferred', { session, body });
    return true;
  }

  /**
   * Open a held chunk into this tree (`Peer#adoptHeldChunk`): no payment and
   * no seller. If the chunk is gone or does not fit, the session fails and
   * the next plan buys the blob.
   * @private
   */
  _openHeld (session) {
    const peer = this.peer;
    session.status = 'delivery_pending';
    session.confirmedAt = this._now();
    this._expect(session);
    let res = null;
    const outer = this._opening;
    this._opening = session.settlementId;
    try {
      res = peer.adoptHeldChunk({
        documentId: session.documentId,
        merkleRootHex: session.merkleRootHex,
        blobTotal: session.blobTotal,
        blobIndex: session.blobIndex,
        blobHashHex: session.blobHashHex,
        paymentHashHex: session.contentHashHex,
        iv: session.iv || undefined
      });
    } catch (e) {
      res = { ok: false, error: errorMessage(e) };
    } finally {
      this._opening = outer;
    }
    if (res && res.ok) {
      if (session.status === 'delivery_pending') this._complete(session, {});
      this.commit();
      return session;
    }
    return this._fail(session, `held chunk did not open: ${(res && res.error) || 'unknown'}`, { penalize: false });
  }

  /** @private */
  _needsPrepay (session) {
    return this.settings.verifyBeforePay !== false && session.amountSats > 0 && session.sealed === true &&
      !!session.merkleRootHex && session.blobIndex != null && !!this.peer && typeof this.peer.requestDocument === 'function';
  }

  /** @private pin the blob we are buying so the Peer refuses anything else at that index */
  _expect (session) {
    const peer = this.peer;
    if (!peer || !peer.blobTransfers || !session.merkleRootHex) return;
    const index = Math.max(0, Math.floor(Number(session.blobIndex) || 0));
    let blobHashHexes = null;
    let paymentHashHexes = null;
    if (session.blobHashHex) {
      // Indexed by blobIndex and merged: earlier purchases of this tree stay pinned.
      blobHashHexes = [];
      blobHashHexes[index] = session.blobHashHex;
    }
    if (session.contentHashHex) {
      paymentHashHexes = [];
      paymentHashHexes[index] = session.contentHashHex;
    }
    const ivs = session.iv ? [] : null;
    if (ivs) ivs[index] = session.iv;
    const origins = session.seller ? [] : null;
    if (origins) origins[index] = String(session.seller);
    const opts = {
      documentId: session.documentId,
      merkleRootHex: session.merkleRootHex,
      total: session.blobTotal,
      blobHashHexes,
      paymentHashHexes,
      ivs,
      origins,
      merge: true
    };
    try { peer.blobTransfers.expectTransfer(opts); } catch (_) { /* optional */ }
  }

  /**
   * Verify-before-pay: ask the seller for the blob (free ciphertext) and a
   * per-buyer quote. Payment waits until the ciphertext is held and committed
   * by the root.
   * @private
   */
  async _requestPrepay (session) {
    this._expect(session);
    const reqOpts = { maxSats: session.amountSats, blobIndex: session.blobIndex };
    if (session.blobTotal != null) reqOpts.blobTotal = session.blobTotal;
    if (session.contentHashHex) reqOpts.contentHashHex = session.contentHashHex;
    if (this.settings.quotes === true) reqOpts.quote = true;
    session.status = 'quote_pending';
    session.prepayAt = this._now();
    let sent = false;
    try { sent = this.peer.requestDocument(session.documentId, session.seller, reqOpts); } catch (_) { sent = false; }
    if (!sent) this.emit('debug', `[MARKET] could not send pre-payment DocumentRequest for ${session.settlementId}`);
    this.emit('sessionQuoteRequested', session);
    return this._advancePrepay(session);
  }

  /**
   * Pay once the ciphertext is verified (and, with `quotes`, the quote is
   * accepted); fail the session when the seller sends neither within
   * `prepayTimeoutMs`.
   * @private
   */
  async _advancePrepay (session) {
    if (session.status !== 'quote_pending') return session;
    const verified = this._ciphertextVerified(session);
    const quoted = this.settings.quotes !== true || !!session.quote;
    if (verified && quoted) {
      session.ciphertextVerifiedAt = this._now();
      this.emit('sessionVerified', session);
      return this._fund(session);
    }
    const timeout = Math.max(0, Number(this.settings.prepayTimeoutMs) || 0);
    if (timeout && this._now() - (session.prepayAt || 0) >= timeout) {
      const missing = verified ? 'no quote' : 'no verifiable ciphertext';
      return this._fail(session, `seller sent ${missing} before payment`, { kind: 'prepay' });
    }
    return session;
  }

  /**
   * The blob's ciphertext is held by the Peer under this purchase's pins:
   * the frame hashes to the committed blob hash and carries the committed
   * (static) payment hash, proven by an inclusion proof against the root
   * (`verifySealedBlobFrame` rules, applied at ingest).
   * @private
   * @returns {boolean}
   */
  _ciphertextVerified (session) {
    const peer = this.peer;
    if (!peer || typeof peer._sealedBlobRow !== 'function') return false;
    let row = null;
    try { row = peer._sealedBlobRow(session.documentId, session.merkleRootHex || null, session.contentHashHex, session.blobIndex); } catch (_) { row = null; }
    const part = row && row.parts ? row.parts.get(Number(session.blobIndex)) : null;
    if (!part) return false;
    if (session.blobHashHex && part.blobHashHex !== session.blobHashHex) return false;
    const hash = session.contentHashHex;
    const candidates = [part].concat(part.alternates || []);
    if (hash && !candidates.some((c) => c.paymentHashHex === hash)) return false;
    return part.verified === true || (session.rootVerified === true && !!session.blobHashHex);
  }

  /**
   * Seller's per-buyer `DocumentBlobQuote`: accepted for a pre-payment
   * session from that seller when it is for the same tree / blob, wraps the
   * committed key (`keyHashHex` = the static payment hash), and does not ask
   * more than the offer. The HTLC then pays `quote.paymentHashHex`.
   * @private
   */
  _onBlobQuote (ev) {
    if (this.settings.quotes !== true) return;
    const q = ev && ev.quote;
    if (!q || !q.documentId) return;
    const from = originName(ev.origin);
    for (const s of Object.values(this._state.content.sessions)) {
      if (!PREPAY_STATUSES.includes(s.status) || s.quote) continue;
      if (s.documentId !== String(q.documentId) || Number(s.blobIndex) !== Number(q.blobIndex)) continue;
      if (from && String(from) !== String(s.seller) && String(from) !== String(s.sellerId)) continue;
      const reason = this._quoteError(s, q);
      if (reason) {
        this.emit('sessionQuoteRejected', { session: s, quote: q, reason });
        continue;
      }
      const amount = Math.floor(Number(q.amountSats));
      if (amount < s.amountSats) {
        // Pay what the seller asks; the difference goes back to the budget.
        this._state.content.reservedSats = Math.max(0, this._state.content.reservedSats - (s.amountSats - amount));
        s.amountSats = amount;
      }
      s.quote = {
        blobIndex: Number(q.blobIndex),
        paymentHashHex: String(q.paymentHashHex).toLowerCase(),
        keyHashHex: String(q.keyHashHex).toLowerCase(),
        amountSats: amount,
        expiresAt: q.expiresAt != null ? Number(q.expiresAt) : null
      };
      s.paymentHashHex = s.quote.paymentHashHex;
      if (s.rail !== 'channel' && s.htlc) {
        const built = this._htlcFor({
          sellerHex: s.htlc.sellerPubkey,
          buyerHex: s.htlc.buyerRefundPubkey,
          paymentHashHex: s.paymentHashHex,
          lock: s.htlc.refundLocktimeHeight,
          amountSats: s.amountSats,
          documentId: s.documentId
        });
        if (built.error) {
          this._fail(s, `quote HTLC: ${built.error}`, { penalize: false });
          continue;
        }
        s.htlc = built.htlc;
        s.paymentAddress = built.htlc.paymentAddress;
        s.bitcoinUri = built.htlc.bitcoinUri;
      }
      this.emit('sessionQuoted', { session: s, quote: s.quote });
    }
    this.commit();
  }

  /** @private */
  _quoteError (session, q) {
    if (!HEX64.test(String(q.paymentHashHex || '')) || !HEX64.test(String(q.keyHashHex || ''))) return 'malformed quote';
    if (session.merkleRootHex && q.merkleRootHex && String(q.merkleRootHex).toLowerCase() !== session.merkleRootHex) return 'quote is for another root';
    if (session.blobHashHex && q.blobHashHex && String(q.blobHashHex).toLowerCase() !== session.blobHashHex) return 'quote is for another blob';
    if (!session.contentHashHex || String(q.keyHashHex).toLowerCase() !== session.contentHashHex) return 'quote does not wrap the committed key';
    const amount = Math.floor(Number(q.amountSats));
    if (!(amount >= HTLC_MINIMUM_SATS)) return `quote of ${q.amountSats} sats is below the HTLC minimum`;
    if (amount > session.amountSats) return `quote of ${amount} sats exceeds the offer (${session.amountSats})`;
    if (q.expiresAt != null && Number(q.expiresAt) <= this._now()) return 'quote expired';
    return null;
  }

  /**
   * Fund a verified session: channel HTLC, or L1 HTLC through `pay`. The
   * seller-scoped dedupe key is written before `pay` runs, and an address
   * that may already hold our funding is never paid again.
   * @private
   */
  async _fund (session) {
    if (session.rail === 'channel') {
      const r = this._settleOverChannel(session);
      if (r.status === 'offered') return this.confirm(session.settlementId, null);
      if (r.status === 'busy') {
        // Defer: a channel round is in flight. The tick retries; nothing is
        // confirmed and no DocumentRequest goes out until the HTLC is offered.
        session.status = 'channel_pending';
        session.lastError = r.reason || null;
        this.emit('sessionDeferred', session);
        return session;
      }
      // Channel gone / underfunded after planning: that is our failure, not
      // the seller's — release the session without a reputation penalty.
      return this._fail(session, `channel unavailable: ${r.reason || 'unknown'}`, { penalize: false });
    }
    const needsFunding = session.amountSats > 0 && !!session.paymentAddress;
    if (!needsFunding) return this.confirm(session.settlementId, session.txid || null);
    if (session.quote && session.quote.expiresAt != null && session.quote.expiresAt <= this._now() && !session.payAttempts) {
      return this._fail(session, 'quote expired before funding', { penalize: false });
    }
    const lockError = session.htlc ? this._lockError(session.htlc.refundLocktimeHeight) : null;
    if (lockError) return this._fail(session, lockError, { penalize: false });
    const owner = this._dedupeOwner(session.dedupeKey);
    if (owner && owner !== session.settlementId) return this._fail(session, 'another session already paid this seller for this blob', { penalize: false });
    this.paidSettlements.set(session.dedupeKey, session.settlementId);
    if (!this._pay) {
      session.status = 'awaiting_funding';
      session.fundingRequestedAt = this._now();
      this.emit('fundingRequired', session);
      return session;
    }
    // The deterministic HTLC address may already hold our sats (an earlier
    // attempt, or a crash between pay and confirm): never pay it twice.
    const before = await this._fundingState(session);
    if (before.state === 'funded') return this._onFunded(session, before);
    return this._payOnce(session);
  }

  /** @private one `pay` call; any doubt leaves the session `funding_unknown` */
  async _payOnce (session) {
    session.status = 'funding';
    session.payAttempts = (session.payAttempts || 0) + 1;
    session.fundingStartedAt = this._now();
    session.unfundedSince = null;
    let paid = null;
    try {
      paid = Market.normalizePayResult(await this._pay(session));
    } catch (e) {
      return this._fundingUnknown(session, `pay failed: ${errorMessage(e)}`);
    }
    if (!paid || !paid.txid) return this._fundingUnknown(session, 'pay returned no txid');
    session.txid = paid.txid;
    if (paid.txHex) session.fundedTxHex = paid.txHex;
    if (this._verify) {
      let ok = false;
      try { ok = await this._verify(session, paid.txid); } catch (_) { ok = false; }
      if (!ok) return this._fundingUnknown(session, `payment to ${session.paymentAddress} not verified`);
    }
    return this._onFunded(session, paid);
  }

  /**
   * `pay` result → `{ txid, txHex }`.
   * @param {*} res `txid` string or `{ txid, txHex|hex }`
   * @returns {{ txid: string, txHex: (string|null) }|null}
   */
  static normalizePayResult (res) {
    if (!res) return null;
    if (typeof res === 'string') return { txid: res, txHex: null };
    if (typeof res === 'object' && res.txid) return { txid: String(res.txid), txHex: res.txHex || res.hex || null };
    return null;
  }

  /** @private */
  _fundingUnknown (session, reason) {
    session.status = 'funding_unknown';
    session.fundingUnknownAt = this._now();
    session.lastError = reason;
    this.emit('sessionFundingUnknown', session);
    this.emit('warning', `[MARKET] funding of ${session.settlementId} unknown (${reason}); reservation kept`);
    return session;
  }

  /**
   * Funding state of a session's HTLC address: `funded` (verified txid, or the
   * `addressFunded` oracle / an observed transaction says so), `unfunded`
   * (oracle says definitively not), or `unknown`.
   * @private
   * @returns {Promise<{ state: ('funded'|'unfunded'|'unknown'), txid: (string|undefined), txHex: (string|undefined) }>}
   */
  async _fundingState (session) {
    if (session.observedFunding) return Object.assign({ state: 'funded' }, session.observedFunding);
    if (session.txid && this._verify) {
      try {
        if (await this._verify(session, session.txid)) return { state: 'funded', txid: session.txid, txHex: session.fundedTxHex || null };
      } catch (_) { /* unknown */ }
    }
    if (!this._addressFunded || !session.paymentAddress) return { state: 'unknown' };
    let r;
    try { r = await this._addressFunded(session.paymentAddress, session); } catch (_) { return { state: 'unknown' }; }
    if (r === true) return { state: 'funded', txid: session.txid || null, txHex: session.fundedTxHex || null };
    if (r === false) return { state: 'unfunded' };
    if (r && typeof r === 'object' && r.funded === true) return { state: 'funded', txid: r.txid ? String(r.txid) : (session.txid || null), txHex: r.txHex || r.hex || session.fundedTxHex || null };
    if (r && typeof r === 'object' && r.funded === false) return { state: 'unfunded' };
    return { state: 'unknown' };
  }

  /**
   * Resolve `funding_unknown` / `awaiting_funding`: funded → continue to
   * delivery; reported unfunded for `fundingSafetyMs` after the last pay
   * attempt → release (no re-pay of the same session; the want re-plans and
   * a new session checks the address again before paying); unknown → keep.
   * @private
   */
  async _reconcileFunding (session) {
    const st = await this._fundingState(session);
    if (st.state === 'funded') return this._onFunded(session, st);
    if (session.status !== 'funding_unknown') return session;
    if (st.state !== 'unfunded') {
      session.unfundedSince = null;
      return session;
    }
    const now = this._now();
    if (!session.unfundedSince) session.unfundedSince = now;
    const since = Math.max(session.fundingStartedAt || 0, session.fundingUnknownAt || 0);
    if (now - since < Math.max(0, Number(this.settings.fundingSafetyMs) || 0)) return session;
    this._dropDedupe(session);
    return this._fail(session, 'funding never arrived', { penalize: false });
  }

  /** @private */
  _onFunded (session, st = {}) {
    if (st.txid) session.txid = String(st.txid);
    if (st.txHex) session.fundedTxHex = st.txHex;
    if (session.status === 'failed' || session.status === 'cancelled') {
      // Released on a wrong "unfunded" report: the sats are in the HTLC after all.
      session.status = 'refund_pending';
      session.error = 'funding seen after release';
      this._moveBudget(session, 'locked');
      return session;
    }
    return this.confirm(session.settlementId, session.txid || null);
  }

  /**
   * Mark a session funded (sats now locked in its HTLC) and send the paid
   * `DocumentRequest`.
   * @param {string} settlementId
   * @param {string|null} [txid]
   * @returns {Object} session
   */
  confirm (settlementId, txid = null) {
    const session = this._state.content.sessions[settlementId];
    if (!session) throw new Error(`unknown session ${settlementId}`);
    if (!RESERVED_STATUSES.includes(session.status)) return session;
    const owner = this._dedupeOwner(session.dedupeKey);
    if (owner && owner !== session.settlementId) return session;
    this.paidSettlements.set(session.dedupeKey, session.settlementId);
    if (txid) session.txid = String(txid);
    session.status = 'delivery_pending';
    session.confirmedAt = this._now();
    this._moveBudget(session, 'locked');
    const peer = this.peer;
    this._expect(session);
    const reqOpts = { maxSats: session.amountSats };
    if (session.contentHashHex) reqOpts.contentHashHex = session.contentHashHex;
    if (session.blobIndex != null) reqOpts.blobIndex = session.blobIndex;
    if (session.blobTotal != null) reqOpts.blobTotal = session.blobTotal;
    let sent = false;
    try { sent = peer ? peer.requestDocument(session.documentId, session.seller, reqOpts) : false; } catch (_) { sent = false; }
    if (!sent) this.emit('debug', `[MARKET] could not send DocumentRequest for ${settlementId}`);
    this.emit('sessionConfirmed', session);
    this.commit();
    return session;
  }

  /**
   * Fail a session that never paid: its reservation is released and the want
   * goes back to `wanted` when nothing else is working on it. A session whose
   * sats are locked in an HTLC keeps them locked (it resolves by refund,
   * claim, or channel settlement instead).
   * @private
   * @param {Object} session
   * @param {string} reason
   * @param {Object} [opts] `{ penalize: boolean, kind: string }` — `penalize: false` when the failure is local (our channel / funding)
   * @returns {Object} session
   */
  _fail (session, reason, opts = {}) {
    session.status = 'failed';
    session.error = reason;
    if (this._bucketOf(session) === 'reserved') this._moveBudget(session, 'released');
    if (opts.penalize !== false) this.book.recordDelivery(session.sellerId, { ok: false, kind: opts.kind || 'settlement' });
    this._wantBack(session, reason);
    this.emit('sessionFailed', session);
    return session;
  }

  /** @private hand the want back to the scheduler when nothing else works on it */
  _wantBack (session, reason) {
    const want = this._state.content.wants[session.documentId];
    if (!want || want.status !== 'buying') return;
    if (!this._wantLive(session.documentId, session)) want.status = 'wanted';
    want.lastError = reason;
  }

  /** @private a session other than `except` is still working on the document */
  _wantLive (documentId, except = null) {
    return Object.values(this._state.content.sessions).some((s) => s.documentId === documentId && s !== except && BLOCKING_STATUSES.includes(s.status));
  }

  /** @private terminal state with its budget outcome already applied */
  _finish (session, status, ev = {}) {
    session.status = status;
    session.completedAt = this._now();
    if (status === 'complete') {
      // A held chunk opened locally: no seller delivered it.
      if (!session.held) {
        const latencyMs = session.confirmedAt ? this._now() - session.confirmedAt : null;
        this.book.recordDelivery(session.sellerId, {
          ok: true,
          latencyMs,
          bytes: ev.buffer ? ev.buffer.length : (ev.bytes || 0)
        });
      }
      this.emit('sessionComplete', session);
    }
  }

  /** @private */
  _complete (session, ev = {}) {
    if (session.status === 'complete' || session.status === 'fraud') return;
    if (session.rail === 'credit' && !session.creditPaid) {
      // Pay only for a blob this seller's key opened; otherwise we owe nothing.
      if (!session.creditOpened) {
        this._moveBudget(session, 'released');
        session.status = 'cancelled';
        session.error = 'blob opened without this seller';
        this._wantBack(session, session.error);
        return;
      }
      if (!this._payCredit(session)) {
        session.status = 'settling';
        this.emit('sessionSettling', session);
        return;
      }
      this._moveBudget(session, 'spent');
      this._finish(session, 'complete', ev);
      return;
    }
    if (session.rail === 'channel' && session.channelHtlcId && !session.channelSettled && this._channels) {
      // Seller-fulfils is the normal path (`htlcSettled`). If the seller
      // revealed the key out of band instead, honour the deal by settling the
      // HTLC we offered — that only ever pays the counterparty. Nothing is
      // counted as spent until the settlement actually goes through.
      const keyHex = ev.keyHex || session.revealedKeyHex;
      const channel = keyHex ? this._channelOf(session) : null;
      if (channel) {
        try {
          const body = channel.fulfillHtlc(session.channelHtlcId, keyHex);
          if (typeof this._channels.publish === 'function') this._channels.publish(body, channel);
          session.channelSettled = true;
          session.htlcOutcome = 'fulfilled';
          this.emit('channelHtlcFulfilled', { session, body });
        } catch (e) {
          this.emit('warning', `[FABRIC:MARKET] channel settle failed: ${e.message}`);
        }
      }
      if (!session.channelSettled) {
        // Bytes are in hand but the HTLC is still open: keep the session
        // alive for `htlcSettled` / the next tick instead of booking a spend.
        session.status = 'settling';
        session.revealedKeyHex = keyHex || session.revealedKeyHex || null;
        this.emit('sessionSettling', session);
        return;
      }
    }
    const bucket = this._bucketOf(session);
    if (bucket === 'reserved') this._moveBudget(session, 'released');
    else if (bucket === 'locked') this._moveBudget(session, 'spent');
    this._finish(session, 'complete', ev);
  }

  /**
   * A revealed key that does not open the committed blob: fraud evidence,
   * never a delivery. The seller is penalized locally (`recordPenalty` with
   * the fraud kind) and `sessionFraud` is emitted. A funded L1 HTLC waits for
   * its refund (or the seller's claim); a channel HTLC is not fulfilled.
   * @private
   * @param {Object} session
   * @param {('bad-key'|'wrong-bytes')} kind
   * @param {string} error
   */
  _onFraud (session, kind, error) {
    if (session.fraud || session.status === 'complete') return;
    session.fraud = { kind, error, at: this._now() };
    session.error = `fraud (${kind}): ${error}`;
    this.book.recordPenalty(session.sellerId, { kind });
    this.book.recordDelivery(session.sellerId, { ok: false, kind });
    const bucket = this._bucketOf(session);
    if (session.rail !== 'channel' && bucket === 'locked') session.status = 'refund_pending';
    else {
      session.status = 'fraud';
      if (bucket === 'reserved') this._moveBudget(session, 'released');
    }
    this._wantBack(session, session.error);
    this.emit('sessionFraud', { session, kind, error });
    this.commit();
  }

  // ---------------------------------------------------------------------
  // Peer events
  // ---------------------------------------------------------------------

  /** @private */
  _onInventoryResponse (ev) {
    if (!ev || !ev.message) return;
    try {
      // Peers may hand us the raw body (string / Buffer) or an already-parsed object.
      const raw = ev.message.body != null ? ev.message.body : ev.message.object;
      let payload;
      if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) payload = raw;
      else payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '{}'));
      if (!payload || !Array.isArray(payload.items)) return;
      const origin = originName(ev.origin);
      this.book.ingestInventoryResponse({
        origin: origin ? String(origin) : '',
        items: payload.items,
        // Verified AMP signer: links fraud proofs and HTLC keys to this seller.
        signerPubkeyHex: ev.signerPubkeyHex || null,
        latencyMs: ev.latencyMs,
        hops: ev.hops
      });
    } catch (_) { /* malformed inventory bodies are ignored */ }
  }

  /** @private sessions that may still receive the blob key */
  _sessionsFor (documentId, blobIndex) {
    return Object.values(this._state.content.sessions).filter((s) => {
      if (s.documentId !== documentId) return false;
      if (!KEY_STATUSES.includes(s.status)) return false;
      if (blobIndex == null || s.blobIndex == null) return true;
      return Number(s.blobIndex) === Number(blobIndex);
    });
  }

  /** @private */
  _onBlobOpened (ev) {
    if (!ev || !ev.documentId) return;
    const from = originName(ev.origin);
    for (const s of this._sessionsFor(ev.documentId, ev.blobIndex)) {
      if (s.fraud) continue;
      const mine = this._opening != null
        ? this._opening === s.settlementId
        : (from != null && (String(from) === String(s.seller) || String(from) === String(s.sellerId)));
      if (mine || (from == null && this._opening == null)) {
        if (s.rail === 'credit' && mine) s.creditOpened = true;
        this._complete(s, ev);
        continue;
      }
      // Another seller's key opened this blob: this seller was not paid by
      // it. Its HTLC still resolves by refund, claim, or channel settlement.
      if (s.status === 'delivery_pending' && s.rail !== 'channel' && this._bucketOf(s) === 'locked') {
        s.status = 'refund_pending';
        s.error = 'blob delivered by another seller';
      }
    }
    // The seller opened the blob before we paid (free key): nothing to pay.
    for (const s of Object.values(this._state.content.sessions)) {
      if (s.documentId !== ev.documentId || !PREPAY_STATUSES.includes(s.status)) continue;
      if (ev.blobIndex != null && s.blobIndex != null && Number(s.blobIndex) !== Number(ev.blobIndex)) continue;
      this._moveBudget(s, 'released');
      this._finish(s, 'complete', ev);
    }
    this.commit();
  }

  /**
   * A key reveal from the seller we are buying from that did not open the
   * committed blob (`documentBlobRejected`): fraud, not a delivery. Events
   * without an origin (our own opens) or from other peers are ignored.
   * @private
   */
  _onBlobRejected (ev) {
    if (!ev || !ev.documentId || ev.blobIndex == null) return;
    const from = originName(ev.origin);
    if (!from) return;
    const error = String(ev.error || 'key did not open the blob');
    // A key that is not the committed preimage is a bad key; a committed key
    // that fails to decrypt means the committed bytes are wrong.
    const kind = /key does not match|invalid keyHex/i.test(error) ? 'bad-key' : 'wrong-bytes';
    for (const s of this._sessionsFor(ev.documentId, ev.blobIndex)) {
      if (s.status === 'claimed' || (String(from) !== String(s.seller) && String(from) !== String(s.sellerId))) continue;
      this._onFraud(s, kind, error);
    }
  }

  /** @private */
  _onDocumentReceived (ev) {
    if (!ev || !ev.documentId) return;
    const from = originName(ev.origin);
    // Who delivered: the origin, or the session whose key we are opening.
    const attributed = from != null || this._opening != null;
    for (const s of this._sessionsFor(ev.documentId, null)) {
      if (s.fraud) continue;
      if (this._bucketOf(s) !== 'locked') {
        this._complete(s, ev);
        continue;
      }
      // A purchase still holding an HTLC completes only on its own seller's
      // delivery, and only before it timed out: a timed-out one settles by
      // refund or the seller's on-chain claim. Per-blob purchases complete on
      // their own blob's open. A delivery we cannot attribute pays no one.
      // The session whose key we are opening wins over the event's origin, so
      // one delivery never pays two sellers.
      const mine = this._opening != null
        ? this._opening === s.settlementId
        : (from != null && (String(from) === String(s.seller) || String(from) === String(s.sellerId)));
      if (mine) {
        if (s.blobIndex == null && s.status !== 'refund_pending') this._complete(s, ev);
        continue;
      }
      // Another seller's delivery did not pay this one.
      if (attributed && s.status === 'delivery_pending' && s.rail !== 'channel') {
        s.status = 'refund_pending';
        s.error = 'document delivered by another seller';
      }
    }
    for (const s of Object.values(this._state.content.sessions)) {
      if (s.documentId !== ev.documentId || !PREPAY_STATUSES.includes(s.status)) continue;
      s.status = 'cancelled';
      s.error = 'document already received';
      this._moveBudget(s, 'released');
    }
    const want = this._state.content.wants[ev.documentId];
    if (want) {
      want.status = 'complete';
      this._state.content.completed[ev.documentId] = { at: this._now(), merkleRootHex: ev.merkleRootHex || want.merkleRootHex || null };
    }
    this._seed(ev);
    this.commit();
  }

  /**
   * Seed after download (`settings.seed`): sell a received convergent tree
   * again as the same tree, so later buyers of the same chunks may buy them here.
   * @private
   */
  _seed (ev) {
    const terms = this.settings.seed;
    if (!terms || !ev.seedable || !this.peer || typeof this.peer.seedDocument !== 'function') return;
    const out = this.peer.seedDocument(ev.documentId, terms === true ? {} : terms);
    if (out.ok) this.emit('seeded', { documentId: out.documentId });
    else this.emit('warning', `[MARKET] seeding ${ev.documentId} failed: ${out.error}`);
  }

  /**
   * Delivery timeouts (`deliveryTimeoutMs`). The seller is marked failed in
   * the offer book and the want returns to `wanted` so the next tick can
   * re-plan around that provider. Sats in an L1 HTLC stay **locked**
   * (`refund_pending`) until the refund confirms or the seller's claim is
   * seen; an open channel HTLC ends through its settlement instead.
   * @private
   */
  _sweepTimeouts () {
    const timeout = Math.max(0, Number(this.settings.deliveryTimeoutMs) || 0);
    if (!timeout) return;
    const now = this._now();
    for (const s of Object.values(this._state.content.sessions)) {
      if (s.status !== 'delivery_pending' || !s.confirmedAt) continue;
      if (now - s.confirmedAt < timeout) continue;
      // An open channel HTLC still moves sats if the seller fulfils late; it
      // ends through `htlcSettled` (fulfil, or fail at CLTV expiry) instead.
      if (s.rail === 'channel' && s.channelHtlcId && !s.htlcOutcome) continue;
      this.book.recordDelivery(s.sellerId, { ok: false, kind: 'timeout' });
      if (this._bucketOf(s) === 'locked' && s.amountSats > 0) {
        s.status = 'refund_pending';
        s.error = 'delivery timed out';
        s.timedOutAt = now;
        this.emit('sessionTimedOut', s);
        this._wantBack(s, 'delivery timed out');
      } else {
        this._fail(s, 'delivery timed out', { penalize: false });
      }
    }
  }

  // ---------------------------------------------------------------------
  // L1 refunds and on-chain observation
  // ---------------------------------------------------------------------

  /**
   * Refund path for a timed-out (or defrauded) L1 HTLC: once the tip reaches
   * the refund locktime, build the buyer refund (PSBT, signed when the buyer
   * key is available), emit `refundReady`, and broadcast through
   * `attach({ broadcast })` when given. The sats stay locked until the refund
   * has `refundConfirmations` (`attach({ confirmations })`, `onBlock`, or
   * `refundConfirmed`).
   * @private
   */
  async _refundStep (session) {
    if (session.status !== 'refund_pending' || !session.htlc) return session;
    if (session.refund && session.refund.txid && this._confirmations) {
      let n = 0;
      try { n = Number(await this._confirmations(session.refund.txid)) || 0; } catch (_) { n = 0; }
      if (n >= Math.max(1, Math.floor(Number(this.settings.refundConfirmations) || 1))) return this.refundConfirmed(session.settlementId, { txid: session.refund.txid });
    }
    if (session.refund) return session;
    const tip = this.tipHeight();
    if (tip == null || !Htlc.refundMature(tip, session.htlc.refundLocktimeHeight)) return session;
    const built = await this.buildRefund(session.settlementId);
    if (!built.ok) {
      if (session.refundError !== built.error) this.emit('warning', `[MARKET] refund for ${session.settlementId} not ready: ${built.error}`);
      session.refundError = built.error;
      return session;
    }
    if (this._broadcast && built.txHex) {
      try {
        const txid = await this._broadcast(built.txHex, session);
        session.refund.broadcastAt = this._now();
        if (txid) session.refund.txid = String(txid);
      } catch (e) {
        session.refundError = `broadcast failed: ${errorMessage(e)}`;
      }
    }
    return session;
  }

  /**
   * Build the buyer refund for a funded L1 session (refund leaf, after the
   * locktime). Signs with `settings.refundPrivateKey`, or the Peer key when
   * it is the HTLC's buyer refund key; otherwise returns the PSBT only.
   * Emits `refundReady` `{ session, psbtBase64, txHex, txid }`.
   * @param {string} settlementId
   * @returns {Promise<{ ok: boolean, error: (string|undefined), psbtBase64: (string|undefined), txHex: (string|null|undefined), txid: (string|null|undefined) }>}
   */
  async buildRefund (settlementId) {
    const session = this._state.content.sessions[settlementId];
    if (!session || !session.htlc) return { ok: false, error: 'no L1 HTLC for that session' };
    let fundedTxHex = session.fundedTxHex || null;
    if (!fundedTxHex && session.txid && this._getTransaction) {
      try { fundedTxHex = await this._getTransaction(session.txid); } catch (_) { fundedTxHex = null; }
      if (fundedTxHex) session.fundedTxHex = String(fundedTxHex);
    }
    if (!fundedTxHex) return { ok: false, error: 'funding transaction unknown (pay → { txHex } or attach({ getTransaction }))' };
    const dest = typeof this.settings.refundAddress === 'function' ? this.settings.refundAddress(session) : this.settings.refundAddress;
    if (!dest) return { ok: false, error: 'settings.refundAddress required' };
    let bundle;
    try {
      bundle = Htlc.prepareRefundPsbt({
        networkName: this._htlcNetwork(),
        fundedTxHex,
        paymentAddress: session.htlc.paymentAddress,
        claimScript: session.htlc.claimScriptHex,
        refundScript: session.htlc.refundScriptHex,
        refundLocktimeHeight: session.htlc.refundLocktimeHeight,
        destinationAddress: String(dest),
        feeSats: this.settings.refundFeeSats
      });
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
    const psbtBase64 = bundle.psbt.toBase64();
    let txHex = null;
    let txid = null;
    const priv = this._refundKeyFor(session);
    if (priv) {
      try {
        const signed = Htlc.signRefund(bundle, priv);
        txHex = signed.txHex;
        txid = signed.txid;
      } catch (e) {
        this.emit('warning', `[MARKET] refund signing failed for ${settlementId}: ${errorMessage(e)}`);
      }
    }
    session.fundingVout = bundle.vout;
    session.refund = { psbtBase64, txHex, txid, readyAt: this._now(), broadcastAt: null, confirmedAt: null };
    this.emit('refundReady', { session, psbtBase64, txHex, txid });
    this.commit();
    return { ok: true, psbtBase64, txHex, txid };
  }

  /** @private 32-byte buyer refund key matching the HTLC, or null */
  _refundKeyFor (session) {
    const want = session.htlc && session.htlc.buyerRefundPubkey ? String(session.htlc.buyerRefundPubkey).toLowerCase() : null;
    const candidates = [this.settings.refundPrivateKey, this.peer && this.peer.key && this.peer.key.private];
    for (const c of candidates) {
      if (!c) continue;
      const priv = Buffer.isBuffer(c) ? c : (/^[0-9a-f]{64}$/i.test(String(c)) ? Buffer.from(String(c), 'hex') : null);
      if (!priv || priv.length !== 32) continue;
      try {
        const pub = Buffer.from(Htlc.signerFromPriv32(priv).publicKey).toString('hex');
        if (!want || pub === want) return priv;
      } catch (_) { /* not a key */ }
    }
    return null;
  }

  /**
   * The buyer refund confirmed: the HTLC can no longer pay the seller, so its
   * sats go back to the budget. The seller is charged a refund in the book.
   * @param {string} settlementId
   * @param {Object} [opts] `{ txid }`
   * @returns {Object|null} session
   */
  refundConfirmed (settlementId, opts = {}) {
    const session = this._state.content.sessions[settlementId];
    if (!session || this._bucketOf(session) !== 'locked' || session.rail === 'channel') return session || null;
    session.refund = Object.assign(session.refund || {}, { txid: opts.txid ? String(opts.txid) : (session.refund && session.refund.txid) || null, confirmedAt: this._now() });
    this._moveBudget(session, 'released');
    session.status = 'refunded';
    session.completedAt = this._now();
    this.book.recordRefund(session.sellerId);
    this._wantBack(session, session.error || 'refunded');
    this.emit('sessionRefunded', session);
    this.commit();
    return session;
  }

  /**
   * The seller claimed the L1 HTLC (the preimage is public in the claim
   * witness): the sats are spent. The preimage opens the blob when its
   * ciphertext is held.
   * @param {string} settlementId
   * @param {Object} opts `{ preimageHex, txid? }`
   * @returns {Object|null} session
   */
  claimObserved (settlementId, opts = {}) {
    const session = this._state.content.sessions[settlementId];
    if (!session || session.rail === 'channel') return session || null;
    const pre = String(opts.preimageHex || '').toLowerCase();
    const hash = session.paymentHashHex || session.contentHashHex;
    if (!HEX64.test(pre) || !hash || sha256Hex(Buffer.from(pre, 'hex')) !== hash) return session;
    if (this._bucketOf(session) === 'spent') return session;
    session.claim = { txid: opts.txid ? String(opts.txid) : null, preimageHex: pre, at: this._now() };
    session.revealedKeyHex = pre;
    this._moveBudget(session, 'spent');
    if (session.status !== 'complete') {
      const fraud = !!session.fraud;
      session.status = 'claimed';
      session.completedAt = this._now();
      if (!fraud) this._tryOpenWithKey(session, pre);
    }
    this.emit('sessionClaimed', session);
    this.commit();
    return session;
  }

  /**
   * Classify a transaction against our L1 HTLCs: an output paying a session's
   * HTLC address is its funding; an input spending a funded HTLC is the
   * seller's claim (its witness carries the preimage) or our refund.
   * @param {string} txHex
   * @param {Object} [opts] `{ confirmed: boolean }` — a refund releases budget only once confirmed
   * @returns {Object[]} `{ settlementId, kind: ('funding'|'claim'|'refund') }`
   */
  observeTransaction (txHex, opts = {}) {
    let tx;
    try { tx = bitcoin.Transaction.fromHex(String(txHex).trim()); } catch (_) { return []; }
    const txid = tx.getId();
    const network = networkForFabricName(this._htlcNetwork());
    const out = [];
    const sessions = Object.values(this._state.content.sessions).filter((s) => s.rail !== 'channel' && s.paymentAddress && s.htlc);
    // A funding output belongs to one session: the live one for that address,
    // else one released after we paid it (its "unfunded" report was wrong).
    // Several sessions share an address when the same seller/blob/lock repeats.
    const claimed = new Set();
    for (const s of sessions) {
      const vout = Htlc.findVout(tx, s.paymentAddress, network);
      if (vout < 0) continue;
      if (s.txid === txid && !s.fundedTxHex) s.fundedTxHex = String(txHex).trim();
      if (claimed.has(s.paymentAddress)) continue;
      if (sessions.some((o) => o.paymentAddress === s.paymentAddress && o.observedFunding && o.observedFunding.txid === txid)) continue;
      const live = ['awaiting_funding', 'funding', 'funding_unknown'].includes(s.status);
      const busy = sessions.some((o) => o !== s && o.paymentAddress === s.paymentAddress &&
        (['awaiting_funding', 'funding', 'funding_unknown'].includes(o.status) || LOCKED_STATUSES.includes(o.status)));
      const late = ['failed', 'cancelled'].includes(s.status) && s.payAttempts > 0 && this._bucketOf(s) === 'released' && !busy;
      if (!live && !late) continue;
      claimed.add(s.paymentAddress);
      s.observedFunding = { txid, txHex: String(txHex).trim(), vout };
      s.fundingVout = vout;
      this._onFunded(s, s.observedFunding);
      out.push({ settlementId: s.settlementId, kind: 'funding' });
    }
    for (const s of sessions) {
      if (!s.txid || s.txid === txid || this._bucketOf(s) !== 'locked') continue;
      const spends = tx.ins.some((i) => Buffer.from(i.hash).reverse().toString('hex') === s.txid && (s.fundingVout == null || i.index === Number(s.fundingVout)));
      if (!spends) continue;
      const hit = Htlc.extractPreimage(tx, s.paymentHashHex || s.contentHashHex);
      if (hit.ok) {
        this.claimObserved(s.settlementId, { preimageHex: hit.preimageHex, txid });
        out.push({ settlementId: s.settlementId, kind: 'claim' });
      } else {
        s.refund = Object.assign(s.refund || {}, { txid, seenAt: this._now() });
        if (opts.confirmed === true) this.refundConfirmed(s.settlementId, { txid });
        out.push({ settlementId: s.settlementId, kind: 'refund' });
      }
    }
    if (out.length) this.commit();
    return out;
  }

  /**
   * New-block hook: record the tip and observe the block's transactions as
   * confirmed.
   * @param {Object} opts `{ height, txHexes? }`
   * @returns {Object[]} observations
   */
  onBlock (opts = {}) {
    const h = Math.floor(Number(opts.height) || 0);
    if (h > 0) this._tip = h;
    const out = [];
    for (const hex of opts.txHexes || []) out.push(...this.observeTransaction(hex, { confirmed: true }));
    return out;
  }

  // ---------------------------------------------------------------------
  // Persistence helpers (hosts persist `export()` however they like)
  // ---------------------------------------------------------------------

  /** @returns {Object} JSON-safe snapshot including offer-book telemetry. */
  export () {
    const c = this._state.content;
    return {
      type: 'MarketAgentState',
      version: 2,
      budgetSats: c.budgetSats,
      spentSats: c.spentSats,
      wants: c.wants,
      sessions: c.sessions,
      completed: c.completed,
      paidSettlements: Array.from(this.paidSettlements.entries()),
      telemetry: this.book.exportTelemetry()
    };
  }

  /**
   * Restore a snapshot. Reserved and locked sats are recomputed from the
   * sessions; a session caught mid-`pay` becomes `funding_unknown` (it may
   * have paid). Channel purchases are reconciled against the attached book.
   * @param {Object} snapshot output of `export()`
   * @returns {Market}
   */
  import (snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return this;
    const c = this._state.content;
    if (snapshot.budgetSats != null) c.budgetSats = Math.max(0, Math.floor(Number(snapshot.budgetSats) || 0));
    if (snapshot.wants && typeof snapshot.wants === 'object') c.wants = snapshot.wants;
    if (snapshot.sessions && typeof snapshot.sessions === 'object') c.sessions = snapshot.sessions;
    if (snapshot.completed && typeof snapshot.completed === 'object') c.completed = snapshot.completed;
    if (Array.isArray(snapshot.paidSettlements)) {
      this.paidSettlements = new Map(snapshot.paidSettlements.map((e) => (Array.isArray(e) ? [String(e[0]), e[1] || null] : [String(e), null])));
    }
    c.reservedSats = 0;
    c.lockedSats = 0;
    let spent = 0;
    for (const s of Object.values(c.sessions)) {
      if (s.status === 'funding') {
        s.status = 'funding_unknown';
        s.fundingUnknownAt = this._now();
        s.lastError = 'restarted while paying';
      }
      const bucket = this._bucketOf(s);
      s.budget = bucket;
      s._reservedOnce = true;
      const amount = Math.max(0, Math.floor(Number(s.amountSats) || 0));
      if (bucket === 'reserved') c.reservedSats += amount;
      else if (bucket === 'locked') c.lockedSats += amount;
      else if (bucket === 'spent') spent += amount;
    }
    c.spentSats = Math.max(spent, snapshot.spentSats != null ? Math.max(0, Math.floor(Number(snapshot.spentSats) || 0)) : 0);
    if (snapshot.telemetry) this.book.importTelemetry(snapshot.telemetry);
    this._reconcileChannels();
    this._checkBudget();
    return this;
  }
}

Market.weightsForProximity = weightsForProximity;
Market.settlementDedupeKey = settlementDedupeKey;
Market.sellerDedupeKey = sellerDedupeKey;
Market.randomId = () => crypto.randomBytes(8).toString('hex');
Market.STATUSES = Object.freeze({ reserved: RESERVED_STATUSES, locked: LOCKED_STATUSES });

module.exports = Market;
