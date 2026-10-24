'use strict';

/**
 * @fileoverview Beacon — L1-tied epoch chain that seals sidechain / contracts digests.
 *
 * Regtest: `createEpoch()` mines one block (`generatetoaddress`) then appends
 * a `BEACON_EPOCH` entry. Non-regtest: `recordEpochFromBlock` follows tips.
 *
 * Hub product wiring lives in hub.fabric.pub `contracts/beacon.js` (extends this
 * type). Ready-round retry finalize is implemented here so Hub and CLI share it.
 *
 * Federation rounds seal in clock order: a round seals only directly on top of
 * the sealed tip (`clock === tip.clock + 1`, higher L1 height). Rounds above a
 * reorg, rounds left below the sealed tip, and rounds older than
 * `federationRoundTtlMs` are cancelled (`federation:round-cancelled`); late
 * signatures for them are refused.
 */

const merge = require('lodash.merge');

const Actor = require('./actor');
const Message = require('./message');
const Chain = require('./chain');
const beaconFederationSigning = require('../functions/beaconFederationSigning');
const bls = require('../functions/bls');
const Federation = require('./federation');

const SATS_PER_BTC = 100_000_000;
const BEACON_CHAIN_PATH = 'beacon/CHAIN';
const MAX_REMEMBERED_CANCELLED_ROUNDS = 1024;

/**
 * @param {object} round
 * @returns {number}
 * @private
 */
function roundClock (round) {
  return Number(round && round.payload ? round.payload.clock : NaN);
}

/**
 * @param {object} round
 * @returns {number}
 * @private
 */
function roundHeight (round) {
  return Number(round && round.payload ? round.payload.height : NaN);
}

/**
 * Result of {@link Beacon#adoptFederationSignRequest}.
 * @typedef {Object} FederationRoundAdoption
 * @memberof Beacon
 * @property {boolean} ok
 * @property {Object} [round] the pending round (adopted or already held)
 * @property {boolean} [created] whether this call created the round
 * @property {string} [error] why the request was refused
 */

/**
 * Result of {@link Beacon#signPendingFederationRoundAsLocalValidator}.
 * @typedef {Object} FederationRoundSignature
 * @memberof Beacon
 * @property {boolean} ok
 * @property {Object} [response] `FederationSignResponse` body to gossip
 * @property {Object} [submit] result of submitting the signature locally
 * @property {string} [error] why the round could not be signed
 */

class Beacon extends Actor {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.interval=60000] regtest epoch interval in ms (0 = none)
   * @param {boolean} [settings.regtest=true] mine epochs; false follows L1 tips only
   * @param {boolean} [settings.mineOnStart=true] mine one epoch on start (regtest)
   * @param {string[]} [settings.federationValidators] pubkeys (compressed or x-only hex) that witness
   * epochs; stored lowercase compressed, one per signing key
   * @param {number|null} [settings.federationThreshold=null] k (clamped to the distinct validators,
   * with a `warning`); null = strict majority of validators
   * @param {string} [settings.federationSignatureScheme='schnorr'] `schnorr` or `bls`
   * @param {boolean} [settings.federationWitnessFailClosed=true] truncate the stored chain at the first epoch without k valid witnesses
   * @param {number} [settings.federationRoundTtlMs=3600000] cancel a pending round (and the rounds
   * above it) this long after it opened; 0 = never
   * @param {number} [settings.maxReorgDepth=100] most epochs walked back looking for the fork point
   * @param {boolean} [settings.followBlocks=false] follow bitcoind `block` events on regtest
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      name: 'FABRIC:BEACON',
      debug: false,
      interval: 60000,
      regtest: true,
      // When false, start() does not mine an initial epoch (regtest).
      mineOnStart: true,
      federationValidators: [],
      // k-of-n; null = strict majority of federationValidators.
      federationThreshold: null,
      federationSignatureScheme: 'schnorr',
      federationWitnessFailClosed: true,
      federationRoundTtlMs: 60 * 60 * 1000,
      maxReorgDepth: 100,
      // When true (or when federation validators are set), also follow bitcoind
      // `block` events on regtest so every validator advances from local L1 tips.
      followBlocks: false
    }, settings);

    this.bitcoin = null;
    this.fs = null;
    this.key = null;
    this.timer = null;
    this._blockHandler = null;
    this._blockQueue = null;
    this._bitcoinChainInfo = null;
    this._epochChain = Chain.create({ consensus: 'federation' });
    this._federationValidators = Federation.normalizeValidators(this.settings.federationValidators);
    this._federationThresholdSetting = this.settings.federationThreshold;
    this._federationSignatureScheme = bls.normalizeSignatureScheme(this.settings.federationSignatureScheme);
    this._getSidechainSnapshotForEpoch = null;
    this._getContractsSnapshotForEpoch = null;
    this._pendingEpochRounds = new Map();
    this._cancelledEpochRounds = new Map();
    this._drainingRounds = false;
    this._state = {
      content: {
        clock: 0,
        status: 'STOPPED',
        lastBlockHash: null,
        height: 0,
        balance: 0,
        balanceSats: 0
      }
    };

    return this;
  }

  /**
   * Live epoch state: `clock`, `status`, `lastBlockHash`, `height`, `balance`, `balanceSats`.
   * Tracks the newest epoch recorded, which may still be a pending federation round.
   * @type {Object}
   */
  get state () {
    return this._state.content;
  }

  /**
   * k for epoch witnesses: the configured threshold (clamped to the distinct
   * validators), else a strict majority.
   * @returns {number}
   * @private
   */
  get _federationThreshold () {
    return Federation.resolveThreshold(this._federationThresholdSetting, this._federationValidators);
  }

  get merkleRoot () {
    return this._computeMerkleRoot();
  }

  getEpochChainSummary () {
    const last = this._epochChain.tip;
    return {
      length: this._epochChain.height,
      last: last
        ? {
          payload: last.payload,
          federationWitness: last.federationWitness || null
        }
        : null
    };
  }

  /**
   * @param {Object} [deps]
   * @param {Object} [deps.bitcoin]
   * @param {Object} [deps.fs]
   * @param {Object} [deps.key]
   * @param {Array.<string>} [deps.federationValidators]
   * @param {number|null} [deps.federationThreshold] `null` resets to the strict-majority default
   * @param {string} [deps.federationSignatureScheme] `schnorr` (default) or `bls`
   * @param {function(): (Object|null)} [deps.getSidechainSnapshotForEpoch]
   * @param {function(): (Object|null)} [deps.getContractsSnapshotForEpoch]
   */
  attach (deps = {}) {
    if (deps.bitcoin) this.bitcoin = deps.bitcoin;
    if (deps.fs) this.fs = deps.fs;
    if (deps.key) this.key = deps.key;
    if (Array.isArray(deps.federationValidators)) {
      this._federationValidators = Federation.normalizeValidators(deps.federationValidators);
    }
    if (deps.federationThreshold !== undefined) {
      this._federationThresholdSetting = deps.federationThreshold;
    }
    if (Array.isArray(deps.federationValidators) || deps.federationThreshold !== undefined) {
      this._warnIfThresholdClamped();
    }
    if (deps.federationSignatureScheme != null) {
      this._federationSignatureScheme = bls.normalizeSignatureScheme(deps.federationSignatureScheme);
      this.settings.federationSignatureScheme = this._federationSignatureScheme;
    }
    if (deps.federationWitnessFailClosed != null) {
      this.settings.federationWitnessFailClosed = deps.federationWitnessFailClosed !== false;
    }
    if (deps.followBlocks != null) {
      this.settings.followBlocks = !!deps.followBlocks;
    }
    if (typeof deps.getSidechainSnapshotForEpoch === 'function') {
      this._getSidechainSnapshotForEpoch = deps.getSidechainSnapshotForEpoch;
    }
    if (typeof deps.getContractsSnapshotForEpoch === 'function') {
      this._getContractsSnapshotForEpoch = deps.getContractsSnapshotForEpoch;
    }
    return this;
  }

  getFederationPolicy () {
    return {
      validators: this._federationValidators.slice(),
      threshold: this._federationThreshold,
      signatureScheme: this._federationSignatureScheme
    };
  }

  /**
   * @private
   */
  _warnIfThresholdClamped () {
    if (!Federation.thresholdExceedsValidators(this._federationThresholdSetting, this._federationValidators)) return;
    const n = Federation.uniqueValidatorPubkeys(this._federationValidators).length;
    this.emit('warning', `[BEACON] federationThreshold ${this._federationThresholdSetting} exceeds the ${n} distinct federation validators; using ${n}`);
  }

  /**
   * @param {string} pubkey
   * @returns {boolean}
   * @private
   */
  _isFederationValidator (pubkey) {
    return !!Federation.findValidatorEntry(this._federationValidators, pubkey);
  }

  _compressedPubkeyHex () {
    if (!this.key || !this.key.public || typeof this.key.public.encodeCompressed !== 'function') {
      return null;
    }
    try {
      return this.key.public.encodeCompressed('hex');
    } catch (_) {
      return null;
    }
  }

  /** @deprecated Hub alias — use {@link Beacon#_compressedPubkeyHex} */
  _hubCompressedPubkeyHex () {
    return this._compressedPubkeyHex();
  }

  _mergeSidechainIntoEpoch (epoch) {
    const out = { ...epoch };
    if (typeof this._getSidechainSnapshotForEpoch === 'function') {
      try {
        const snap = this._getSidechainSnapshotForEpoch();
        if (snap && typeof snap === 'object') {
          out.sidechain = {
            clock: Number(snap.clock) || 0,
            stateDigest: snap.stateDigest != null ? String(snap.stateDigest) : null
          };
        }
      } catch (err) {
        this.emit('warning', '[BEACON] sidechain snapshot failed:', err && err.message ? err.message : err);
      }
    }
    if (typeof this._getContractsSnapshotForEpoch === 'function') {
      try {
        const snap = this._getContractsSnapshotForEpoch();
        if (snap && typeof snap === 'object') {
          const merkle = snap.merkleRoot != null ? String(snap.merkleRoot) : null;
          const digest = snap.stateDigest != null ? String(snap.stateDigest) : merkle;
          out.contracts = {
            clock: Number(snap.clock) || 0,
            stateDigest: digest,
            merkleRoot: merkle || digest,
            kind: snap.kind || 'TrackedApplicationContracts',
            acceptedCount: Number.isFinite(snap.acceptedCount) ? Number(snap.acceptedCount) : undefined
          };
        }
      } catch (err) {
        this.emit('warning', '[BEACON] contracts snapshot failed:', err && err.message ? err.message : err);
      }
    }
    if (this._federationValidators.length) {
      return beaconFederationSigning.canonicalEpochForFederation(out);
    }
    return out;
  }

  _makeFederationWitnessForEpoch (epochPayload) {
    if (!this._federationValidators.length) return null;
    if (!this.key || !this.key.private) return null;
    const pk = this._compressedPubkeyHex();
    const member = pk ? Federation.findValidatorEntry(this._federationValidators, pk) : null;
    if (!member) return null;
    const msg = Buffer.from(beaconFederationSigning.signingStringForBeaconEpoch(epochPayload), 'utf8');
    if (this._federationSignatureScheme === bls.SCHEME_BLS) {
      try {
        const bundle = bls.createFederationBlsBundle(msg, this.key);
        return {
          version: 1,
          scheme: bls.SCHEME_BLS,
          signatures: { [member]: bundle }
        };
      } catch (_) {
        return null;
      }
    }
    let sig;
    try {
      sig = this.key.signSchnorr(msg);
    } catch (_) {
      return null;
    }
    return {
      version: 1,
      signatures: { [member]: Buffer.isBuffer(sig) ? sig.toString('hex') : String(sig) }
    };
  }

  _buildEpochEntry (epochBase, witnessOverride = null) {
    const fullEpoch = this._mergeSidechainIntoEpoch(epochBase);
    const message = Message.fromVector(['BEACON_EPOCH', JSON.stringify(fullEpoch)]);
    if (this.key && this.key.private) message.signWithKey(this.key);
    const entry = { type: 'BEACON_EPOCH', payload: fullEpoch, id: message.id || null };
    const witness = witnessOverride || this._makeFederationWitnessForEpoch(fullEpoch);
    if (witness) entry.federationWitness = witness;
    return entry;
  }

  /**
   * Append one epoch exactly as committed (no snapshot re-read).
   * @param {object} payload
   * @param {object|null} witness
   * @returns {object} the appended entry
   * @private
   */
  _appendSealedEpoch (payload, witness = null) {
    const message = Message.fromVector(['BEACON_EPOCH', JSON.stringify(payload)]);
    if (this.key && this.key.private) message.signWithKey(this.key);
    const entry = { type: 'BEACON_EPOCH', payload, id: message.id || null };
    if (witness) entry.federationWitness = witness;
    this._epochChain.append(entry);
    return entry;
  }

  /**
   * @returns {object|null} payload of the newest sealed epoch
   * @private
   */
  _sealedTipPayload () {
    const tip = this._epochChain.tip;
    return tip && tip.payload ? tip.payload : null;
  }

  /**
   * Set live state from the sealed tip (zero state on an empty chain), then
   * from the newest pending round above it so its clock stays reserved.
   * @private
   */
  _restoreStateFromTip () {
    const s = this._state.content;
    const tip = this._sealedTipPayload();
    s.clock = tip && tip.clock != null ? (Number(tip.clock) || 0) : 0;
    s.lastBlockHash = tip ? (tip.blockHash || null) : null;
    s.height = tip && tip.height != null ? (Number(tip.height) || 0) : 0;
    s.balance = tip && tip.balance != null ? tip.balance : 0;
    s.balanceSats = tip && tip.balanceSats != null ? tip.balanceSats : 0;
    const rounds = this._pendingRoundsByClock();
    const top = rounds.length ? rounds[rounds.length - 1] : null;
    if (top && roundClock(top) > s.clock && roundHeight(top) > s.height) {
      s.clock = roundClock(top);
      s.lastBlockHash = top.payload.blockHash || null;
      s.height = roundHeight(top);
    }
  }

  /**
   * @returns {object[]} in-memory pending rounds, lowest clock first
   * @private
   */
  _pendingRoundsByClock () {
    return [...this._pendingEpochRounds.values()]
      .filter((r) => r && r.payload)
      .sort((a, b) => roundClock(a) - roundClock(b));
  }

  /**
   * @returns {boolean}
   * @private
   */
  _canQueryBitcoin () {
    return !!(this.bitcoin && typeof this.bitcoin._makeRPCRequest === 'function');
  }

  /**
   * Whether `blockHash` is the best-chain block at `height`. RPC failures throw.
   * @param {number} height
   * @param {string} blockHash
   * @param {number|null} [bestHeight] known best height (saves a `getblockcount`)
   * @returns {Promise<boolean>}
   * @private
   */
  async _blockOnBestChain (height, blockHash, bestHeight = null) {
    if (!blockHash || !Number.isFinite(height)) return false;
    const best = bestHeight != null
      ? bestHeight
      : Number(await this.bitcoin._makeRPCRequest('getblockcount', []));
    if (!Number.isFinite(best)) throw new Error('[BEACON] getblockcount returned no height');
    if (height > best) return false;
    const at = await this.bitcoin._makeRPCRequest('getblockhash', [height]);
    return at != null && String(at) === String(blockHash);
  }

  /**
   * @param {string} digest
   * @param {string} reason
   * @private
   */
  _rememberCancelledRound (digest, reason) {
    this._cancelledEpochRounds.delete(digest);
    this._cancelledEpochRounds.set(digest, reason);
    while (this._cancelledEpochRounds.size > MAX_REMEMBERED_CANCELLED_ROUNDS) {
      this._cancelledEpochRounds.delete(this._cancelledEpochRounds.keys().next().value);
    }
  }

  /**
   * Remove matching rounds from memory and the pending store, remember them so
   * late signatures are refused, and emit `federation:round-cancelled` for each.
   * Does not touch live state; callers restore it.
   * @param {function(object): boolean} predicate
   * @param {string} reason `reorg` | `orphaned` | `stale` | `expired` | `invalid`
   * @returns {object[]} cancelled rounds
   * @private
   */
  _cancelPendingRounds (predicate, reason) {
    const cancelled = new Map();
    for (const [digest, round] of this._pendingEpochRounds) {
      if (!predicate(round)) continue;
      this._pendingEpochRounds.delete(digest);
      cancelled.set(digest, round);
    }
    const doc = beaconFederationSigning.loadPendingDoc(this.fs);
    let changed = false;
    for (const digest of Object.keys(doc.rounds)) {
      if (!cancelled.has(digest)) {
        if (!predicate(doc.rounds[digest])) continue;
        cancelled.set(digest, doc.rounds[digest]);
      }
      delete doc.rounds[digest];
      changed = true;
    }
    if (changed) {
      beaconFederationSigning.persistPendingDoc(this.fs, doc).catch((err) => {
        this.emit('warning', '[BEACON] Failed to persist cancelled epoch rounds:', err && err.message ? err.message : err);
      });
    }
    for (const [digest, round] of cancelled) {
      this._rememberCancelledRound(digest, reason);
      const p = (round && round.payload) || {};
      this.emit('federation:round-cancelled', {
        commitmentDigest: digest,
        clock: p.clock != null ? p.clock : null,
        height: p.height != null ? p.height : null,
        blockHash: p.blockHash || null,
        reason
      });
    }
    return [...cancelled.values()];
  }

  /**
   * @param {number} minHeight
   * @param {string} reason
   * @returns {object[]}
   * @private
   */
  _cancelRoundsFromHeight (minHeight, reason) {
    return this._cancelPendingRounds((r) => roundHeight(r) >= minHeight, reason);
  }

  /**
   * Cancel `round` and restore live state. A round that can no longer seal
   * blocks every round above it, so `expired` / `orphaned` take those too.
   * @param {object} round
   * @param {string} reason
   * @private
   */
  _cancelRoundForReason (round, reason) {
    const clock = roundClock(round);
    const digest = round && round.commitmentDigest;
    const cascade = (reason === 'expired' || reason === 'orphaned') && Number.isFinite(clock);
    this._cancelPendingRounds((r) => r === round ||
      (digest != null && r && r.commitmentDigest === digest) ||
      (cascade && roundClock(r) >= clock), reason);
    this._restoreStateFromTip();
  }

  /**
   * @param {object} round
   * @param {number} [now]
   * @returns {boolean}
   * @private
   */
  _roundExpired (round, now = Date.now()) {
    const ttl = Number(this.settings.federationRoundTtlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) return false;
    const opened = Date.parse(round && round.createdAt);
    return Number.isFinite(opened) && now - opened > ttl;
  }

  /**
   * Why a pending round must be cancelled, or null while it can still seal.
   * @param {string} digest
   * @param {object} round
   * @returns {string|null}
   * @private
   */
  _roundCancelReason (digest, round) {
    if (!round || !round.payload) return 'invalid';
    if (this._epochAlreadySealed(digest, round)) return null;
    const tip = this._sealedTipPayload();
    if (tip && (!(roundHeight(round) > Number(tip.height)) || !(roundClock(round) > Number(tip.clock)))) {
      return 'stale';
    }
    if (this._roundExpired(round)) return 'expired';
    return null;
  }

  /**
   * Whether `round` may seal now: directly above the sealed tip, or the
   * lowest pending clock on an empty chain.
   * @param {object} round
   * @returns {{ ok: boolean, reason: (string|undefined) }}
   * @private
   */
  _roundSealable (round) {
    const clock = roundClock(round);
    const height = roundHeight(round);
    if (!Number.isFinite(clock) || !Number.isFinite(height)) return { ok: false, reason: 'stale' };
    const tip = this._sealedTipPayload();
    if (tip) {
      if (!(height > Number(tip.height)) || !(clock > Number(tip.clock))) return { ok: false, reason: 'stale' };
      if (clock !== Number(tip.clock) + 1) return { ok: false, reason: 'out-of-order' };
      return { ok: true };
    }
    for (const other of this._pendingEpochRounds.values()) {
      if (other !== round && roundClock(other) < clock) return { ok: false, reason: 'out-of-order' };
    }
    return { ok: true };
  }

  /**
   * Find a pending round in memory or the pending store, cancelling it when it
   * can no longer seal.
   * @param {string} digest
   * @returns {{ round: (object|null|undefined), cancelled: (string|undefined) }}
   * @private
   */
  _lookupPendingRound (digest) {
    if (!digest) return { round: null };
    if (this._cancelledEpochRounds.has(digest)) {
      return { cancelled: this._cancelledEpochRounds.get(digest) };
    }
    let round = this._pendingEpochRounds.get(digest) || null;
    if (!round) {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      round = doc.rounds[digest] || null;
      if (!round) return { round: null };
      this._pendingEpochRounds.set(digest, round);
    }
    const reason = this._roundCancelReason(digest, round);
    if (reason) {
      this._cancelRoundForReason(round, reason);
      return { cancelled: reason };
    }
    return { round };
  }

  /**
   * @param {string} digest
   * @param {string} reason
   * @returns {object}
   * @private
   */
  _cancelledRoundResult (digest, reason) {
    return {
      status: 'error',
      cancelled: true,
      reason,
      commitmentDigest: digest,
      message: `epoch round cancelled (${reason})`
    };
  }

  /**
   * Cancel rounds that fell below the sealed tip or outlived the TTL.
   * @private
   */
  _sweepPendingRounds () {
    for (const round of this._pendingRoundsByClock()) {
      const digest = round.commitmentDigest;
      if (!this._pendingEpochRounds.has(digest)) continue;
      const reason = this._roundCancelReason(digest, round);
      if (reason) this._cancelRoundForReason(round, reason);
    }
  }

  async _commitEpochWithFederation (epochBase) {
    const fullEpoch = this._mergeSidechainIntoEpoch(epochBase);

    if (!this._federationValidators.length) {
      const entry = this._appendSealedEpoch(fullEpoch, null);
      await this._persistEpochChain();
      return entry.payload;
    }

    const localWitness = this._makeFederationWitnessForEpoch(fullEpoch);
    const round = beaconFederationSigning.createRound(
      fullEpoch,
      {
        validators: this._federationValidators,
        threshold: this._federationThreshold,
        signatureScheme: this._federationSignatureScheme
      },
      localWitness
    );

    if (round.status === 'ready' && this._roundSealable(round).ok) {
      const entry = this._appendSealedEpoch(round.payload, round.witness);
      await this._persistEpochChain();
      return entry.payload;
    }

    this._cancelledEpochRounds.delete(round.commitmentDigest);
    this._pendingEpochRounds.set(round.commitmentDigest, round);
    try {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      doc.rounds[round.commitmentDigest] = round;
      await beaconFederationSigning.persistPendingDoc(this.fs, doc);
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to persist pending epoch round:', err && err.message ? err.message : err);
    }

    const signRequest = beaconFederationSigning.encodeSignRequest(round);
    this.emit('federation:sign-request', signRequest);
    return {
      pending: true,
      commitmentDigest: round.commitmentDigest,
      payload: round.payload,
      signRequest
    };
  }

  async submitFederationEpochSignature (commitmentDigest, pubkey, signatureHex) {
    const digest = String(commitmentDigest || '').trim();
    const found = this._lookupPendingRound(digest);
    if (found.cancelled) return this._cancelledRoundResult(digest, found.cancelled);
    const round = found.round;
    if (!round) {
      return { status: 'error', message: 'unknown pending epoch round' };
    }

    // addSignature marks the round `ready` before durable persist. A crash or
    // persist failure then makes retries hit `round not open`. Finalize the
    // existing ready round instead of reopening it for new signatures.
    if (round.status === 'ready' || round.status === 'sealed') {
      if (!this._recoveredRoundWitnessOk(digest, round)) {
        return { status: 'error', message: 'recovered round failed federation threshold' };
      }
      return this._finalizeReadyFederationRound(digest, round);
    }

    const added = beaconFederationSigning.addSignature(round, pubkey, signatureHex);
    if (!added.ok) {
      if (added.error === 'round not open') {
        const again = this._pendingEpochRounds.get(digest);
        if (again && (again.status === 'ready' || again.status === 'sealed')) {
          if (!this._recoveredRoundWitnessOk(digest, again)) {
            return { status: 'error', message: 'recovered round failed federation threshold' };
          }
          return this._finalizeReadyFederationRound(digest, again);
        }
      }
      return { status: 'error', message: added.error || 'signature rejected' };
    }

    this._pendingEpochRounds.set(digest, round);
    try {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      doc.rounds[digest] = round;
      await beaconFederationSigning.persistPendingDoc(this.fs, doc);
    } catch (_) { /* ignore */ }

    if (!added.sealed) {
      return {
        status: 'success',
        pending: true,
        commitmentDigest: digest,
        signatureCount: Object.keys(round.witness.signatures || {}).length,
        threshold: round.threshold
      };
    }

    return this._finalizeReadyFederationRound(digest, round);
  }

  /**
   * Ready/sealed rounds loaded from disk must still satisfy the round witness
   * and, when this Beacon has federation validators, those configured keys —
   * not an attacker-emptied `round.validators` list.
   * @param {string} digest
   * @param {object} round
   * @returns {boolean}
   * @private
   */
  _recoveredRoundWitnessOk (digest, round) {
    if (this._epochAlreadySealed(digest, round)) return true;
    if (!this._federationValidators.length) return false;
    if (!beaconFederationSigning.roundMeetsThreshold(round)) return false;
    return beaconFederationSigning.verifyFederationWitnessOnMessage(
      beaconFederationSigning.messageBufferForPayload(round.payload),
      round.witness,
      this._federationValidators,
      this._federationThreshold,
      undefined,
      { allowLegacy: false }
    );
  }

  /**
   * Drop a round that is on the epoch chain from memory and the pending store.
   * @param {string} digest
   * @param {object} round
   * @returns {Promise<object>}
   * @private
   */
  async _finishAlreadySealedRound (digest, round) {
    const persisted = await this._persistEpochChain();
    if (!persisted) {
      return {
        status: 'error',
        pending: true,
        message: 'failed to persist epoch chain',
        commitmentDigest: digest
      };
    }
    this._pendingEpochRounds.delete(digest);
    try {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      delete doc.rounds[digest];
      await beaconFederationSigning.persistPendingDoc(this.fs, doc);
    } catch (_) { /* ignore */ }
    return {
      status: 'success',
      sealed: true,
      commitmentDigest: digest,
      payload: round.payload,
      federationWitness: round.witness
    };
  }

  /**
   * Persist a threshold-ready round onto the epoch chain. Idempotent if the
   * digest is already sealed. A round that is not directly above the sealed tip
   * stays `ready` and seals once the rounds below it do; a round whose block
   * left the best chain (checked when Bitcoin RPC is attached) is cancelled.
   * @param {string} digest
   * @param {object} round
   * @returns {Promise<object>}
   * @private
   */
  async _finalizeReadyFederationRound (digest, round) {
    if (this._epochAlreadySealed(digest, round)) return this._finishAlreadySealedRound(digest, round);
    if (this._cancelledEpochRounds.has(digest)) {
      return this._cancelledRoundResult(digest, this._cancelledEpochRounds.get(digest));
    }

    let order = this._roundSealable(round);
    if (order.ok && this._canQueryBitcoin()) {
      let onBest;
      try {
        onBest = await this._blockOnBestChain(roundHeight(round), round.payload.blockHash);
      } catch (err) {
        return {
          status: 'error',
          pending: true,
          commitmentDigest: digest,
          message: 'unable to confirm the epoch block is on the best chain: ' + (err && err.message ? err.message : err)
        };
      }
      if (!onBest) {
        this._cancelRoundForReason(round, 'orphaned');
        return this._cancelledRoundResult(digest, 'orphaned');
      }
      // The RPC yielded: re-check against whatever changed meanwhile.
      if (this._cancelledEpochRounds.has(digest)) {
        return this._cancelledRoundResult(digest, this._cancelledEpochRounds.get(digest));
      }
      if (this._epochAlreadySealed(digest, round)) return this._finishAlreadySealedRound(digest, round);
      order = this._roundSealable(round);
    }
    if (!order.ok) {
      if (order.reason === 'stale') {
        this._cancelRoundForReason(round, 'stale');
        return this._cancelledRoundResult(digest, 'stale');
      }
      return {
        status: 'success',
        pending: true,
        ready: true,
        commitmentDigest: digest,
        message: 'threshold met; waiting for the epoch below it to seal',
        signatureCount: Object.keys((round.witness && round.witness.signatures) || {}).length,
        threshold: round.threshold
      };
    }

    const entry = this._appendSealedEpoch(round.payload, round.witness);
    const persisted = await this._persistEpochChain();
    if (!persisted) {
      return {
        status: 'error',
        pending: true,
        message: 'failed to persist epoch chain',
        commitmentDigest: digest,
        payload: round.payload,
        federationWitness: round.witness
      };
    }

    this._pendingEpochRounds.delete(digest);
    try {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      delete doc.rounds[digest];
      await beaconFederationSigning.persistPendingDoc(this.fs, doc);
    } catch (_) { /* ignore */ }

    this.emit('epoch', entry.payload);
    await this._drainReadyFederationRounds();
    return {
      status: 'success',
      sealed: true,
      commitmentDigest: digest,
      payload: entry.payload,
      federationWitness: entry.federationWitness
    };
  }

  /**
   * Seal ready rounds that now sit directly above the sealed tip, in clock order.
   * @returns {Promise<void>}
   * @private
   */
  async _drainReadyFederationRounds () {
    if (this._drainingRounds) return;
    this._drainingRounds = true;
    try {
      for (;;) {
        const next = this._pendingRoundsByClock().find((r) =>
          r.status === 'ready' && this._roundSealable(r).ok);
        if (!next || !this._recoveredRoundWitnessOk(next.commitmentDigest, next)) break;
        const result = await this._finalizeReadyFederationRound(next.commitmentDigest, next);
        if (!result || !result.sealed) break;
      }
    } finally {
      this._drainingRounds = false;
    }
  }

  /**
   * @param {string} digest
   * @param {object} round
   * @returns {boolean}
   * @private
   */
  _epochAlreadySealed (digest, round) {
    try {
      const msgs = typeof this._epochChain.toBeaconMessages === 'function'
        ? this._epochChain.toBeaconMessages()
        : [];
      const clock = round && round.payload ? round.payload.clock : null;
      return msgs.some((e) => {
        if (!e || !e.payload) return false;
        // The digest commits to the clock, so only same-clock epochs can match.
        if (clock != null && Number(e.payload.clock) !== Number(clock)) return false;
        try {
          return beaconFederationSigning.epochCommitmentDigestHex(e.payload) === digest;
        } catch (_) {
          return clock != null && e.payload.clock === clock;
        }
      });
    } catch (_) {
      return false;
    }
  }

  /**
   * Summaries of the epoch rounds still collecting witnesses.
   * @returns {Object[]} `commitmentDigest`, `clock`, `height`, `blockHash`, `signatureCount`,
   * `threshold`, `validators`, `status`, `createdAt` per round
   */
  listPendingFederationEpochRounds () {
    const out = [];
    for (const round of this._pendingEpochRounds.values()) {
      out.push({
        commitmentDigest: round.commitmentDigest,
        clock: round.payload && round.payload.clock,
        height: round.payload && round.payload.height,
        blockHash: round.payload && round.payload.blockHash,
        signatureCount: Object.keys((round.witness && round.witness.signatures) || {}).length,
        threshold: round.threshold,
        validators: round.validators,
        status: round.status,
        createdAt: round.createdAt
      });
    }
    return out;
  }

  /**
   * Adopt a peer {@link FederationSignRequest} into the pending map when the
   * commitment digest matches the epoch body. Validators use this so each node
   * can accumulate BIP340 signatures over the same deterministic payload.
   * Refuses rounds this node cancelled and epochs at or below its sealed tip.
   *
   * @param {object} signRequest
   * @returns {Promise<Beacon.FederationRoundAdoption>}
   */
  async adoptFederationSignRequest (signRequest) {
    if (!signRequest || typeof signRequest !== 'object') {
      return { ok: false, error: 'signRequest required' };
    }
    // Fail closed: never adopt attacker-chosen validators/threshold when local
    // Federation policy is unset (empty request validators sealed immediately).
    if (!this._federationValidators.length) {
      return { ok: false, error: 'no federation validators configured' };
    }
    const epoch = signRequest.epoch;
    if (!epoch || typeof epoch !== 'object') {
      return { ok: false, error: 'epoch required' };
    }
    const digest = String(signRequest.commitmentDigest || '').trim();
    if (!digest) return { ok: false, error: 'commitmentDigest required' };
    const computed = beaconFederationSigning.epochCommitmentDigestHex(epoch);
    if (computed !== digest) {
      return { ok: false, error: 'commitmentDigest mismatch' };
    }
    const requestedScheme = signRequest.signatureScheme != null
      ? bls.normalizeSignatureScheme(signRequest.signatureScheme)
      : null;
    if (requestedScheme && requestedScheme !== this._federationSignatureScheme) {
      return { ok: false, error: 'federation signature scheme mismatch' };
    }

    const found = this._lookupPendingRound(digest);
    if (found.cancelled) return { ok: false, error: `epoch round cancelled (${found.cancelled})` };
    if (found.round) {
      return { ok: true, round: found.round, created: false };
    }

    const canonical = beaconFederationSigning.canonicalEpochForFederation(epoch);
    if (this._roundCancelReason(digest, { commitmentDigest: digest, payload: canonical }) === 'stale') {
      return { ok: false, error: 'epoch is not above the sealed tip' };
    }

    const validators = this._federationValidators.slice();
    const threshold = this._federationThreshold;

    const round = beaconFederationSigning.createRound(epoch, {
      validators,
      threshold,
      signatureScheme: this._federationSignatureScheme
    });
    this._pendingEpochRounds.set(digest, round);
    try {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      doc.rounds[digest] = round;
      await beaconFederationSigning.persistPendingDoc(this.fs, doc);
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to persist adopted epoch round:', err && err.message ? err.message : err);
    }
    return { ok: true, round, created: true };
  }

  /**
   * Sign the pending round as this Beacon's identity key (must be a validator).
   * Returns a {@link FederationSignResponse} body ready to gossip.
   *
   * @param {string} commitmentDigest
   * @returns {Promise<Beacon.FederationRoundSignature>}
   */
  async signPendingFederationRoundAsLocalValidator (commitmentDigest) {
    const digest = String(commitmentDigest || '').trim();
    if (!digest) return { ok: false, error: 'commitmentDigest required' };
    if (!this.key || !this.key.private) {
      return { ok: false, error: 'Beacon has no signing key' };
    }
    const pk = this._compressedPubkeyHex();
    if (!pk) return { ok: false, error: 'unable to encode validator pubkey' };
    if (!this._federationValidators.length) {
      return { ok: false, error: 'no federation validators configured' };
    }
    if (!this._isFederationValidator(pk)) {
      return { ok: false, error: 'local key is not a federation validator' };
    }

    const found = this._lookupPendingRound(digest);
    if (found.cancelled) return { ok: false, error: `epoch round cancelled (${found.cancelled})` };
    const round = found.round;
    if (!round) return { ok: false, error: 'unknown pending epoch round' };

    const msg = beaconFederationSigning.messageBufferForPayload(round.payload);
    const scheme = bls.normalizeSignatureScheme(
      round.signatureScheme || (round.witness && round.witness.scheme) || this._federationSignatureScheme
    );
    if (scheme !== this._federationSignatureScheme) {
      return { ok: false, error: 'federation signature scheme mismatch' };
    }
    let signatureHex;
    try {
      if (scheme === bls.SCHEME_BLS) {
        signatureHex = JSON.stringify(bls.createFederationBlsBundle(msg, this.key));
      } else {
        const sig = this.key.signSchnorr(msg);
        signatureHex = Buffer.isBuffer(sig) ? sig.toString('hex') : String(sig);
      }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'sign failed' };
    }
    const response = beaconFederationSigning.encodeSignResponse(digest, pk, signatureHex);
    const submit = await this.submitFederationEpochSignature(digest, pk, signatureHex);
    return { ok: true, response, submit };
  }

  _verifyEpochWitnessesIfConfigured () {
    if (!this._federationValidators.length) return;
    const result = this._epochChain.verify(
      this._federationValidators,
      this._federationThreshold
    );
    for (const f of result.failures) {
      this.emit('warning', `[BEACON] Federation witness missing or invalid for epoch clock ${f.clock}`);
    }
    if (result.ok) return;

    if (this.settings.federationWitnessFailClosed === false) return;

    const firstBad = result.failures[0];
    const msgs = this._epochChain.toBeaconMessages();
    const idx = msgs.findIndex((e) =>
      e && e.payload && e.payload.clock === firstBad.clock
    );
    if (idx < 0) return;
    this._epochChain.truncateAt(idx);
    this._restoreStateFromTip();
    this.emit('error', new Error(
      `[BEACON] Fail-closed: truncated epoch chain before clock ${firstBad.clock} (${result.failures.length} invalid witness(es))`
    ));
  }

  async _loadEpochChainFromFilesystem () {
    if (!this.fs || typeof this.fs.readFile !== 'function') return;
    try {
      const raw = this.fs.readFile(BEACON_CHAIN_PATH);
      if (!raw) return;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || !Array.isArray(parsed.messages)) return;
      this._epochChain = Chain.fromBeaconMessages(parsed.messages);
      this._restoreStateFromTip();
      this._verifyEpochWitnessesIfConfigured();
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to load epoch chain from filesystem:', err && err.message ? err.message : err);
    }
  }

  /**
   * Load stored pending rounds, dropping ones already sealed and cancelling
   * ones that can no longer seal.
   * @returns {Promise<void>}
   * @private
   */
  async _loadPendingRoundsFromFilesystem () {
    const doc = beaconFederationSigning.loadPendingDoc(this.fs);
    let changed = false;
    for (const digest of Object.keys(doc.rounds)) {
      if (this._pendingEpochRounds.has(digest)) continue;
      const round = doc.rounds[digest];
      if (!round || !round.payload || this._cancelledEpochRounds.has(digest) || this._epochAlreadySealed(digest, round)) {
        delete doc.rounds[digest];
        changed = true;
        continue;
      }
      this._pendingEpochRounds.set(digest, round);
    }
    if (changed) {
      try {
        await beaconFederationSigning.persistPendingDoc(this.fs, doc);
      } catch (err) {
        this.emit('warning', '[BEACON] Failed to persist pending epoch rounds:', err && err.message ? err.message : err);
      }
    }
    this._sweepPendingRounds();
    this._restoreStateFromTip();
  }

  _computeMerkleRoot () {
    return this._epochChain.digest();
  }

  async _persistEpochChain () {
    if (!this.fs || typeof this.fs.publish !== 'function') return true;
    try {
      const messages = this._epochChain.toBeaconMessages();
      const merkle = { root: this._computeMerkleRoot(), leaves: this._epochChain.height };
      await this.fs.publish(BEACON_CHAIN_PATH, { messages, merkle });
      return true;
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to persist epoch chain:', err && err.message ? err.message : err);
      return false;
    }
  }

  /**
   * `getblockchaininfo().chain` of the attached bitcoind, cached per service.
   * @returns {Promise<string>}
   * @private
   */
  async _bitcoinChainName () {
    const cached = this._bitcoinChainInfo;
    if (cached && cached.bitcoin === this.bitcoin) return cached.chain;
    const info = await this.bitcoin._makeRPCRequest('getblockchaininfo', []);
    const chain = info && info.chain != null ? String(info.chain) : '';
    this._bitcoinChainInfo = { bitcoin: this.bitcoin, chain };
    return chain;
  }

  /**
   * Regtest only: mine one block and record its epoch through the same queue
   * (and duplicate checks) as followed blocks, so a block seen both here and
   * via `block` events gets one epoch.
   * @returns {Promise<Object|null>} committed payload, pending result, or null when not recorded
   */
  async createEpoch () {
    if (!this.bitcoin) throw new Error('Beacon has no Bitcoin service attached.');

    const chain = await this._bitcoinChainName();
    if (chain !== 'regtest') {
      throw new Error(`[BEACON] createEpoch mines blocks and only runs against regtest (bitcoind chain: ${chain || 'unknown'})`);
    }
    const address = await this.bitcoin.getUnusedAddress();
    const generated = await this.bitcoin._makeRPCRequest('generatetoaddress', [1, address]);
    const blockHash = Array.isArray(generated) ? generated[0] : generated;
    if (!blockHash) throw new Error('[BEACON] generatetoaddress returned no block; epoch not recorded');
    const height = Number(await this.bitcoin._makeRPCRequest('getblockcount', []));
    return this._enqueueBlockWork(() => this._recordEpochFromBlock({ tip: String(blockHash), height }));
  }

  /**
   * Drop sealed epochs above `inclusiveMaxHeight`, cancel pending rounds above
   * it, and restore live state.
   * @param {number} inclusiveMaxHeight
   * @returns {number} sealed epochs removed
   * @private
   */
  _pruneEpochChain (inclusiveMaxHeight) {
    const maxH = Number(inclusiveMaxHeight);
    if (!Number.isFinite(maxH)) return 0;

    const { pruned, removedBeaconClocks } = this._epochChain.pruneByBeaconHeight(maxH);
    this._cancelRoundsFromHeight(maxH + 1, 'reorg');
    this._restoreStateFromTip();
    if (pruned > 0) this.emit('reorg', { pruned, inclusiveMaxHeight, removedBeaconClocks });
    return pruned;
  }

  /**
   * Drop the tip epoch (another block at the same height won), cancel rounds
   * at or above its height, and restore state.
   * @private
   */
  _dropTipEpoch () {
    const popped = this._epochChain.pop();
    const payload = popped && popped.payload ? popped.payload : null;
    const poppedClock = payload && payload.clock != null ? Number(payload.clock) : null;
    if (payload && payload.height != null) this._cancelRoundsFromHeight(Number(payload.height), 'reorg');
    this._restoreStateFromTip();
    this.emit('reorg', {
      pruned: 1,
      sameHeight: true,
      removedBeaconClocks: poppedClock != null && Number.isFinite(poppedClock) ? [poppedClock] : []
    });
  }

  /**
   * Walk back from the sealed tip while its block is off the best chain
   * (at most `maxReorgDepth` epochs), prune to the fork point, then cancel
   * pending rounds whose blocks left the best chain. RPC failures throw before
   * anything is pruned.
   * @returns {Promise<{ pruned: number, cancelled: number }>}
   * @private
   */
  async _reconcileWithBestChain () {
    if (!this._canQueryBitcoin()) return { pruned: 0, cancelled: 0 };
    const sealed = this._epochChain.toBeaconMessages();
    if (!sealed.length && !this._pendingEpochRounds.size) return { pruned: 0, cancelled: 0 };

    const best = Number(await this.bitcoin._makeRPCRequest('getblockcount', []));
    if (!Number.isFinite(best)) throw new Error('[BEACON] getblockcount returned no height');
    const maxDepth = Math.max(1, Number(this.settings.maxReorgDepth) || 100);

    let keep = sealed.length;
    let walked = 0;
    while (keep > 0) {
      const p = sealed[keep - 1].payload || {};
      const h = Number(p.height);
      if (!p.blockHash || !Number.isFinite(h)) break;
      if (await this._blockOnBestChain(h, p.blockHash, best)) break;
      walked += 1;
      if (walked > maxDepth) {
        throw new Error(`[BEACON] reorg deeper than maxReorgDepth (${maxDepth} epochs); epoch chain left as is`);
      }
      keep -= 1;
    }

    let pruned = 0;
    if (keep < sealed.length) {
      const forkHeight = keep > 0 ? Number(sealed[keep - 1].payload.height) : -1;
      pruned = this._pruneEpochChain(forkHeight);
    }

    const tip = this._sealedTipPayload();
    const tipHeight = tip ? Number(tip.height) : -Infinity;
    let orphanFrom = null;
    for (const round of this._pendingRoundsByClock()) {
      const h = roundHeight(round);
      if (!(h > tipHeight)) continue;
      if (!(await this._blockOnBestChain(h, round.payload.blockHash, best))) {
        orphanFrom = h;
        break;
      }
    }
    let cancelled = 0;
    if (orphanFrom != null) {
      cancelled = this._cancelRoundsFromHeight(orphanFrom, 'orphaned').length;
      this._restoreStateFromTip();
    }
    return { pruned, cancelled };
  }

  /**
   * Record the epoch for one L1 block. Serialized with followed blocks and
   * `createEpoch`, so a block delivered twice gets one epoch.
   * @param {Object} [payload]
   * @param {string} [payload.tip] block hash (looked up from `height` when omitted)
   * @param {number} [payload.height] block height (best height when omitted)
   * @returns {Promise<Object|null>} committed payload, pending result, or null when not recorded
   */
  recordEpochFromBlock (payload = {}) {
    if (!this.bitcoin) return Promise.reject(new Error('Beacon has no Bitcoin service attached.'));
    return this._enqueueBlockWork(() => this._recordEpochFromBlock(payload));
  }

  /**
   * @param {Object} payload
   * @returns {Promise<Object|null>}
   * @private
   */
  async _recordEpochFromBlock (payload = {}) {
    if (!this.bitcoin) throw new Error('Beacon has no Bitcoin service attached.');
    const p = payload || {};

    const height = p.height != null
      ? Number(p.height)
      : Number(await this.bitcoin._makeRPCRequest('getblockcount', []));
    if (!Number.isFinite(height)) throw new Error('[BEACON] block height unavailable; epoch not recorded');
    let blockHash = p.tip || null;
    if (!blockHash) blockHash = await this.bitcoin._makeRPCRequest('getblockhash', [height]);
    if (!blockHash) throw new Error('[BEACON] block hash unavailable; epoch not recorded');
    blockHash = String(blockHash);

    this._sweepPendingRounds();
    await this._drainReadyFederationRounds();

    const s = this._state.content;
    if (height <= s.height && blockHash === s.lastBlockHash) {
      return null;
    }

    if (!(await this._blockOnBestChain(height, blockHash))) {
      this.emit('warning', `[BEACON] Block ${blockHash} at height ${height} is not on the best chain; epoch not recorded`);
      return null;
    }

    if (height < s.height) {
      // A late notification for an older best-chain block: nothing reorged.
      if (await this._blockOnBestChain(s.height, s.lastBlockHash)) return null;
      const pruned = this._pruneEpochChain(height);
      // The prune keeps the epoch (or pending round) at `height`: either this
      // block, or the losing branch's block at that height (handled below).
      if (s.height === height && s.lastBlockHash === blockHash) {
        if (pruned) await this._persistEpochChain();
        return null;
      }
    }
    if (height === s.height && blockHash !== s.lastBlockHash) {
      const tip = this._sealedTipPayload();
      if (tip && Number(tip.height) === height) {
        this._dropTipEpoch();
      } else {
        this._cancelRoundsFromHeight(height, 'reorg');
        this._restoreStateFromTip();
      }
    }

    await this._reconcileWithBestChain();

    const balances = await this.bitcoin._makeRPCRequest('getbalances', []).catch(() => null);
    const trusted = (balances && balances.mine && balances.mine.trusted != null) ? Number(balances.mine.trusted) : 0;
    const balanceSats = Math.round(trusted * SATS_PER_BTC);

    s.clock += 1;
    s.lastBlockHash = blockHash;
    s.height = height;
    s.balance = trusted;
    s.balanceSats = balanceSats;

    // Federation-signed epochs are L1 tip + digests only (deterministic across validators).
    const epoch = this._federationValidators.length
      ? {
        clock: s.clock,
        blockHash: s.lastBlockHash,
        height: s.height
      }
      : {
        clock: s.clock,
        blockHash: s.lastBlockHash,
        height: s.height,
        balance: trusted,
        balanceSats,
        timestamp: new Date().toISOString()
      };

    let committedPayload = epoch;
    try {
      committedPayload = await this._commitEpochWithFederation(epoch);
    } catch (err) {
      this.emit('error', err);
    }

    if (!(committedPayload && committedPayload.pending)) {
      this.emit('epoch', committedPayload);
    }
    return committedPayload;
  }

  /**
   * Follow bitcoind `block` events: when asked, when validators are set, or off regtest.
   * @private
   * @returns {boolean}
   */
  _shouldFollowBitcoinBlocks () {
    if (this.settings.followBlocks === true) return true;
    if (this._federationValidators.length > 0) return true;
    return this.settings.regtest === false;
  }

  /**
   * Restore the epoch chain and pending rounds, prune epochs whose blocks left
   * the best chain, then mine on the interval (regtest) and/or follow L1 tips.
   * Idempotent while running.
   * @returns {Promise<Beacon>}
   */
  async start () {
    if (this._state.content.status === 'RUNNING') return this;
    this._state.content.status = 'RUNNING';

    await this._loadEpochChainFromFilesystem();
    await this._loadPendingRoundsFromFilesystem();
    this._warnIfThresholdClamped();

    if (this._canQueryBitcoin()) {
      await this._enqueueBlockWork(async () => {
        try {
          const result = await this._reconcileWithBestChain();
          if (result.pruned) await this._persistEpochChain();
        } catch (err) {
          this.emit('error', err);
        }
      });
    }

    const isRegtest = this.settings.regtest !== false;
    const followBlocks = this._shouldFollowBitcoinBlocks();

    if (isRegtest) {
      if (this.settings.mineOnStart !== false) {
        try {
          await this.createEpoch();
        } catch (err) {
          this.emit('error', err);
        }
      }
      const interval = Number(this.settings.interval);
      if (Number.isFinite(interval) && interval > 0) {
        this.timer = setInterval(() => {
          this.createEpoch().catch((err) => this.emit('error', err));
        }, interval);
      }
    }

    if (followBlocks) {
      // Listen before priming so a block found during the prime RPCs is queued, not lost.
      this._blockHandler = (payload) => {
        this._enqueueBlockFollow(payload);
      };
      if (this.bitcoin && typeof this.bitcoin.on === 'function') {
        this.bitcoin.on('block', this._blockHandler);
      }
      if (!isRegtest) await this._enqueueBlockFollow(null);
    }

    return this;
  }

  /**
   * Run `work` after every queued block job. The returned promise settles with
   * `work`; the queue itself never rejects.
   * @param {function(): Promise<*>} work
   * @returns {Promise<*>}
   * @private
   */
  _enqueueBlockWork (work) {
    const run = (this._blockQueue || Promise.resolve()).then(() => work());
    this._blockQueue = run.then(() => {}, () => {});
    return run;
  }

  /**
   * Serialize block-follow work so an older tip never finishes after a newer one.
   * Errors are emitted, not thrown.
   * @param {Object|null} payload `{ tip, height }` from Bitcoin, or null to prime from the best tip
   * @returns {Promise<Object|null>}
   * @private
   */
  _enqueueBlockFollow (payload) {
    return this._enqueueBlockWork(async () => {
      try {
        return await this._followBlock(payload);
      } catch (err) {
        this.emit('error', err);
        return null;
      }
    });
  }

  /**
   * Record one followed block. Priming (null payload) reads the best tip when it runs;
   * a delivered tip below the recorded height is stale and skipped only while the best
   * chain still reaches the recorded height and holds that tip, so a reorg to a shorter
   * best chain still reaches the prune path. RPC failures propagate (never prune on a
   * failed lookup).
   * @param {Object|null} payload
   * @returns {Promise<Object|null>}
   * @private
   */
  async _followBlock (payload) {
    if (!this.bitcoin) return null;
    if (!payload) {
      const tip = await this.bitcoin._makeRPCRequest('getbestblockhash', []);
      const height = await this.bitcoin._makeRPCRequest('getblockcount', []);
      return this._recordEpochFromBlock({ tip, height });
    }
    const height = payload.height != null ? Number(payload.height) : null;
    if (height != null && payload.tip && height < this._state.content.height) {
      const bestHeight = Number(await this.bitcoin._makeRPCRequest('getblockcount', []));
      if (bestHeight >= this._state.content.height) {
        const atHeight = await this.bitcoin._makeRPCRequest('getblockhash', [height]);
        if (atHeight && String(atHeight) === String(payload.tip)) return null;
      }
    }
    return this._recordEpochFromBlock(payload);
  }

  /**
   * Stop mining and block following, drain queued blocks, and persist the epoch chain.
   * @returns {Promise<Beacon>}
   */
  async stop () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._blockHandler && this.bitcoin && typeof this.bitcoin.removeListener === 'function') {
      this.bitcoin.removeListener('block', this._blockHandler);
      this._blockHandler = null;
    }
    if (this._blockQueue) await this._blockQueue;
    await this._persistEpochChain();
    this._state.content.status = 'STOPPED';
    return this;
  }
}

Beacon.BEACON_CHAIN_PATH = BEACON_CHAIN_PATH;
Beacon.SATS_PER_BTC = SATS_PER_BTC;

module.exports = Beacon;
