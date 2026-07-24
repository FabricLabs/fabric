'use strict';

/**
 * Bitcoin-shaped Block: parent-linked header + merkle of leaves, with optional
 * PoW (`nonce`/`bits`), Elements-style federation signatures, and arbitrary `data`.
 *
 * @see docs/CHAIN.md
 */

const merge = require('lodash.merge');
const crypto = require('crypto');

const Actor = require('./actor');
const Transaction = require('./transaction');
const Tree = require('./tree');
const Key = require('./key');
const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const {
  jsonSafe,
  stableStringify
} = fabricCanonicalJson;
const {
  signingStringForBeaconEpoch,
  verifyFederationWitnessOnMessage
} = require('../functions/beaconFederationSigning');

const CONSENSUS_POW = 'pow';
const CONSENSUS_FEDERATION = 'federation';
const CONSENSUS_GOSSIP = 'gossip';
const BLOCK_SIGNING_KIND = 'FabricBlock';

/**
 * @param {object} input
 * @returns {boolean}
 */
function isStructuredBlockInput (input) {
  if (!input || typeof input !== 'object') return false;
  if (input instanceof Block) return true;
  const t = input.type;
  if (t === 'BEACON_EPOCH' || t === 'SCEvent' || t === 'FabricBlock') return true;
  if (input.data !== undefined || input.payload !== undefined) return true;
  if (input.federationWitness != null) return true;
  if (input.author != null && (input.parent !== undefined || input.height != null)) return true;
  return false;
}

/**
 * Canonical signing / digest body (excludes witness material).
 * @param {object} header
 * @returns {string}
 */
function signingStringForBlock (header) {
  return stableStringify({
    version: 1,
    kind: BLOCK_SIGNING_KIND,
    id: header && header.id != null ? String(header.id) : '',
    parent: header && header.parent != null ? String(header.parent) : null,
    height: Number(header && header.height) || 0,
    type: header && header.type != null ? String(header.type) : 'Block',
    data: header && header.data != null ? jsonSafe(header.data) : {},
    transactions: header && header.transactions
      ? jsonSafe(header.transactions)
      : {},
    merkleRoot: header && header.merkleRoot != null ? String(header.merkleRoot) : null,
    timestamp: header && header.timestamp != null ? String(header.timestamp) : null,
    author: header && header.author != null ? String(header.author) : null,
    nonce: Number(header && header.nonce) || 0,
    bits: header && header.bits != null ? header.bits : null
  });
}

/**
 * Content digest for merkle leaves / chain digest (includes optional federationWitness).
 * @param {object} header
 * @returns {string}
 */
function blockDigest (header) {
  const s = stableStringify({
    id: header && header.id != null ? String(header.id) : '',
    parent: header && header.parent != null ? String(header.parent) : null,
    height: Number(header && header.height) || 0,
    type: header && header.type != null ? String(header.type) : 'Block',
    data: header && header.data != null ? jsonSafe(header.data) : {},
    author: header && header.author != null ? String(header.author) : null,
    federationWitness: header && header.federationWitness
      ? jsonSafe(header.federationWitness)
      : null
  });
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Soft playnet PoW: leading zero hex nibbles from `bits` (integer 0–64).
 * @param {string} idHex
 * @param {number|null} bits
 * @returns {boolean}
 */
function meetsProofOfWork (idHex, bits) {
  if (bits == null || bits === false) return true;
  const n = Math.max(0, Math.min(64, Number(bits) || 0));
  if (!n) return true;
  const id = String(idHex || '');
  return id.slice(0, n) === '0'.repeat(n);
}

class Block extends Actor {
  /**
   * @param {object} [input]
   */
  constructor (input = {}) {
    const src = (input instanceof Block)
      ? input.toRecord()
      : (input && typeof input === 'object' ? input : {});

    const structured = isStructuredBlockInput(src);

    if (!structured) {
      // Playnet / legacy: preserve Actor content identity (known fixture hashes).
      super(src);
      this.settings = merge({ type: 'Block' }, src);
      this._ledgerId = null;
      this._state = {
        parent: src.parent != null ? src.parent : null,
        height: Number(src.height) || 0,
        transactions: (src.transactions && typeof src.transactions === 'object')
          ? src.transactions
          : {},
        signatures: Array.isArray(src.signatures) ? src.signatures.slice() : [],
        federationWitness: src.federationWitness || null,
        signature: src.signature || null,
        author: src.author != null ? String(src.author) : null,
        data: src.data !== undefined ? src.data : null,
        merkleRoot: src.merkleRoot != null ? src.merkleRoot : null,
        nonce: Number(src.nonce) || 0,
        bits: src.bits != null ? src.bits : null,
        timestamp: src.timestamp != null ? src.timestamp : null,
        blockType: src.type || 'Block',
        content: this.state || src
      };
    } else {
      const data = src.data !== undefined
        ? src.data
        : (src.payload !== undefined ? src.payload : {});
      const txs = (src.transactions && typeof src.transactions === 'object')
        ? src.transactions
        : {};
      const headerContent = {
        type: src.type || 'Block',
        parent: src.parent != null ? String(src.parent) : null,
        height: Number(src.height) || 0,
        data: data && typeof data === 'object' ? data : {},
        transactions: txs,
        author: src.author != null ? String(src.author) : null,
        timestamp: src.timestamp != null
          ? src.timestamp
          : (data && (data.timestamp || data.ts)) || null,
        nonce: Number(src.nonce) || 0,
        bits: src.bits != null ? src.bits : null,
        merkleRoot: src.merkleRoot != null ? src.merkleRoot : null
      };
      super(headerContent);
      this.settings = merge({ type: headerContent.type }, src);
      this._ledgerId = src.id != null ? String(src.id) : null;
      this._state = {
        parent: headerContent.parent,
        height: headerContent.height,
        transactions: txs,
        signatures: Array.isArray(src.signatures) ? src.signatures.slice() : [],
        federationWitness: src.federationWitness
          ? JSON.parse(JSON.stringify(src.federationWitness))
          : null,
        signature: src.signature != null ? String(src.signature) : null,
        author: headerContent.author,
        data: headerContent.data,
        merkleRoot: headerContent.merkleRoot,
        nonce: headerContent.nonce,
        bits: headerContent.bits,
        timestamp: headerContent.timestamp,
        blockType: headerContent.type,
        content: this.state || headerContent
      };
      if (!this._state.merkleRoot) {
        this._state.merkleRoot = this._computeMerkleRoot();
      }
      if (!this._ledgerId) {
        this._ledgerId = blockDigest({
          id: '',
          parent: this._state.parent,
          height: this._state.height,
          type: this._state.blockType,
          data: this._state.data,
          author: this._state.author,
          federationWitness: this._state.federationWitness
        }).slice(0, 32);
      }
    }

    Object.defineProperty(this, '_events', { enumerable: false });
    Object.defineProperty(this, '_eventCount', { enumerable: false });
    Object.defineProperty(this, 'observer', { enumerable: false });
    Object.defineProperty(this, '_ledgerId', { enumerable: false, writable: true });

    for (const [id, template] of Object.entries(this.transactions || {})) {
      try {
        const tx = new Transaction(template);
        if (id !== tx.id) throw new Error(`Transaction hash mismatch! ${id} != ${tx.id}`);
      } catch (err) {
        if (err && /hash mismatch/.test(err.message)) throw err;
      }
    }

    return this;
  }

  get id () {
    if (this._ledgerId) return this._ledgerId;
    const buffer = Buffer.from(this.preimage, 'hex');
    const Hash256 = require('./hash256');
    return Hash256.compute(buffer);
  }

  get parent () {
    return this._state.parent != null ? this._state.parent : null;
  }

  set parent (value) {
    this._state.parent = value != null ? String(value) : null;
  }

  get height () {
    return Number(this._state.height) || 0;
  }

  set height (value) {
    this._state.height = Number(value) || 0;
  }

  /** Alias used by Beacon codecs / tests. */
  get clock () {
    return this.height;
  }

  get blockType () {
    return this._state.blockType || 'Block';
  }

  get type () {
    return this._state.blockType || this._state['@type'] || 'Block';
  }

  get data () {
    return this._state.data != null ? this._state.data : {};
  }

  /** Beacon / legacy entry alias for `data`. */
  get payload () {
    return this.data;
  }

  get author () {
    return this._state.author != null ? this._state.author : null;
  }

  get signature () {
    return this._state.signature != null ? this._state.signature : null;
  }

  get signatures () {
    return Array.isArray(this._state.signatures) ? this._state.signatures : [];
  }

  get federationWitness () {
    return this._state.federationWitness || null;
  }

  get merkleRoot () {
    return this._state.merkleRoot != null ? this._state.merkleRoot : this._computeMerkleRoot();
  }

  get nonce () {
    return Number(this._state.nonce) || 0;
  }

  get bits () {
    return this._state.bits != null ? this._state.bits : null;
  }

  get timestamp () {
    return this._state.timestamp != null ? this._state.timestamp : null;
  }

  get tree () {
    const leaves = Object.keys(this.transactions || {});
    if (this._state.data && typeof this._state.data === 'object' && Object.keys(this._state.data).length) {
      leaves.push(blockDigest({ id: '', type: this.blockType, data: this._state.data }));
    }
    // Empty leaves → empty merkle root (Bitcoin-style playnet fixture).
    return new Tree({ leaves });
  }

  get transactions () {
    return this._state.transactions || {};
  }

  get transactionIDs () {
    return Object.keys(this.transactions || {});
  }

  _computeMerkleRoot () {
    const tree = this.tree;
    const root = tree.root;
    if (!root) return null;
    return Buffer.isBuffer(root) ? root.toString('hex') : String(root);
  }

  /**
   * JSON-safe ledger record.
   * @returns {object}
   */
  toRecord () {
    return {
      id: this.id,
      parent: this.parent,
      height: this.height,
      type: this.blockType,
      data: this._state.data != null
        ? JSON.parse(JSON.stringify(this._state.data))
        : {},
      transactions: this.transactions
        ? JSON.parse(JSON.stringify(this.transactions))
        : {},
      merkleRoot: this.merkleRoot,
      nonce: this.nonce,
      bits: this.bits,
      timestamp: this.timestamp,
      author: this.author,
      signature: this.signature,
      signatures: this.signatures.slice(),
      federationWitness: this.federationWitness
        ? JSON.parse(JSON.stringify(this.federationWitness))
        : null
    };
  }

  /**
   * @param {object} record
   * @returns {Block}
   */
  static fromRecord (record) {
    return new Block(record || {});
  }

  signingString () {
    return signingStringForBlock(this.toRecord());
  }

  digest () {
    return blockDigest(this.toRecord());
  }

  /**
   * Author Schnorr over signingString (gossip).
   * @param {import('./key')} key
   * @returns {string} signature hex
   */
  sign (key) {
    if (key && key.private) {
      if (!this._state.author && key.pubkey) this._state.author = String(key.pubkey);
      const msg = Buffer.from(this.signingString(), 'utf8');
      const sig = key.signSchnorr(msg);
      this._state.signature = Buffer.isBuffer(sig) ? sig.toString('hex') : String(sig);
      return this._state.signature;
    }
    // Legacy Actor-style sign via this.key
    const actor = new Actor(this._state);
    const data = actor.toString();
    const array = this.key._sign(data);
    this._state.signature = Buffer.from(array);
    return this._state.signature;
  }

  /**
   * @param {string} pubkey
   * @param {string|Buffer} sig
   * @returns {Block}
   */
  addSignature (pubkey, sig) {
    const hex = Buffer.isBuffer(sig) ? sig.toString('hex') : String(sig);
    const pk = String(pubkey || '');
    if (!this._state.federationWitness) {
      this._state.federationWitness = { signatures: {} };
    }
    if (!this._state.federationWitness.signatures) {
      this._state.federationWitness.signatures = {};
    }
    this._state.federationWitness.signatures[pk] = hex;
    this._state.signatures.push({ pubkey: pk, signature: hex });
    return this;
  }

  /**
   * @param {{ consensus?: string, validators?: string[], threshold?: number, bits?: number|null, requireParent?: string|null }} [opts]
   * @returns {{ ok: boolean, reason?: string }}
   */
  validate (opts = {}) {
    const consensus = opts.consensus || CONSENSUS_POW;
    if (opts.requireParent !== undefined) {
      const expected = opts.requireParent != null ? String(opts.requireParent) : null;
      const actual = this.parent != null ? String(this.parent) : null;
      if (expected !== actual) {
        return { ok: false, reason: 'parent must match tip' };
      }
    }

    if (consensus === CONSENSUS_POW) {
      const bits = opts.bits !== undefined ? opts.bits : this.bits;
      if (!meetsProofOfWork(this.id, bits)) {
        return { ok: false, reason: 'proof of work not met' };
      }
      return { ok: true };
    }

    if (consensus === CONSENSUS_FEDERATION) {
      const pubs = Array.isArray(opts.validators) ? opts.validators : [];
      if (!pubs.length) return { ok: true };
      const thr = Math.max(1, Number(opts.threshold) || 1);
      if (this.blockType === 'BEACON_EPOCH' && this.data) {
        const buf = Buffer.from(
          signingStringForBeaconEpoch(this.data),
          'utf8'
        );
        const ok = verifyFederationWitnessOnMessage(
          buf,
          this.federationWitness,
          pubs,
          thr
        );
        if (!ok) return { ok: false, reason: 'federationWitness missing or invalid' };
        return { ok: true };
      }
      const buf = Buffer.from(this.signingString(), 'utf8');
      const ok = verifyFederationWitnessOnMessage(
        buf,
        this.federationWitness,
        pubs,
        thr
      );
      if (!ok) return { ok: false, reason: 'federationWitness missing or invalid' };
      return { ok: true };
    }

    if (consensus === CONSENSUS_GOSSIP) {
      if (!this.signature || !this.author) return { ok: true };
      try {
        const k = new Key({ pubkey: this.author });
        const msg = Buffer.from(this.signingString(), 'utf8');
        const sig = Buffer.from(this.signature, 'hex');
        if (!k.verifySchnorr(msg, sig)) {
          return { ok: false, reason: 'invalid author signature' };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: err && err.message ? err.message : 'signature verify error'
        };
      }
    }

    return { ok: true };
  }
}

Block.CONSENSUS_POW = CONSENSUS_POW;
Block.CONSENSUS_FEDERATION = CONSENSUS_FEDERATION;
Block.CONSENSUS_GOSSIP = CONSENSUS_GOSSIP;
Block.signingStringForBlock = signingStringForBlock;
Block.blockDigest = blockDigest;
Block.meetsProofOfWork = meetsProofOfWork;
Block.isStructuredBlockInput = isStructuredBlockInput;

module.exports = Block;
