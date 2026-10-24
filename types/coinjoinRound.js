'use strict';

/**
 * @fileoverview State machines for one coinjoin round (`functions/coinjoin`).
 * The taker runs one {@link CoinjoinTakerRound} across all its makers; each
 * maker runs one {@link CoinjoinMakerRound} per fill. They exchange sealed
 * round messages (`sealRoundMessage` envelopes) over any transport — Fabric
 * `CONTRACT_MESSAGE` direct to the peer, or `P2P_FORWARD` to hide the
 * taker's address. Every method that talks returns the envelopes to send;
 * nothing here touches the network.
 *
 *   Taker: `new → filled → authed → built → signed → broadcast`, or `aborted`
 *   Maker: `new → acked → ioauthed → signed`, or `aborted`
 *
 * The taker's key is fresh for each round, so makers do not learn who it is.
 * Fills are sealed to the maker's offer key; the maker answers with a fresh
 * seal key for the rest of the round. A maker that does not answer in time is
 * dropped and the transaction rebuilt without it ({@link CoinjoinTakerRound#rebuild}),
 * as long as `minMakers` remain; the caller should exclude it from later rounds.
 *
 * Chain and wallet access go through adapters ({@link CoinjoinTakerRound.bitcoinAdapter},
 * {@link CoinjoinTakerRound.walletAdapter}) so the machines run without daemons in tests.
 */

const EventEmitter = require('events');
const bitcoin = require('bitcoinjs-lib');
const coinjoin = require('../functions/coinjoin');
const podle = require('../functions/podle');
const bip32 = require('../functions/bip32');

const TAKER_STATES = Object.freeze({
  NEW: 'new',
  FILLED: 'filled',
  AUTHED: 'authed',
  BUILT: 'built',
  SIGNED: 'signed',
  BROADCAST: 'broadcast',
  ABORTED: 'aborted'
});

const TAKER_TRANSITIONS = Object.freeze({
  new: ['filled', 'aborted'],
  filled: ['authed', 'aborted'],
  authed: ['built', 'aborted'],
  built: ['built', 'signed', 'aborted'],
  signed: ['built', 'broadcast', 'aborted'],
  broadcast: [],
  aborted: []
});

const MAKER_STATES = Object.freeze({
  NEW: 'new',
  ACKED: 'acked',
  IOAUTHED: 'ioauthed',
  SIGNED: 'signed',
  ABORTED: 'aborted'
});

const MAKER_TRANSITIONS = Object.freeze({
  new: ['acked', 'aborted'],
  acked: ['ioauthed', 'aborted'],
  ioauthed: ['signed', 'aborted'],
  signed: ['signed', 'aborted'],
  aborted: []
});

const DEFAULT_ACK_TIMEOUT_MS = 30000;
const DEFAULT_SIG_TIMEOUT_MS = 60000;
const DEFAULT_MAX_REBUILDS = 3;
/** Times a maker will sign a rebuilt transaction in one round. */
const DEFAULT_MAX_SIGNS = DEFAULT_MAX_REBUILDS + 1;
/** Blocks the transaction's `nLockTime` may run ahead of the maker's tip. */
const LOCKTIME_SLACK_BLOCKS = 2;
/** Extra inputs budgeted when the taker selects coins. */
const INPUT_HEADROOM = 3;

/** @private */
function privBuffer (value, label) {
  const buf = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ''), 'hex');
  if (buf.length !== 32) throw new Error(`coinjoinRound: ${label} must be a 32-byte private key`);
  return buf;
}

/** @private */
function xOnly (pubkey) {
  return String(pubkey || '').toLowerCase().replace(/^0[23]/, '');
}

/** @private */
function inputKey (row) {
  return `${row.txid}:${row.vout}`;
}

/** @private */
class RoundBase extends EventEmitter {
  constructor (name, transitions, settings) {
    super();
    this._name = name;
    this._transitions = transitions;
    this.settings = Object.assign({ now: () => Date.now() }, settings);
    this.adapters = settings.adapters || {};
  }

  get status () { return this._state.status; }

  _transition (to, detail = {}) {
    const from = this._state.status;
    if (!this._transitions[from].includes(to)) throw new Error(`${this._name}: cannot move from ${from} to ${to}`);
    this._state.status = to;
    this._state.history.push(Object.assign({ from, to, at: this.settings.now() }, detail));
    this.emit('debug', `[COINJOIN] ${this._name} ${this._state.roundId || ''} ${from} → ${to}`);
    this.emit('state', { from, to, round: this });
  }

  _expect (statuses) {
    if (!statuses.includes(this._state.status)) {
      throw new Error(`${this._name}: expected state ${statuses.join(' | ')}, got ${this._state.status}`);
    }
  }

  _fail (message) {
    const err = new Error(`${this._name}: ${message}`);
    if (this.listenerCount('error') > 0) this.emit('error', err);
    return err;
  }
}

/**
 * The taker's side of a round.
 */
class CoinjoinTakerRound extends RoundBase {
  /**
   * @param {Object} settings
   * @param {string} [settings.network='regtest']
   * @param {number} settings.amountSats size of every coinjoin output
   * @param {Object} settings.adapters `{ bitcoin, wallet }`
   * @param {Buffer|string} [settings.roundKey] fresh per round (generated when omitted)
   * @param {string} [settings.roundId] (generated when omitted)
   * @param {number} [settings.minMakers=2]
   * @param {number} [settings.feeRateSatVb=2]
   * @param {number} [settings.minFeeRateSatVb=1]
   * @param {number} [settings.maxFeeRateSatVb=500]
   * @param {number} [settings.maxFeeSats] most any one maker may charge
   * @param {number} [settings.minMakerConfs=1] confirmations on maker inputs
   * @param {boolean} [settings.requireOwnership=false] makers must sign for their inputs
   * @param {number} [settings.podleMinAgeConfs=5]
   * @param {number} [settings.podleMinValuePct=20]
   * @param {number} [settings.ackTimeoutMs=30000]
   * @param {number} [settings.sigTimeoutMs=60000]
   * @param {number} [settings.maxRebuilds=3]
   * @param {Function} [settings.now]
   */
  constructor (settings = {}) {
    super('CoinjoinTakerRound', TAKER_TRANSITIONS, Object.assign({
      network: 'regtest',
      minMakers: coinjoin.DEFAULT_MIN_MAKERS,
      feeRateSatVb: 2,
      minFeeRateSatVb: 1,
      maxFeeRateSatVb: 500,
      minMakerConfs: 1,
      requireOwnership: false,
      podleMinAgeConfs: podle.DEFAULT_MIN_AGE_CONFS,
      podleMinValuePct: podle.DEFAULT_MIN_VALUE_PCT,
      ackTimeoutMs: DEFAULT_ACK_TIMEOUT_MS,
      sigTimeoutMs: DEFAULT_SIG_TIMEOUT_MS,
      maxRebuilds: DEFAULT_MAX_REBUILDS
    }, settings));
    if (!this.adapters.bitcoin || !this.adapters.wallet) throw new Error('CoinjoinTakerRound: adapters.bitcoin and adapters.wallet are required');
    const amount = Number(settings.amountSats);
    if (!Number.isSafeInteger(amount) || amount < coinjoin.MIN_COINJOIN_SATS) throw new Error('CoinjoinTakerRound: amountSats is too small');
    this._roundKey = settings.roundKey ? privBuffer(settings.roundKey, 'roundKey') : coinjoin.randomPrivateKey();
    this.takerPubkey = coinjoin.pubkeyFromPrivate(this._roundKey);
    this._state = {
      status: TAKER_STATES.NEW,
      roundId: settings.roundId || coinjoin.randomRoundId(),
      amountSats: amount,
      podle: null,
      makers: new Map(),
      takerInputs: null,
      coinjoinScriptHex: null,
      changeScriptHex: null,
      psbt: null,
      plan: null,
      unsignedTxid: null,
      rebuilds: 0,
      txid: null,
      txHex: null,
      history: []
    };
  }

  static get STATES () { return TAKER_STATES; }
  static get TRANSITIONS () { return TAKER_TRANSITIONS; }

  /** @returns {string} */
  get roundId () { return this._state.roundId; }
  /** @returns {number} */
  get amountSats () { return this._state.amountSats; }
  /** @returns {string} x-only key round messages to this taker are sealed to */
  get sealXOnly () { return xOnly(this.takerPubkey); }
  /** @returns {Object|null} {@link functions/coinjoin.planCoinjoin} result of the current transaction */
  get plan () { return this._state.plan; }
  /** @returns {string|null} current PSBT */
  get psbt () { return this._state.psbt; }
  /** @returns {string|null} broadcast txid */
  get txid () { return this._state.txid; }

  /**
   * Makers in this round, with their stage.
   * @returns {Object[]} `{ makerPubkey, offerId, fillId, stage, dropped, reason }`
   */
  makers () {
    return [...this._state.makers.values()].map((m) => ({
      makerPubkey: m.offer.makerPubkey,
      offerId: m.offerId,
      fillId: m.fillId,
      stage: m.stage,
      dropped: m.stage === 'dropped',
      reason: m.reason || null,
      cjfeeSats: coinjoin.makerFee(m.offer, this._state.amountSats)
    }));
  }

  /** @returns {string[]} maker keys dropped from this round (exclude them next time) */
  get dropped () {
    return [...this._state.makers.values()].filter((m) => m.stage === 'dropped').map((m) => m.offer.makerPubkey);
  }

  /** @private */
  _live (stages) {
    return [...this._state.makers.values()].filter((m) => m.stage !== 'dropped' && (!stages || stages.includes(m.stage)));
  }

  /** @private */
  _send (maker, body) {
    const signed = coinjoin.signBody(body, this._roundKey);
    const to = maker.sealPubkey || maker.offer.makerPubkey;
    return { to: maker.offer.makerPubkey, fillId: maker.fillId, envelope: coinjoin.sealRoundMessage(signed, to) };
  }

  /** @private */
  _drop (maker, reason) {
    if (maker.stage === 'dropped') return;
    maker.stage = 'dropped';
    maker.reason = String(reason);
    this.emit('dropped', { makerPubkey: maker.offer.makerPubkey, fillId: maker.fillId, reason: maker.reason });
  }

  /** @private */
  async _podle () {
    const candidates = await this.adapters.wallet.podleCandidates({
      amountSats: this._state.amountSats,
      minAgeConfs: this.settings.podleMinAgeConfs,
      minValuePct: this.settings.podleMinValuePct
    });
    for (const c of candidates || []) {
      const index = podle.nextIndex(c.usedIndexes || []);
      if (index == null) continue;
      const key = c.outputPrivateKey
        ? privBuffer(c.outputPrivateKey, 'outputPrivateKey')
        : coinjoin.taprootOutputPrivateKey(privBuffer(c.internalPrivateKey, 'internalPrivateKey'));
      const proof = podle.generatePodle({ privateKey: key, utxo: { txid: c.txid, vout: c.vout }, index });
      this.emit('podle', { txid: c.txid, vout: c.vout, index, commitment: proof.commitment });
      return proof;
    }
    throw this._fail('no wallet UTXO can back a PoDLE commitment (too young, too small, or used up)');
  }

  /**
   * Fill the chosen offers. Each must be valid, for this network and amount,
   * and from a distinct maker.
   * @param {Object[]} offers signed `CoinjoinOffer` bodies (e.g. `CoinjoinBook#choose`)
   * @returns {Promise<Object[]>} `{ to, fillId, envelope }` to send
   */
  async start (offers = []) {
    this._expect([TAKER_STATES.NEW]);
    const now = this.settings.now();
    const accepted = [];
    const seen = new Set();
    for (const raw of offers) {
      const v = coinjoin.verifyBody(raw);
      if (!v.ok || v.body.type !== coinjoin.BODY_TYPES.OFFER) continue;
      const offer = v.body;
      if (offer.network !== this.settings.network || offer.expiresAt <= now) continue;
      if (this._state.amountSats < offer.minSats || this._state.amountSats > offer.maxSats) continue;
      if (this.settings.maxFeeSats != null && coinjoin.makerFee(offer, this._state.amountSats) > this.settings.maxFeeSats) continue;
      if (seen.has(offer.makerPubkey)) continue;
      seen.add(offer.makerPubkey);
      accepted.push({ offer, offerId: v.id });
    }
    if (accepted.length < this.settings.minMakers) throw this._fail(`need ${this.settings.minMakers} usable offers, got ${accepted.length}`);
    this._state.podle = await this._podle();
    const out = [];
    for (const { offer, offerId } of accepted) {
      const fill = coinjoin.signBody({
        type: coinjoin.BODY_TYPES.FILL,
        offerId,
        roundId: this._state.roundId,
        amountSats: this._state.amountSats,
        commitment: this._state.podle.commitment,
        takerPubkey: this.takerPubkey,
        createdAt: now,
        nonce: coinjoin.randomNonce()
      }, this._roundKey);
      const fillId = coinjoin.bodyId(fill);
      const maker = { offer, offerId, fillId, fill, stage: 'filled', sealPubkey: null, ioauth: null, sig: null, sentAt: now, txSentAt: null, reason: null };
      this._state.makers.set(fillId, maker);
      out.push({ to: offer.makerPubkey, fillId, envelope: coinjoin.sealRoundMessage(fill, offer.makerPubkey) });
    }
    this._transition(TAKER_STATES.FILLED, { makers: out.length });
    return out;
  }

  /**
   * Open and apply a sealed message from a maker.
   * @param {Object} envelope
   * @returns {Promise<Object[]>} replies `{ to, fillId, envelope }`
   */
  async receive (envelope) {
    const opened = coinjoin.openRoundMessage(envelope, this._roundKey);
    if (!opened.ok) throw this._fail(`unreadable message: ${opened.reason}`);
    const body = opened.body;
    if (body.roundId !== this._state.roundId) throw this._fail('message for another round');
    const maker = this._state.makers.get(body.fillId);
    if (!maker) throw this._fail('message for an unknown fill');
    if (body.makerPubkey !== maker.offer.makerPubkey) throw this._fail('message not signed by the maker');
    if (maker.stage === 'dropped') return [];
    switch (body.type) {
      case coinjoin.BODY_TYPES.FILL_ACK: return this._onFillAck(maker, body);
      case coinjoin.BODY_TYPES.IOAUTH: return this._onIoAuth(maker, body);
      case coinjoin.BODY_TYPES.SIG: return this._onSig(maker, body);
      default: throw this._fail(`unexpected ${body.type}`);
    }
  }

  /** @private */
  _onFillAck (maker, ack) {
    this._expect([TAKER_STATES.FILLED, TAKER_STATES.AUTHED]);
    if (maker.stage !== 'filled' || ack.offerId !== maker.offerId) throw this._fail('unexpected fill ack');
    maker.sealPubkey = ack.sealPubkey;
    maker.stage = 'authed';
    const reply = this._send(maker, {
      type: coinjoin.BODY_TYPES.AUTH,
      roundId: this._state.roundId,
      fillId: maker.fillId,
      takerPubkey: this.takerPubkey,
      reveal: this._state.podle.reveal,
      createdAt: this.settings.now()
    });
    if (this._state.status === TAKER_STATES.FILLED) this._transition(TAKER_STATES.AUTHED);
    return [reply];
  }

  /** @private */
  async _onIoAuth (maker, ioauth) {
    this._expect([TAKER_STATES.AUTHED]);
    if (maker.stage !== 'authed') throw this._fail('unexpected io auth');
    const taken = new Set();
    for (const other of this._live(['ioauthed'])) {
      for (const row of other.ioauth.inputs) taken.add(inputKey(row));
      taken.add(other.ioauth.coinjoinScriptHex);
      taken.add(other.ioauth.changeScriptHex);
    }
    const problem = await this._checkMakerInputs(ioauth, taken);
    if (problem) {
      this._drop(maker, problem);
      return [];
    }
    try {
      coinjoin.makerChange({
        inputSats: ioauth.inputs.reduce((t, r) => t + r.valueSats, 0),
        amountSats: this._state.amountSats,
        cjfeeSats: coinjoin.makerFee(maker.offer, this._state.amountSats),
        txFeeContributionSats: maker.offer.txFeeContributionSats
      });
    } catch (err) {
      this._drop(maker, err.message);
      return [];
    }
    maker.ioauth = ioauth;
    maker.stage = 'ioauthed';
    return [];
  }

  /** @private */
  async _checkMakerInputs (ioauth, taken) {
    if (taken.has(ioauth.coinjoinScriptHex) || taken.has(ioauth.changeScriptHex)) return 'reuses another maker\'s script';
    for (const row of ioauth.inputs) {
      if (taken.has(inputKey(row))) return `input ${inputKey(row)} offered by another maker`;
      if (this.settings.requireOwnership && !coinjoin.verifyOwnership({ roundId: this._state.roundId, input: row })) {
        return `no ownership proof for ${inputKey(row)}`;
      }
      let utxo;
      try {
        utxo = await this.adapters.bitcoin.getTxOut(row.txid, row.vout);
      } catch (err) {
        return `cannot look up ${inputKey(row)}: ${err.message}`;
      }
      if (!utxo) return `input ${inputKey(row)} is spent or unknown`;
      if (Number(utxo.valueSats) !== row.valueSats || String(utxo.scriptPubKeyHex).toLowerCase() !== row.scriptPubKeyHex) {
        return `input ${inputKey(row)} does not match the chain`;
      }
      if (Number(utxo.confirmations) < this.settings.minMakerConfs) return `input ${inputKey(row)} is unconfirmed`;
    }
    return null;
  }

  /** @private */
  async _ensureTakerSide (makers, feeRate) {
    if (this._state.takerInputs) return;
    const wallet = this.adapters.wallet;
    const makerInputs = makers.reduce((t, m) => t + m.ioauth.inputs.length, 0);
    const outputs = 2 + (2 * makers.length);
    const fees = makers.reduce((t, m) => t + coinjoin.makerFee(m.offer, this._state.amountSats), 0);
    const vsize = coinjoin.estimateVsize(makerInputs + INPUT_HEADROOM, outputs);
    const amountSats = this._state.amountSats + fees + Math.ceil(vsize * feeRate);
    const inputs = await wallet.selectInputs({ amountSats });
    if (!Array.isArray(inputs) || !inputs.length) throw this._fail('wallet has no coins for the coinjoin');
    this._state.takerInputs = inputs.map((row) => ({
      txid: String(row.txid).toLowerCase(),
      vout: Number(row.vout),
      valueSats: Number(row.valueSats),
      scriptPubKeyHex: String(row.scriptPubKeyHex).toLowerCase()
    }));
    this._state.coinjoinScriptHex = String(await wallet.getNewScript()).toLowerCase();
    this._state.changeScriptHex = String(await wallet.getNewScript()).toLowerCase();
  }

  /** @private */
  async _build (feeRateSatVb) {
    const feeRate = Number(feeRateSatVb != null ? feeRateSatVb : this.settings.feeRateSatVb);
    if (!(feeRate >= this.settings.minFeeRateSatVb && feeRate <= this.settings.maxFeeRateSatVb)) {
      throw this._fail(`feerate ${feeRate} outside [${this.settings.minFeeRateSatVb}, ${this.settings.maxFeeRateSatVb}]`);
    }
    const makers = this._live(['ioauthed', 'built', 'signed']);
    if (makers.length < this.settings.minMakers) throw this._fail(`only ${makers.length} makers left, need ${this.settings.minMakers}`);
    await this._ensureTakerSide(makers, feeRate);
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    const built = coinjoin.buildCoinjoinPsbt({
      networkName: this.settings.network,
      amountSats: this._state.amountSats,
      feeRateSatVb: feeRate,
      lockTime: tip,
      minMakers: this.settings.minMakers,
      taker: {
        inputs: this._state.takerInputs,
        coinjoinScriptHex: this._state.coinjoinScriptHex,
        changeScriptHex: this._state.changeScriptHex
      },
      makers: makers.map((m) => ({
        id: m.fillId,
        offer: m.offer,
        inputs: m.ioauth.inputs,
        coinjoinScriptHex: m.ioauth.coinjoinScriptHex,
        changeScriptHex: m.ioauth.changeScriptHex
      }))
    });
    this._state.psbt = built.psbtBase64;
    this._state.plan = built.plan;
    this._state.unsignedTxid = built.unsignedTxid;
    const now = this.settings.now();
    return makers.map((m) => {
      m.stage = 'built';
      m.sig = null;
      m.txSentAt = now;
      return this._send(m, {
        type: coinjoin.BODY_TYPES.TX,
        roundId: this._state.roundId,
        takerPubkey: this.takerPubkey,
        psbt: built.psbtBase64,
        createdAt: now
      });
    });
  }

  /**
   * Build the transaction from the makers that have sent their inputs; the
   * rest are dropped.
   * @param {Object} [opts]
   * @param {number} [opts.feeRateSatVb]
   * @returns {Promise<Object[]>} `CoinjoinTx` envelopes
   */
  async buildTx (opts = {}) {
    this._expect([TAKER_STATES.AUTHED]);
    for (const m of this._live()) {
      if (m.stage !== 'ioauthed') this._drop(m, 'did not send inputs in time');
    }
    const out = await this._build(opts.feeRateSatVb);
    this._transition(TAKER_STATES.BUILT, { makers: out.length, unsignedTxid: this._state.unsignedTxid });
    return out;
  }

  /** @private */
  _onSig (maker, sig) {
    this._expect([TAKER_STATES.BUILT]);
    if (maker.stage !== 'built') throw this._fail('unexpected signature');
    let signedTxid;
    try {
      signedTxid = coinjoin.unsignedTxid(sig.psbt);
    } catch {
      signedTxid = null;
    }
    // A late answer to a transaction since rebuilt: wait for the current one.
    if (signedTxid && signedTxid !== this._state.unsignedTxid) return [];
    try {
      this._state.psbt = coinjoin.mergeMakerSignatures(this._state.psbt, sig.psbt, maker.ioauth.inputs);
    } catch (err) {
      this._drop(maker, `bad signature: ${err.message}`);
      return [];
    }
    maker.sig = sig;
    maker.stage = 'signed';
    if (!this._live(['built']).length) this._transition(TAKER_STATES.SIGNED, { unsignedTxid: this._state.unsignedTxid });
    return [];
  }

  /**
   * Makers that have not answered in time at their current stage.
   * @returns {Object[]} `{ makerPubkey, fillId, stage }`
   */
  timedOut () {
    const now = this.settings.now();
    const out = [];
    for (const m of this._live()) {
      const waitingInputs = ['filled', 'authed'].includes(m.stage) && now - m.sentAt >= this.settings.ackTimeoutMs;
      const waitingSig = m.stage === 'built' && m.txSentAt != null && now - m.txSentAt >= this.settings.sigTimeoutMs;
      if (waitingInputs || waitingSig) out.push({ makerPubkey: m.offer.makerPubkey, fillId: m.fillId, stage: m.stage });
    }
    return out;
  }

  /**
   * Drop makers and send a new transaction to the rest. Without `drop`,
   * the makers whose signature is overdue are dropped.
   * @param {Object} [opts]
   * @param {string[]} [opts.drop] maker keys or fill ids
   * @param {number} [opts.feeRateSatVb]
   * @returns {Promise<Object[]>} `CoinjoinTx` envelopes
   */
  async rebuild (opts = {}) {
    this._expect([TAKER_STATES.BUILT, TAKER_STATES.SIGNED]);
    if (this._state.rebuilds >= this.settings.maxRebuilds) throw this._fail('too many rebuilds');
    const drop = new Set((opts.drop || this.timedOut().map((t) => t.fillId)).map((k) => String(k).toLowerCase()));
    let dropped = 0;
    for (const m of this._live()) {
      if (drop.has(m.fillId) || drop.has(m.offer.makerPubkey)) {
        this._drop(m, 'dropped on rebuild');
        dropped++;
      }
    }
    if (!dropped && opts.feeRateSatVb == null) throw this._fail('nothing to rebuild');
    this._state.rebuilds++;
    const out = await this._build(opts.feeRateSatVb);
    this._transition(TAKER_STATES.BUILT, { rebuild: this._state.rebuilds, makers: out.length, unsignedTxid: this._state.unsignedTxid });
    return out;
  }

  /**
   * Check the transaction against the plan, sign the taker's inputs, and broadcast.
   * @returns {Promise<{ txid: string, txHex: string, feeSats: number, vsize: number }>}
   */
  async finalize () {
    this._expect([TAKER_STATES.SIGNED]);
    const check = coinjoin.validateCoinjoinForTaker({
      psbtBase64: this._state.psbt,
      plan: this._state.plan,
      minFeeRateSatVb: this.settings.minFeeRateSatVb,
      maxFeeRateSatVb: this.settings.maxFeeRateSatVb
    });
    if (!check.ok) throw this._fail(`transaction failed the final check: ${check.reason}`);
    const signed = await this.adapters.wallet.signPsbt(this._state.psbt);
    if (coinjoin.unsignedTxid(signed) !== this._state.unsignedTxid) throw this._fail('wallet changed the transaction');
    let merged = signed;
    for (const m of this._live(['signed'])) {
      merged = coinjoin.mergeMakerSignatures(merged, this._state.psbt, m.ioauth.inputs);
    }
    const final = coinjoin.finalizeCoinjoin(merged);
    const txid = await this.adapters.bitcoin.broadcast(final.txHex);
    if (txid && String(txid) !== final.txid) throw this._fail(`node returned txid ${txid}, expected ${final.txid}`);
    this._state.txid = final.txid;
    this._state.txHex = final.txHex;
    this._transition(TAKER_STATES.BROADCAST, { txid: final.txid });
    return final;
  }

  /**
   * Give up on the round and release the taker's coins.
   * @param {string} [reason]
   */
  async abort (reason = 'aborted') {
    this._expect([TAKER_STATES.NEW, TAKER_STATES.FILLED, TAKER_STATES.AUTHED, TAKER_STATES.BUILT, TAKER_STATES.SIGNED]);
    if (this._state.takerInputs && typeof this.adapters.wallet.releaseInputs === 'function') {
      try {
        await this.adapters.wallet.releaseInputs(this._state.takerInputs);
      } catch (err) {
        this.emit('debug', `[COINJOIN] release failed: ${err.message}`);
      }
    }
    this._transition(TAKER_STATES.ABORTED, { reason: String(reason) });
  }

  /**
   * JSON for persistence. The round key is included only with `includeSecrets`.
   * @param {Object} [opts]
   * @param {boolean} [opts.includeSecrets=false]
   * @returns {Object}
   */
  toJSON (opts = {}) {
    const s = this._state;
    const out = {
      type: 'CoinjoinTakerRound',
      version: 1,
      network: this.settings.network,
      roundId: s.roundId,
      takerPubkey: this.takerPubkey,
      status: s.status,
      amountSats: s.amountSats,
      podle: s.podle,
      makers: [...s.makers.values()].map((m) => Object.assign({}, m)),
      takerInputs: s.takerInputs,
      coinjoinScriptHex: s.coinjoinScriptHex,
      changeScriptHex: s.changeScriptHex,
      psbt: s.psbt,
      plan: s.plan,
      unsignedTxid: s.unsignedTxid,
      rebuilds: s.rebuilds,
      txid: s.txid,
      txHex: s.txHex,
      history: s.history.slice()
    };
    if (opts && opts.includeSecrets) out.roundKey = this._roundKey.toString('hex');
    return out;
  }

  /**
   * @param {Object} json {@link CoinjoinTakerRound#toJSON} with secrets
   * @param {Object} settings constructor settings (adapters, …)
   * @returns {CoinjoinTakerRound}
   */
  static fromJSON (json, settings = {}) {
    if (!json || json.type !== 'CoinjoinTakerRound') throw new Error('CoinjoinTakerRound: not a saved taker round');
    if (!Object.prototype.hasOwnProperty.call(TAKER_TRANSITIONS, json.status)) throw new Error(`CoinjoinTakerRound: unknown state ${json.status}`);
    const roundKey = settings.roundKey || json.roundKey;
    if (!roundKey) throw new Error('CoinjoinTakerRound: the round key is required to restore a round');
    const round = new CoinjoinTakerRound(Object.assign({ network: json.network }, settings, {
      amountSats: json.amountSats,
      roundId: json.roundId,
      roundKey
    }));
    if (round.takerPubkey !== json.takerPubkey) throw new Error('CoinjoinTakerRound: round key does not match the saved round');
    Object.assign(round._state, {
      status: json.status,
      podle: json.podle || null,
      makers: new Map((json.makers || []).map((m) => [m.fillId, Object.assign({}, m)])),
      takerInputs: json.takerInputs || null,
      coinjoinScriptHex: json.coinjoinScriptHex || null,
      changeScriptHex: json.changeScriptHex || null,
      psbt: json.psbt || null,
      plan: json.plan || null,
      unsignedTxid: json.unsignedTxid || null,
      rebuilds: Number(json.rebuilds) || 0,
      txid: json.txid || null,
      txHex: json.txHex || null,
      history: Array.isArray(json.history) ? json.history.slice() : []
    });
    return round;
  }

  /**
   * Chain adapter over `services/bitcoin` (bitcoind JSON-RPC).
   * @param {Object} service a `Bitcoin` service instance
   * @returns {Object} `{ getTipHeight, getTxOut, broadcast }`
   */
  static bitcoinAdapter (service) {
    const rpc = (method, params = []) => service._makeRPCRequest(method, params);
    return {
      async getTipHeight () {
        return Number(await rpc('getblockcount'));
      },
      async getTxOut (txid, vout) {
        const out = await rpc('gettxout', [txid, Number(vout), false]);
        if (!out) return null;
        return {
          valueSats: Math.round(Number(out.value) * 1e8),
          scriptPubKeyHex: out.scriptPubKey && out.scriptPubKey.hex,
          confirmations: Number(out.confirmations) || 0
        };
      },
      async broadcast (txHex) {
        return rpc('sendrawtransaction', [txHex]);
      }
    };
  }

  /**
   * Wallet adapter over a bitcoind descriptor wallet holding `tr()` coins.
   * Coins are locked while a round holds them. PoDLE keys are derived from
   * the wallet's private descriptors, so the wallet must not be watch-only.
   * @param {Object} service a `Bitcoin` service instance
   * @param {Object} [options]
   * @param {string} [options.wallet] named wallet (default: the node's default wallet)
   * @param {Function} [options.usedIndexes] `(txid, vout) => number[]` PoDLE indexes already used
   * @returns {Object} `{ selectInputs, releaseInputs, getNewScript, signPsbt, podleCandidates, privateKeyFor }`
   */
  static walletAdapter (service, options = {}) {
    const wallet = options.wallet;
    const call = (method, params = []) => (wallet
      ? service._makeWalletRequest(method, params, wallet)
      : service._makeRPCRequest(method, params));
    const usedIndexes = typeof options.usedIndexes === 'function' ? options.usedIndexes : () => [];
    const unspent = async (minConfs) => {
      const rows = await call('listunspent', [minConfs, 9999999, [], false]);
      return (rows || [])
        .filter((u) => u.spendable !== false && u.solvable !== false && /^5120[0-9a-f]{64}$/.test(String(u.scriptPubKey || '')))
        .map((u) => ({
          txid: u.txid,
          vout: Number(u.vout),
          valueSats: Math.round(Number(u.amount) * 1e8),
          scriptPubKeyHex: u.scriptPubKey,
          confirmations: Number(u.confirmations) || 0,
          address: u.address
        }));
    };
    const adapter = {
      async selectInputs ({ amountSats }) {
        const rows = await unspent(1);
        const target = Number(amountSats);
        const single = rows.filter((r) => r.valueSats >= target).sort((a, b) => a.valueSats - b.valueSats)[0];
        let picked = single ? [single] : [];
        if (!single) {
          let total = 0;
          for (const r of rows.sort((a, b) => b.valueSats - a.valueSats)) {
            picked.push(r);
            total += r.valueSats;
            if (total >= target) break;
          }
          if (total < target) picked = [];
        }
        if (!picked.length) throw new Error(`wallet cannot cover ${target} sats with P2TR coins`);
        await call('lockunspent', [false, picked.map((r) => ({ txid: r.txid, vout: r.vout }))]);
        return picked;
      },
      async releaseInputs (inputs) {
        await call('lockunspent', [true, inputs.map((r) => ({ txid: r.txid, vout: Number(r.vout) }))]);
      },
      async getNewScript () {
        const address = await call('getnewaddress', ['', 'bech32m']);
        const info = await call('getaddressinfo', [address]);
        return info.scriptPubKey;
      },
      async signPsbt (psbtBase64) {
        const result = await call('walletprocesspsbt', [psbtBase64, true, 'DEFAULT', true, false]);
        return result.psbt;
      },
      async privateKeyFor (address) {
        const info = await call('getaddressinfo', [address]);
        const listed = await call('listdescriptors', [true]);
        return descriptorPrivateKey(info, (listed && listed.descriptors) || []);
      },
      async podleCandidates ({ amountSats, minAgeConfs, minValuePct }) {
        const rows = (await unspent(minAgeConfs))
          .filter((r) => r.valueSats * 100 >= Number(amountSats) * Number(minValuePct))
          .sort((a, b) => b.valueSats - a.valueSats);
        const out = [];
        for (const r of rows) {
          const used = usedIndexes(r.txid, r.vout) || [];
          if (podle.nextIndex(used) == null) continue;
          let key;
          try {
            key = await adapter.privateKeyFor(r.address);
          } catch {
            continue;
          }
          out.push(Object.assign({ internalPrivateKey: key, usedIndexes: used }, r));
          if (out.length >= 3) break;
        }
        return out;
      }
    };
    return adapter;
  }
}

/**
 * Internal private key for a wallet address, from bitcoind `getaddressinfo`
 * and `listdescriptors true` output (`tr(…/*)` descriptors only).
 * @param {Object} info `getaddressinfo` result
 * @param {Object[]} descriptors `listdescriptors true` `descriptors`
 * @returns {Buffer}
 */
function descriptorPrivateKey (info, descriptors) {
  const keyPath = String(info && info.hdkeypath || '');
  if (!/^m(\/\d+['h]?)+$/.test(keyPath)) throw new Error('address has no HD key path');
  const pattern = /^tr\((?:\[([0-9a-f]{8})((?:\/\d+['h]?)*)\])?([1-9A-HJ-NP-Za-km-z]{100,120})((?:\/\d+['h]?)*)\/\*\)/;
  const norm = (path) => path.replace(/h/g, "'");
  for (const row of descriptors) {
    const match = pattern.exec(String(row.desc || ''));
    if (!match) continue;
    const [, fingerprint, originPath = '', xprv] = match;
    if (fingerprint && info.hdmasterfingerprint && fingerprint !== String(info.hdmasterfingerprint).toLowerCase()) continue;
    const prefix = `m${norm(originPath)}`;
    const full = norm(keyPath);
    if (!full.startsWith(`${prefix}/`) && full !== prefix) continue;
    let node;
    try {
      node = bip32.fromBase58(xprv);
    } catch {
      continue;
    }
    if (!node.privateKey) continue;
    for (const seg of full.slice(prefix.length).split('/').filter(Boolean)) {
      const hardened = seg.endsWith("'");
      const index = Number(hardened ? seg.slice(0, -1) : seg);
      node = node.derive(hardened ? index + 0x80000000 : index);
    }
    const priv = Buffer.from(node.privateKey);
    if (info.scriptPubKey && coinjoin.taprootKeyPath(priv).scriptPubKeyHex !== String(info.scriptPubKey).toLowerCase()) continue;
    return priv;
  }
  throw new Error('no private tr() descriptor derives this address');
}

/**
 * The maker's side of one fill.
 */
class CoinjoinMakerRound extends RoundBase {
  /**
   * @param {Object} settings
   * @param {Object} settings.offer the maker's signed `CoinjoinOffer`
   * @param {Buffer|string} settings.identityKey private key of `offer.makerPubkey`
   * @param {Object} settings.adapters `{ bitcoin, wallet }`
   * @param {Object} [settings.blacklist] shared `PodleBlacklist` (commitments already used)
   * @param {Buffer|string} [settings.sealKey] (generated when omitted)
   * @param {number} [settings.podleMinAgeConfs=5]
   * @param {number} [settings.podleMinValuePct=20]
   * @param {number} [settings.minEqualOutputs=2]
   * @param {number} [settings.maxSigns=4] signatures for rebuilt transactions in one round
   * @param {Function} [settings.now]
   */
  constructor (settings = {}) {
    super('CoinjoinMakerRound', MAKER_TRANSITIONS, Object.assign({
      podleMinAgeConfs: podle.DEFAULT_MIN_AGE_CONFS,
      podleMinValuePct: podle.DEFAULT_MIN_VALUE_PCT,
      minEqualOutputs: coinjoin.DEFAULT_MIN_EQUAL_OUTPUTS,
      maxSigns: DEFAULT_MAX_SIGNS
    }, settings));
    if (!this.adapters.bitcoin || !this.adapters.wallet) throw new Error('CoinjoinMakerRound: adapters.bitcoin and adapters.wallet are required');
    const v = coinjoin.verifyBody(settings.offer);
    if (!v.ok || v.body.type !== coinjoin.BODY_TYPES.OFFER) throw new Error(`CoinjoinMakerRound: invalid offer (${v.reason || 'not a CoinjoinOffer'})`);
    this.offer = v.body;
    this.offerId = v.id;
    this._identityKey = privBuffer(settings.identityKey, 'identityKey');
    if (coinjoin.pubkeyFromPrivate(this._identityKey) !== this.offer.makerPubkey) throw new Error('CoinjoinMakerRound: identityKey does not match the offer');
    this._sealKey = settings.sealKey ? privBuffer(settings.sealKey, 'sealKey') : coinjoin.randomPrivateKey();
    this.sealPubkey = coinjoin.pubkeyFromPrivate(this._sealKey);
    this.blacklist = settings.blacklist || new podle.PodleBlacklist();
    this._state = {
      status: MAKER_STATES.NEW,
      roundId: null,
      fill: null,
      fillId: null,
      inputs: null,
      coinjoinScriptHex: null,
      changeScriptHex: null,
      signs: 0,
      signedTxids: [],
      history: []
    };
  }

  static get STATES () { return MAKER_STATES; }
  static get TRANSITIONS () { return MAKER_TRANSITIONS; }

  /** @returns {string|null} */
  get roundId () { return this._state.roundId; }
  /** @returns {string|null} */
  get fillId () { return this._state.fillId; }
  /** @returns {string} x-only key later round messages are sealed to */
  get sealXOnly () { return xOnly(this.sealPubkey); }
  /** @returns {Object[]|null} the maker's inputs in this round */
  get inputs () { return this._state.inputs; }

  /** @private */
  _reply (body) {
    const signed = coinjoin.signBody(body, this._identityKey);
    return coinjoin.sealRoundMessage(signed, this._state.fill.takerPubkey);
  }

  /** @private */
  _open (envelope) {
    let opened = coinjoin.openRoundMessage(envelope, this._sealKey);
    if (!opened.ok) opened = coinjoin.openRoundMessage(envelope, this._identityKey);
    return opened;
  }

  /** @private */
  async _refuse (message) {
    if (this._state.status !== MAKER_STATES.ABORTED) await this.abort(message);
    return this._fail(message);
  }

  /**
   * Open and apply a sealed message from the taker.
   * @param {Object} envelope
   * @returns {Promise<Object|null>} the reply envelope
   */
  async receive (envelope) {
    const opened = this._open(envelope);
    if (!opened.ok) throw this._fail(`unreadable message: ${opened.reason}`);
    const body = opened.body;
    if (this._state.fill) {
      if (body.roundId !== this._state.roundId) throw this._fail('message for another round');
      if (body.takerPubkey !== this._state.fill.takerPubkey) throw this._fail('message not signed by the taker');
    }
    switch (body.type) {
      case coinjoin.BODY_TYPES.FILL: return this._onFill(body);
      case coinjoin.BODY_TYPES.AUTH: return this._onAuth(body);
      case coinjoin.BODY_TYPES.TX: return this._onTx(body);
      default: throw this._fail(`unexpected ${body.type}`);
    }
  }

  /** @private */
  async _onFill (fill) {
    this._expect([MAKER_STATES.NEW]);
    const check = coinjoin.validateFill(this.offer, fill, { now: this.settings.now() });
    if (!check.ok) throw await this._refuse(check.reason);
    if (this.blacklist.has(fill.commitment)) throw await this._refuse('PoDLE commitment already used');
    this._state.fill = fill;
    this._state.fillId = coinjoin.bodyId(fill);
    this._state.roundId = fill.roundId;
    const reply = this._reply({
      type: coinjoin.BODY_TYPES.FILL_ACK,
      offerId: this.offerId,
      roundId: fill.roundId,
      fillId: this._state.fillId,
      makerPubkey: this.offer.makerPubkey,
      sealPubkey: this.sealPubkey,
      createdAt: this.settings.now()
    });
    this._transition(MAKER_STATES.ACKED);
    return reply;
  }

  /** @private */
  async _onAuth (auth) {
    this._expect([MAKER_STATES.ACKED]);
    if (auth.fillId !== this._state.fillId) throw this._fail('auth for another fill');
    const fill = this._state.fill;
    const proof = podle.verifyPodle({ commitment: fill.commitment, reveal: auth.reveal });
    if (!proof.ok) throw await this._refuse(`bad PoDLE: ${proof.reason}`);
    let utxo;
    try {
      utxo = await this.adapters.bitcoin.getTxOut(auth.reveal.txid, auth.reveal.vout);
    } catch (err) {
      throw this._fail(`cannot look up the PoDLE UTXO: ${err.message}`);
    }
    const backed = podle.checkPodleUtxo({
      reveal: auth.reveal,
      utxo,
      amountSats: fill.amountSats,
      minAgeConfs: this.settings.podleMinAgeConfs,
      minValuePct: this.settings.podleMinValuePct
    });
    if (!backed.ok) throw await this._refuse(`PoDLE UTXO refused: ${backed.reason}`);
    if (!this.blacklist.add(fill.commitment)) throw await this._refuse('PoDLE commitment already used');
    this.emit('commitment', { commitment: fill.commitment });

    const wallet = this.adapters.wallet;
    const inputs = await wallet.selectInputs({ amountSats: fill.amountSats + this.offer.txFeeContributionSats });
    this._state.inputs = inputs.map((row) => ({
      txid: String(row.txid).toLowerCase(),
      vout: Number(row.vout),
      valueSats: Number(row.valueSats),
      scriptPubKeyHex: String(row.scriptPubKeyHex).toLowerCase()
    }));
    this._state.coinjoinScriptHex = String(await wallet.getNewScript()).toLowerCase();
    this._state.changeScriptHex = String(await wallet.getNewScript()).toLowerCase();
    const rows = [];
    for (const row of this._state.inputs) {
      const out = Object.assign({}, row);
      if (typeof wallet.signOwnership === 'function') {
        out.ownershipSig = await wallet.signOwnership({ roundId: this._state.roundId, input: row });
      }
      rows.push(out);
    }
    const reply = this._reply({
      type: coinjoin.BODY_TYPES.IOAUTH,
      roundId: this._state.roundId,
      fillId: this._state.fillId,
      makerPubkey: this.offer.makerPubkey,
      inputs: rows,
      coinjoinScriptHex: this._state.coinjoinScriptHex,
      changeScriptHex: this._state.changeScriptHex,
      createdAt: this.settings.now()
    });
    this._transition(MAKER_STATES.IOAUTHED);
    return reply;
  }

  /** @private */
  async _onTx (txBody) {
    this._expect([MAKER_STATES.IOAUTHED, MAKER_STATES.SIGNED]);
    if (this._state.signs >= this.settings.maxSigns) throw await this._refuse('too many rebuilt transactions');
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    const check = coinjoin.validateCoinjoinForMaker({
      psbtBase64: txBody.psbt,
      amountSats: this._state.fill.amountSats,
      offer: this.offer,
      inputs: this._state.inputs,
      coinjoinScriptHex: this._state.coinjoinScriptHex,
      changeScriptHex: this._state.changeScriptHex,
      minEqualOutputs: this.settings.minEqualOutputs,
      lockTimeMax: tip + LOCKTIME_SLACK_BLOCKS
    });
    if (!check.ok) throw await this._refuse(`transaction refused: ${check.reason}`);
    const unsignedTxid = coinjoin.unsignedTxid(txBody.psbt);
    const signed = await this.adapters.wallet.signPsbt(txBody.psbt);
    if (coinjoin.unsignedTxid(signed) !== unsignedTxid) throw await this._refuse('wallet changed the transaction');
    // The wallet signs every input it can spend: a taker who slipped in
    // another of this wallet's coins must not get a signature for it.
    const before = coinjoin.describeCoinjoinPsbt(txBody.psbt).inputs;
    const after = coinjoin.describeCoinjoinPsbt(signed).inputs;
    const foreign = after.some((row, i) => row.signed && !before[i].signed && !check.inputIndexes.includes(i));
    if (foreign) throw await this._refuse('transaction spends wallet coins the maker did not offer');
    // Reply with the maker's own signatures only (no wallet derivation paths).
    const psbt = coinjoin.mergeMakerSignatures(txBody.psbt, signed, this._state.inputs);
    this._state.signs++;
    this._state.signedTxids.push(unsignedTxid);
    const reply = this._reply({
      type: coinjoin.BODY_TYPES.SIG,
      roundId: this._state.roundId,
      fillId: this._state.fillId,
      makerPubkey: this.offer.makerPubkey,
      psbt,
      createdAt: this.settings.now()
    });
    this._transition(MAKER_STATES.SIGNED, { unsignedTxid });
    return reply;
  }

  /**
   * Leave the round and release the maker's coins. After signing, a coin can
   * still be spent by the signed transaction; the wallet keeps it locked
   * until it is spent elsewhere or the caller unlocks it.
   * @param {string} [reason]
   */
  async abort (reason = 'aborted') {
    this._expect([MAKER_STATES.NEW, MAKER_STATES.ACKED, MAKER_STATES.IOAUTHED, MAKER_STATES.SIGNED]);
    const signedSomething = this._state.signs > 0;
    if (this._state.inputs && !signedSomething && typeof this.adapters.wallet.releaseInputs === 'function') {
      try {
        await this.adapters.wallet.releaseInputs(this._state.inputs);
      } catch (err) {
        this.emit('debug', `[COINJOIN] release failed: ${err.message}`);
      }
    }
    this._transition(MAKER_STATES.ABORTED, { reason: String(reason) });
  }

  /**
   * JSON for persistence. The seal key is included only with `includeSecrets`;
   * the identity key never is.
   * @param {Object} [opts]
   * @param {boolean} [opts.includeSecrets=false]
   * @returns {Object}
   */
  toJSON (opts = {}) {
    const s = this._state;
    const out = {
      type: 'CoinjoinMakerRound',
      version: 1,
      offer: this.offer,
      offerId: this.offerId,
      sealPubkey: this.sealPubkey,
      status: s.status,
      roundId: s.roundId,
      fill: s.fill,
      fillId: s.fillId,
      inputs: s.inputs,
      coinjoinScriptHex: s.coinjoinScriptHex,
      changeScriptHex: s.changeScriptHex,
      signs: s.signs,
      signedTxids: s.signedTxids.slice(),
      history: s.history.slice()
    };
    if (opts && opts.includeSecrets) out.sealKey = this._sealKey.toString('hex');
    return out;
  }

  /**
   * @param {Object} json {@link CoinjoinMakerRound#toJSON} with secrets
   * @param {Object} settings constructor settings (identityKey, adapters, blacklist, …)
   * @returns {CoinjoinMakerRound}
   */
  static fromJSON (json, settings = {}) {
    if (!json || json.type !== 'CoinjoinMakerRound') throw new Error('CoinjoinMakerRound: not a saved maker round');
    if (!Object.prototype.hasOwnProperty.call(MAKER_TRANSITIONS, json.status)) throw new Error(`CoinjoinMakerRound: unknown state ${json.status}`);
    const sealKey = settings.sealKey || json.sealKey;
    if (!sealKey) throw new Error('CoinjoinMakerRound: the seal key is required to restore a round');
    const round = new CoinjoinMakerRound(Object.assign({}, settings, { offer: json.offer, sealKey }));
    if (round.sealPubkey !== json.sealPubkey) throw new Error('CoinjoinMakerRound: seal key does not match the saved round');
    Object.assign(round._state, {
      status: json.status,
      roundId: json.roundId || null,
      fill: json.fill || null,
      fillId: json.fillId || null,
      inputs: json.inputs || null,
      coinjoinScriptHex: json.coinjoinScriptHex || null,
      changeScriptHex: json.changeScriptHex || null,
      signs: Number(json.signs) || 0,
      signedTxids: Array.isArray(json.signedTxids) ? json.signedTxids.slice() : [],
      history: Array.isArray(json.history) ? json.history.slice() : []
    });
    return round;
  }
}

/**
 * Whose round an envelope belongs to: the x-only key it is sealed to.
 * @param {Object} envelope
 * @returns {string|null}
 */
function envelopeRecipient (envelope) {
  return envelope && envelope.type === coinjoin.SEALED_TYPE && /^[0-9a-f]{64}$/.test(String(envelope.to || '')) ? envelope.to : null;
}

/**
 * Test helper: a wallet adapter over in-memory P2TR coins and their keys.
 * @param {Object} opts
 * @param {Object[]} opts.coins `{ txid, vout, valueSats, internalPrivateKey, confirmations }`
 * @param {string} [opts.network='regtest']
 * @returns {Object} wallet adapter (plus `coins`, `locked`)
 */
function memoryWallet (opts = {}) {
  const coins = (opts.coins || []).map((c) => Object.assign({
    scriptPubKeyHex: coinjoin.taprootKeyPath(c.internalPrivateKey).scriptPubKeyHex,
    confirmations: 10
  }, c));
  const locked = new Set();
  const keys = [];
  return {
    coins,
    locked,
    async selectInputs ({ amountSats }) {
      const free = coins.filter((c) => !locked.has(inputKey(c))).sort((a, b) => b.valueSats - a.valueSats);
      const picked = [];
      let total = 0;
      for (const c of free) {
        picked.push(c);
        total += c.valueSats;
        if (total >= amountSats) break;
      }
      if (total < amountSats) throw new Error('memory wallet: insufficient funds');
      picked.forEach((c) => locked.add(inputKey(c)));
      return picked.map((c) => ({ txid: c.txid, vout: c.vout, valueSats: c.valueSats, scriptPubKeyHex: c.scriptPubKeyHex }));
    },
    async releaseInputs (inputs) {
      inputs.forEach((c) => locked.delete(inputKey(c)));
    },
    async getNewScript () {
      const key = coinjoin.randomPrivateKey();
      keys.push(key);
      return coinjoin.taprootKeyPath(key, opts.network).scriptPubKeyHex;
    },
    async signPsbt (psbtBase64) {
      return coinjoin.signKeyPathInputs(psbtBase64, coins.map((c) => c.internalPrivateKey)).psbtBase64;
    },
    async signOwnership ({ roundId, input }) {
      const coin = coins.find((c) => inputKey(c) === inputKey(input));
      return coinjoin.signOwnership({ roundId, txid: input.txid, vout: input.vout, internalPrivateKey: coin.internalPrivateKey });
    },
    async podleCandidates ({ amountSats, minAgeConfs, minValuePct }) {
      return coins
        .filter((c) => c.confirmations >= minAgeConfs && c.valueSats * 100 >= amountSats * minValuePct)
        .map((c) => Object.assign({ usedIndexes: c.usedIndexes || [] }, c));
    }
  };
}

/**
 * Test helper: a chain adapter over a map of unspent outputs.
 * @param {Object} opts
 * @param {Map} opts.utxos `txid:vout` → `{ valueSats, scriptPubKeyHex, confirmations }`
 * @param {Object} opts.tip `{ height }`
 * @returns {Object} chain adapter (plus `broadcasts`)
 */
function memoryChain (opts = {}) {
  const utxos = opts.utxos || new Map();
  const tip = opts.tip || { height: 1000 };
  const broadcasts = [];
  return {
    utxos,
    tip,
    broadcasts,
    async getTipHeight () { return tip.height; },
    async getTxOut (txid, vout) { return utxos.get(`${txid}:${vout}`) || null; },
    async broadcast (txHex) {
      const tx = bitcoin.Transaction.fromHex(txHex);
      for (const input of tx.ins) {
        const key = `${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`;
        if (!utxos.has(key)) throw new Error(`missing or spent input ${key}`);
      }
      for (const input of tx.ins) utxos.delete(`${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`);
      broadcasts.push(txHex);
      return tx.getId();
    }
  };
}

module.exports = CoinjoinTakerRound;
module.exports.CoinjoinTakerRound = CoinjoinTakerRound;
module.exports.CoinjoinMakerRound = CoinjoinMakerRound;
module.exports.TAKER_STATES = TAKER_STATES;
module.exports.MAKER_STATES = MAKER_STATES;
module.exports.descriptorPrivateKey = descriptorPrivateKey;
module.exports.envelopeRecipient = envelopeRecipient;
module.exports.memoryWallet = memoryWallet;
module.exports.memoryChain = memoryChain;
