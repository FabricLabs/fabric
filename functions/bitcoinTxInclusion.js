'use strict';

/**
 * @fileoverview Bitcoin transaction inclusion proofs (SPV-style Merkle
 * branches). A proof binds a `txid` to an 80-byte block header, so a
 * `FraudProof` that claims "this transaction was broadcast" can carry
 * on-chain evidence instead of a bare hex blob the verifier cannot check.
 * Pure functions, no network.
 */

const crypto = require('crypto');

/** @private double SHA-256 */
function hash256 (buffer) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buffer).digest()).digest();
}

/** @private display-order txid (hex) → internal byte order */
function toInternal (txidHex) {
  const hex = String(txidHex || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`bitcoinTxInclusion: bad txid ${txidHex}`);
  return Buffer.from(hex, 'hex').reverse();
}

/** @private internal byte order → display-order hex */
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

/** @private Merkle depth of a tree with `count` leaves */
function treeDepth (count) {
  let depth = 0;
  for (let width = count; width > 1; width = Math.ceil(width / 2)) depth++;
  return depth;
}

/**
 * Verify an inclusion proof against a block header: the header's own
 * proof-of-work, then the Merkle branch. A valid result still says nothing
 * about which chain the header belongs to (see {@link headerMeetsTarget}).
 * @param {object} proof `{ blockHeaderHex, txid, index, branch, txCount? }` — `txCount` pins the branch depth
 * @returns {{ ok: boolean, reason?: string, blockHash?: string, merkleRootHex?: string }}
 */
function verifyInclusion (proof = {}) {
  let header;
  try { header = parseHeader(proof.blockHeaderHex); } catch (e) { return { ok: false, reason: e.message }; }
  if (!headerMeetsTarget(proof.blockHeaderHex)) return { ok: false, reason: 'block header does not meet its proof-of-work target', blockHash: header.blockHash };
  let node;
  try { node = toInternal(proof.txid); } catch (e) { return { ok: false, reason: e.message }; }
  if (!Array.isArray(proof.branch)) return { ok: false, reason: 'branch required' };
  let position = Math.floor(Number(proof.index));
  if (!Number.isFinite(position) || position < 0) return { ok: false, reason: 'index required' };
  if (proof.txCount != null) {
    const count = Math.floor(Number(proof.txCount));
    if (!Number.isFinite(count) || count < 1) return { ok: false, reason: 'txCount invalid' };
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

module.exports = { merkleRootFromTxids, buildBranch, parseHeader, targetFromBits, headerMeetsTarget, verifyInclusion, buildInclusion };
