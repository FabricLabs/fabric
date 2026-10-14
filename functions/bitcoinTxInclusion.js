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
 * Verify an inclusion proof against a block header.
 * @param {object} proof `{ blockHeaderHex, txid, index, branch }`
 * @returns {{ ok: boolean, reason?: string, blockHash?: string, merkleRootHex?: string }}
 */
function verifyInclusion (proof = {}) {
  let header;
  try { header = parseHeader(proof.blockHeaderHex); } catch (e) { return { ok: false, reason: e.message }; }
  let node;
  try { node = toInternal(proof.txid); } catch (e) { return { ok: false, reason: e.message }; }
  if (!Array.isArray(proof.branch)) return { ok: false, reason: 'branch required' };
  let position = Math.floor(Number(proof.index));
  if (!Number.isFinite(position) || position < 0) return { ok: false, reason: 'index required' };
  for (const sibHex of proof.branch) {
    let sibling;
    try { sibling = toInternal(sibHex); } catch (e) { return { ok: false, reason: e.message }; }
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
  return { type: 'BitcoinTxInclusion', blockHeaderHex: String(opts.blockHeaderHex).toLowerCase(), blockHash: header.blockHash, txid: branch.txid, index: branch.index, branch: branch.branch };
}

module.exports = { merkleRootFromTxids, buildBranch, parseHeader, verifyInclusion, buildInclusion };
