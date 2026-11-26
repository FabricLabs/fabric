'use strict';

/**
 * @fileoverview Bitcoin-shaped Block: parent-linked header + merkle of leaves, with optional
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
const SIGNING_TAGS = require('./key').TAGS;

/**
 * @private
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
 * @private
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
 * @private
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
 * @private
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
   * @param {Key} key
   * @returns {string} signature hex
   */
  sign (key) {
    if (key && key.private) {
      if (!this._state.author && key.pubkey) this._state.author = String(key.pubkey);
      const msg = Buffer.from(this.signingString(), 'utf8');
      const sig = key.signSchnorr(msg, SIGNING_TAGS.BLOCK_AUTHOR);
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
   * @param {Object} [opts]
   * @param {string} [opts.consensus]
   * @param {Array.<string>} [opts.validators]
   * @param {number} [opts.threshold]
   * @param {number|null} [opts.bits]
   * @param {string|null} [opts.requireParent]
   * @returns {{ok: boolean, reason: (string|undefined)}}
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
        if (!k.verifySchnorr(msg, sig, SIGNING_TAGS.BLOCK_AUTHOR)) {
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

const block_inclusion = (function () {
/**
 * @fileoverview Bitcoin transaction inclusion proofs (SPV-style Merkle
 * branches). A proof binds a `txid` to an 80-byte block header, so a
 * `FraudProof` that claims "this transaction was broadcast" can carry
 * on-chain evidence instead of a bare hex blob the verifier cannot check.
 * Pure functions, no network.
 */

const crypto = require('crypto');

/**
 * Double SHA-256.
 * @private
 */
function hash256 (buffer) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buffer).digest()).digest();
}

/**
 * Display-order txid (hex) to internal byte order.
 * @private
 */
function toInternal (txidHex) {
  const hex = String(txidHex || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`bitcoinTxInclusion: bad txid ${txidHex}`);
  return Buffer.from(hex, 'hex').reverse();
}

/**
 * Internal byte order to display-order hex.
 * @private
 */
function toDisplay (buffer) {
  return Buffer.from(buffer).reverse().toString('hex');
}

/**
 * Compute the Merkle root of a block's transaction list.
 * @param {string[]} txids display-order txids in block order
 * @returns {string} display-order Merkle root hex
 */
function merkleRootFromTxids (txids) {
  if (!Array.isArray(txids) || !txids.length) throw new Error('bitcoinTxInclusion: txids required');
  let level = txids.map(toInternal);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || left;
      next.push(hash256(Buffer.concat([left, right])));
    }
    level = next;
  }
  return toDisplay(level[0]);
}

/**
 * Build the Merkle branch proving `txid` is in `txids`.
 * @param {string[]} txids display-order txids in block order
 * @param {string} txid display-order txid to prove
 * @returns {{ txid: string, index: number, branch: string[], merkleRootHex: string }} `branch` is display-order sibling hashes, leaf → root
 */
function buildBranch (txids, txid) {
  if (!Array.isArray(txids) || !txids.length) throw new Error('bitcoinTxInclusion: txids required');
  const target = String(txid || '').toLowerCase();
  let index = txids.findIndex((t) => String(t).toLowerCase() === target);
  if (index < 0) throw new Error('bitcoinTxInclusion: txid not in block');
  const branch = [];
  let level = txids.map(toInternal);
  let position = index;
  while (level.length > 1) {
    const sibling = position % 2 === 0 ? (level[position + 1] || level[position]) : level[position - 1];
    branch.push(toDisplay(sibling));
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hash256(Buffer.concat([level[i], level[i + 1] || level[i]])));
    level = next;
    position = Math.floor(position / 2);
  }
  return { txid: target, index, branch, merkleRootHex: toDisplay(level[0]) };
}

/**
 * Parse an 80-byte block header.
 * @param {string} blockHeaderHex
 * @returns {{ blockHash: string, merkleRootHex: string, prevBlockHash: string, time: number, version: number, bits: number, nonce: number }}
 */
function parseHeader (blockHeaderHex) {
  const hex = String(blockHeaderHex || '').toLowerCase();
  if (!/^[0-9a-f]{160}$/.test(hex)) throw new Error('bitcoinTxInclusion: blockHeaderHex must be 80 bytes');
  const header = Buffer.from(hex, 'hex');
  return {
    blockHash: toDisplay(hash256(header)),
    version: header.readInt32LE(0),
    prevBlockHash: toDisplay(header.subarray(4, 36)),
    merkleRootHex: toDisplay(header.subarray(36, 68)),
    time: header.readUInt32LE(68),
    bits: header.readUInt32LE(72),
    nonce: header.readUInt32LE(76)
  };
}

/**
 * Decode compact `bits` into the proof-of-work target.
 * @param {number} bits
 * @returns {bigint|null} `null` for a negative or overflowing encoding
 */
function targetFromBits (bits) {
  const n = Number(bits) >>> 0;
  const exponent = n >>> 24;
  const mantissa = n & 0x007fffff;
  if (n & 0x00800000) return null;
  const target = exponent <= 3
    ? BigInt(mantissa) >> BigInt(8 * (3 - exponent))
    : BigInt(mantissa) << BigInt(8 * (exponent - 3));
  if (target === 0n || target >= (1n << 256n)) return null;
  return target;
}

/**
 * Whether an 80-byte header meets the target its own `bits` declare. This
 * proves work was done, not that the header is on any particular chain —
 * callers must still check the block hash against their own header chain.
 * @param {string} blockHeaderHex
 * @returns {boolean}
 */
function headerMeetsTarget (blockHeaderHex) {
  let header;
  try { header = parseHeader(blockHeaderHex); } catch (_) { return false; }
  const target = targetFromBits(header.bits);
  if (target == null) return false;
  return BigInt(`0x${header.blockHash}`) <= target;
}

/**
 * Merkle depth of a tree with `count` leaves.
 * @private
 */
function treeDepth (count) {
  let depth = 0;
  for (let width = count; width > 1; width = Math.ceil(width / 2)) depth++;
  return depth;
}

/**
 * Verify an inclusion proof against a block header: the header's own
 * proof-of-work, then the Merkle branch. A valid result still says nothing
 * about which chain the header belongs to (see {@link headerMeetsTarget}).
 *
 * The transaction count pins the branch depth (a 64-byte transaction can
 * otherwise pose as an inner node). The proof's own `txCount` is chosen by
 * whoever built it; a verifier with a chain view should pass the block's
 * real count as `opts.txCount`, which then wins.
 * @param {object} proof `blockHeaderHex`, `txid`, `index`, `branch`, and optional `txCount`
 * @param {object} [opts]
 * @param {number} [opts.txCount] the block's transaction count from the verifier's chain view
 * @param {boolean} [opts.requireTxCount] fail when neither `opts.txCount` nor `proof.txCount` is known
 * @returns {Object} `ok`. On failure, `reason`. When known, `blockHash` and `merkleRootHex`.
 */
function verifyInclusion (proof = {}, opts = {}) {
  let header;
  try { header = parseHeader(proof.blockHeaderHex); } catch (e) { return { ok: false, reason: e.message }; }
  if (!headerMeetsTarget(proof.blockHeaderHex)) return { ok: false, reason: 'block header does not meet its proof-of-work target', blockHash: header.blockHash };
  let node;
  try { node = toInternal(proof.txid); } catch (e) { return { ok: false, reason: e.message }; }
  if (!Array.isArray(proof.branch)) return { ok: false, reason: 'branch required' };
  if (!Number.isSafeInteger(Number(proof.index)) || typeof proof.index === 'boolean') return { ok: false, reason: 'index required' };
  let position = Number(proof.index);
  if (position < 0) return { ok: false, reason: 'index required' };
  const rawCount = opts.txCount != null ? opts.txCount : proof.txCount;
  if (rawCount == null && opts.requireTxCount) return { ok: false, reason: 'txCount required to pin the branch depth', blockHash: header.blockHash };
  if (rawCount != null) {
    const count = Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 1) return { ok: false, reason: 'txCount invalid' };
    if (position >= count) return { ok: false, reason: 'index beyond txCount' };
    if (proof.branch.length !== treeDepth(count)) return { ok: false, reason: 'branch depth does not match txCount' };
  }
  for (const sibHex of proof.branch) {
    let sibling;
    try { sibling = toInternal(sibHex); } catch (e) { return { ok: false, reason: e.message }; }
    // CVE-2012-2459: a node is only ever paired with itself as the *last*
    // (left, even) element of a level. An equal left sibling is a mutation.
    if (position % 2 === 1 && sibling.equals(node)) return { ok: false, reason: 'duplicated merkle node (CVE-2012-2459)' };
    node = position % 2 === 0 ? hash256(Buffer.concat([node, sibling])) : hash256(Buffer.concat([sibling, node]));
    position = Math.floor(position / 2);
  }
  if (position !== 0) return { ok: false, reason: 'index exceeds branch depth' };
  const root = toDisplay(node);
  if (root !== header.merkleRootHex) return { ok: false, reason: 'merkle root mismatch', blockHash: header.blockHash, merkleRootHex: root };
  return { ok: true, blockHash: header.blockHash, merkleRootHex: root };
}

/**
 * Convenience: build a complete, self-verifying inclusion artifact.
 * @param {object} opts `{ blockHeaderHex, txids, txid }`
 * @returns {{ type: string, blockHeaderHex: string, blockHash: string, txid: string, index: number, branch: string[] }}
 */
function buildInclusion (opts = {}) {
  const header = parseHeader(opts.blockHeaderHex);
  const branch = buildBranch(opts.txids, opts.txid);
  if (branch.merkleRootHex !== header.merkleRootHex) throw new Error('bitcoinTxInclusion: txids do not match the header merkle root');
  return { type: 'BitcoinTxInclusion', blockHeaderHex: String(opts.blockHeaderHex).toLowerCase(), blockHash: header.blockHash, txid: branch.txid, index: branch.index, branch: branch.branch, txCount: opts.txids.length };
}
  return {
    merkleRootFromTxids, buildBranch, parseHeader, targetFromBits, headerMeetsTarget, verifyInclusion, buildInclusion
  };
})();
Block.merkleRootFromTxids = block_inclusion.merkleRootFromTxids;
Block.buildBranch = block_inclusion.buildBranch;
Block.parseHeader = block_inclusion.parseHeader;
Block.targetFromBits = block_inclusion.targetFromBits;
Block.headerMeetsTarget = block_inclusion.headerMeetsTarget;
Block.verifyInclusion = block_inclusion.verifyInclusion;
Block.buildInclusion = block_inclusion.buildInclusion;
