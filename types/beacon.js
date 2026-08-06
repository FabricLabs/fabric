'use strict';

/**
 * Beacon — L1-tied epoch chain that seals sidechain / contracts digests.
 *
 * Regtest: `createEpoch()` mines one block (`generatetoaddress`) then appends
 * a `BEACON_EPOCH` entry. Non-regtest: `recordEpochFromBlock` follows tips.
 *
 * Hub product wiring historically lived in hub.fabric.pub `contracts/beacon.js`;
 * that module re-exports this type.
 */

const merge = require('lodash.merge');

const Actor = require('./actor');
const Message = require('./message');
const Chain = require('./chain');
const beaconFederationSigning = require('../functions/beaconFederationSigning');

const SATS_PER_BTC = 100_000_000;
const BEACON_CHAIN_PATH = 'beacon/CHAIN';

class Beacon extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      name: 'FABRIC:BEACON',
      debug: false,
      interval: 60000,
      regtest: true,
      /** When false, `start()` does not mine an initial epoch (regtest). */
      mineOnStart: true,
      federationValidators: [],
      federationThreshold: 1,
      federationWitnessFailClosed: true
    }, settings);

    this.bitcoin = null;
    this.fs = null;
    this.key = null;
    this.timer = null;
    this._blockHandler = null;
    this._epochChain = Chain.create({ consensus: 'federation' });
    this._federationValidators = Array.isArray(this.settings.federationValidators)
      ? this.settings.federationValidators.slice()
      : [];
    this._federationThreshold = Math.max(1, Number(this.settings.federationThreshold) || 1);
    this._getSidechainSnapshotForEpoch = null;
    this._getContractsSnapshotForEpoch = null;
    this._pendingEpochRounds = new Map();
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

  get state () {
    return this._state.content;
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
   * @param {number} [deps.federationThreshold]
   * @param {function(): (Object|null)} [deps.getSidechainSnapshotForEpoch]
   * @param {function(): (Object|null)} [deps.getContractsSnapshotForEpoch]
   */
  attach (deps = {}) {
    if (deps.bitcoin) this.bitcoin = deps.bitcoin;
    if (deps.fs) this.fs = deps.fs;
    if (deps.key) this.key = deps.key;
    if (Array.isArray(deps.federationValidators)) {
      this._federationValidators = deps.federationValidators.slice();
    }
    if (deps.federationThreshold != null) {
      this._federationThreshold = Math.max(1, Number(deps.federationThreshold) || 1);
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
      threshold: this._federationThreshold
    };
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
          out.contracts = {
            clock: Number(snap.clock) || 0,
            stateDigest: snap.stateDigest != null ? String(snap.stateDigest) : null,
            kind: snap.kind || 'TrackedApplicationContracts',
            acceptedCount: Number.isFinite(snap.acceptedCount) ? Number(snap.acceptedCount) : undefined
          };
        }
      } catch (err) {
        this.emit('warning', '[BEACON] contracts snapshot failed:', err && err.message ? err.message : err);
      }
    }
    return out;
  }

  _makeFederationWitnessForEpoch (epochPayload) {
    if (!this._federationValidators.length) return null;
    if (!this.key || !this.key.private) return null;
    const pk = this._compressedPubkeyHex();
    if (!pk || !this._federationValidators.includes(pk)) return null;
    const msg = Buffer.from(beaconFederationSigning.signingStringForBeaconEpoch(epochPayload), 'utf8');
    let sig;
    try {
      sig = this.key.signSchnorr(msg);
    } catch (_) {
      return null;
    }
    return {
      version: 1,
      signatures: { [pk]: Buffer.isBuffer(sig) ? sig.toString('hex') : String(sig) }
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

  async _commitEpochWithFederation (epochBase) {
    const fullEpoch = this._mergeSidechainIntoEpoch(epochBase);
    const localWitness = this._makeFederationWitnessForEpoch(fullEpoch);

    if (!this._federationValidators.length) {
      const entry = this._buildEpochEntry(epochBase, null);
      this._epochChain.append(entry);
      await this._persistEpochChain();
      return entry.payload;
    }

    const round = beaconFederationSigning.createRound(
      fullEpoch,
      { validators: this._federationValidators, threshold: this._federationThreshold },
      localWitness
    );

    if (beaconFederationSigning.roundMeetsThreshold(round)) {
      const entry = this._buildEpochEntry(epochBase, round.witness);
      this._epochChain.append(entry);
      await this._persistEpochChain();
      return entry.payload;
    }

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
      payload: fullEpoch,
      signRequest
    };
  }

  async submitFederationEpochSignature (commitmentDigest, pubkey, signatureHex) {
    const digest = String(commitmentDigest || '').trim();
    let round = this._pendingEpochRounds.get(digest);
    if (!round) {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      round = doc.rounds[digest] || null;
      if (round) this._pendingEpochRounds.set(digest, round);
    }
    if (!round) {
      return { status: 'error', message: 'unknown pending epoch round' };
    }

    const added = beaconFederationSigning.addSignature(round, pubkey, signatureHex);
    if (!added.ok) {
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

    const message = Message.fromVector(['BEACON_EPOCH', JSON.stringify(round.payload)]);
    if (this.key && this.key.private) message.signWithKey(this.key);
    const entry = {
      type: 'BEACON_EPOCH',
      payload: round.payload,
      id: message.id || null,
      federationWitness: round.witness
    };
    this._epochChain.append(entry);
    await this._persistEpochChain();

    this._pendingEpochRounds.delete(digest);
    try {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      delete doc.rounds[digest];
      await beaconFederationSigning.persistPendingDoc(this.fs, doc);
    } catch (_) { /* ignore */ }

    this.emit('epoch', entry.payload);
    return {
      status: 'success',
      sealed: true,
      commitmentDigest: digest,
      payload: entry.payload,
      federationWitness: entry.federationWitness
    };
  }

  listPendingFederationEpochRounds () {
    const out = [];
    for (const round of this._pendingEpochRounds.values()) {
      out.push({
        commitmentDigest: round.commitmentDigest,
        clock: round.payload && round.payload.clock,
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
    const last = this._epochChain.tip;
    if (last && last.payload) {
      this._state.content.clock = last.payload.clock != null ? last.payload.clock : 0;
      this._state.content.lastBlockHash = last.payload.blockHash || null;
      this._state.content.height = last.payload.height != null ? last.payload.height : 0;
      this._state.content.balance = last.payload.balance != null ? last.payload.balance : 0;
      this._state.content.balanceSats = last.payload.balanceSats != null ? last.payload.balanceSats : 0;
    } else {
      this._state.content.clock = 0;
      this._state.content.lastBlockHash = null;
      this._state.content.height = 0;
      this._state.content.balance = 0;
      this._state.content.balanceSats = 0;
    }
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
      const last = this._epochChain.tip;
      if (last && last.payload && Number.isFinite(last.payload.clock)) {
        this._state.content.clock = last.payload.clock;
        this._state.content.lastBlockHash = last.payload.blockHash || null;
        this._state.content.height = last.payload.height != null ? last.payload.height : 0;
        this._state.content.balance = last.payload.balance != null ? last.payload.balance : 0;
        this._state.content.balanceSats = last.payload.balanceSats != null ? last.payload.balanceSats : 0;
      }
      this._verifyEpochWitnessesIfConfigured();
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to load epoch chain from filesystem:', err && err.message ? err.message : err);
    }
  }

  _computeMerkleRoot () {
    return this._epochChain.digest();
  }

  async _persistEpochChain () {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    try {
      const messages = this._epochChain.toBeaconMessages();
      const merkle = { root: this._computeMerkleRoot(), leaves: this._epochChain.height };
      await this.fs.publish(BEACON_CHAIN_PATH, { messages, merkle });
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to persist epoch chain:', err && err.message ? err.message : err);
    }
  }

  async createEpoch () {
    if (!this.bitcoin) throw new Error('Beacon has no Bitcoin service attached.');

    const address = await this.bitcoin.getUnusedAddress();
    const generated = await this.bitcoin._makeRPCRequest('generatetoaddress', [1, address]);
    const blockHash = Array.isArray(generated) ? generated[0] : generated;
    const height = await this.bitcoin._makeRPCRequest('getblockcount', []);
    const balances = await this.bitcoin._makeRPCRequest('getbalances', []).catch(() => null);
    const trusted = (balances && balances.mine && balances.mine.trusted != null) ? Number(balances.mine.trusted) : 0;
    const balanceSats = Math.round(trusted * SATS_PER_BTC);

    this._state.content.clock += 1;
    this._state.content.lastBlockHash = blockHash || null;
    this._state.content.height = Number(height || 0);
    this._state.content.balance = trusted;
    this._state.content.balanceSats = balanceSats;

    const epoch = {
      clock: this._state.content.clock,
      blockHash: this._state.content.lastBlockHash,
      height: this._state.content.height,
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

  _pruneEpochChain (inclusiveMaxHeight) {
    const maxH = Number(inclusiveMaxHeight);
    if (!Number.isFinite(maxH)) return;

    const { pruned, removedBeaconClocks } = this._epochChain.pruneByBeaconHeight(maxH);
    if (pruned === 0) return;

    const last = this._epochChain.tip;
    if (last && last.payload) {
      this._state.content.clock = last.payload.clock != null ? last.payload.clock : 0;
      this._state.content.lastBlockHash = last.payload.blockHash || null;
      this._state.content.height = last.payload.height != null ? last.payload.height : 0;
      this._state.content.balance = last.payload.balance != null ? last.payload.balance : 0;
      this._state.content.balanceSats = last.payload.balanceSats != null ? last.payload.balanceSats : 0;
    } else {
      this._state.content.clock = 0;
      this._state.content.lastBlockHash = null;
      this._state.content.height = 0;
      this._state.content.balance = 0;
      this._state.content.balanceSats = 0;
    }
    this.emit('reorg', { pruned, inclusiveMaxHeight, removedBeaconClocks });
  }

  async recordEpochFromBlock (payload = {}) {
    if (!this.bitcoin) throw new Error('Beacon has no Bitcoin service attached.');

    const blockHash = payload.tip || null;
    const height = payload.height != null
      ? Number(payload.height)
      : (await this.bitcoin._makeRPCRequest('getblockcount', []));
    const balances = await this.bitcoin._makeRPCRequest('getbalances', []).catch(() => null);
    const trusted = (balances && balances.mine && balances.mine.trusted != null) ? Number(balances.mine.trusted) : 0;
    const balanceSats = Math.round(trusted * SATS_PER_BTC);

    if (height <= this._state.content.height && blockHash === this._state.content.lastBlockHash) {
      return null;
    }

    if (height < this._state.content.height) {
      this._pruneEpochChain(height);
    } else if (height === this._state.content.height && blockHash !== this._state.content.lastBlockHash) {
      const popped = this._epochChain.pop();
      const poppedClock = popped && popped.payload && popped.payload.clock != null
        ? Number(popped.payload.clock)
        : null;
      const last = this._epochChain.tip;
      if (last && last.payload) {
        this._state.content.clock = last.payload.clock != null ? last.payload.clock : 0;
        this._state.content.lastBlockHash = last.payload.blockHash || null;
        this._state.content.height = last.payload.height != null ? last.payload.height : 0;
        this._state.content.balance = last.payload.balance != null ? last.payload.balance : 0;
        this._state.content.balanceSats = last.payload.balanceSats != null ? last.payload.balanceSats : 0;
      } else if (!this._epochChain.height) {
        this._state.content.clock = 0;
        this._state.content.lastBlockHash = null;
        this._state.content.height = 0;
        this._state.content.balance = 0;
        this._state.content.balanceSats = 0;
      }
      this.emit('reorg', {
        pruned: 1,
        sameHeight: true,
        removedBeaconClocks: poppedClock != null && Number.isFinite(poppedClock) ? [poppedClock] : []
      });
    }

    this._state.content.clock += 1;
    this._state.content.lastBlockHash = blockHash;
    this._state.content.height = height;
    this._state.content.balance = trusted;
    this._state.content.balanceSats = balanceSats;

    const epoch = {
      clock: this._state.content.clock,
      blockHash: this._state.content.lastBlockHash,
      height: this._state.content.height,
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

  async start () {
    if (this._state.content.status === 'RUNNING') return this;
    this._state.content.status = 'RUNNING';

    await this._loadEpochChainFromFilesystem();

    const isRegtest = this.settings.regtest !== false;

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
    } else {
      const prime = async () => {
        try {
          const tip = await this.bitcoin._makeRPCRequest('getbestblockhash', []);
          const height = await this.bitcoin._makeRPCRequest('getblockcount', []);
          await this.recordEpochFromBlock({ tip, height });
        } catch (err) {
          this.emit('error', err);
        }
      };
      await prime();
      this._blockHandler = (payload) => {
        this.recordEpochFromBlock(payload).catch((err) => this.emit('error', err));
      };
      if (this.bitcoin && typeof this.bitcoin.on === 'function') {
        this.bitcoin.on('block', this._blockHandler);
      }
    }

    return this;
  }

  async stop () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._blockHandler && this.bitcoin && typeof this.bitcoin.removeListener === 'function') {
      this.bitcoin.removeListener('block', this._blockHandler);
      this._blockHandler = null;
    }
    await this._persistEpochChain();
    this._state.content.status = 'STOPPED';
    return this;
  }
}

Beacon.BEACON_CHAIN_PATH = BEACON_CHAIN_PATH;
Beacon.SATS_PER_BTC = SATS_PER_BTC;

module.exports = Beacon;
