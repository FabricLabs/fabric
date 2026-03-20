'use strict';

/**
 * CONTRACT_PROPOSAL payloads: batched Fabric {@link Message} wires, a Merkle tree over
 * their canonical leaf hashes, optional parent chain root, RFC 6902 `statePatch`, and
 * optional PSBT reference(s) for on-chain legs (see hub `psbtFabric.js`).
 *
 * Wire type: `Message.fromVector(['ContractProposal', JSON.stringify(payload)])` → opcode {@link CONTRACT_PROPOSAL_TYPE}.
 */

const crypto = require('crypto');
const jsonpatch = require('fast-json-patch');
const Message = require('../types/message');

function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * Leaf hash for one AMP message: SHA256(full wire bytes including header).
 * @param {import('../types/message')} message
 * @returns {Buffer} 32 bytes
 */
function messageLeafHash (message) {
  if (!message || typeof message.asRaw !== 'function') {
    throw new Error('Expected Fabric Message with asRaw().');
  }
  return sha256(message.asRaw());
}

/**
 * Binary Merkle root over 32-byte leaf hashes (odd level duplicates last leaf).
 * @param {Buffer[]} leafHashes
 * @returns {Buffer}
 */
function merkleRootFromLeafHashes (leafHashes) {
  if (!Array.isArray(leafHashes) || leafHashes.length === 0) {
    return Buffer.alloc(32);
  }
  let row = leafHashes.map((h) => {
    if (!Buffer.isBuffer(h) || h.length !== 32) throw new Error('Each leaf must be a 32-byte Buffer.');
    return Buffer.from(h);
  });
  while (row.length > 1) {
    if (row.length % 2 === 1) row = row.concat(row[row.length - 1]);
    const next = [];
    for (let i = 0; i < row.length; i += 2) {
      const a = row[i];
      const b = row[i + 1];
      const left = Buffer.compare(a, b) <= 0 ? a : b;
      const right = Buffer.compare(a, b) <= 0 ? b : a;
      next.push(sha256(Buffer.concat([left, right])));
    }
    row = next;
  }
  return row[0];
}

/**
 * @param {import('../types/message')[]} messages
 * @returns {Buffer[]}
 */
function leafHashesFromMessages (messages) {
  if (!Array.isArray(messages)) throw new Error('messages must be an array.');
  return messages.map((m) => messageLeafHash(m));
}

/**
 * Build UTF-8 JSON body for a ContractProposal message (not yet wrapped in Message).
 * @param {Object} opts
 * @param {string} [opts.contractId]
 * @param {string|null} [opts.parentChainRoot] hex64 prior chain merkle root
 * @param {import('../types/message')[]} opts.messages non-empty list of Fabric messages to commit to
 * @param {object[]} [opts.statePatch] RFC 6902 patch (array of operations)
 * @param {string} [opts.psbtProposalBase64] optional PSBT (e.g. funding) referenced by this proposal
 * @returns {Object} serializable payload (versioned)
 */
function buildContractProposalPayload (opts = {}) {
  const messages = opts.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('At least one Fabric Message is required.');
  }
  const leaves = leafHashesFromMessages(messages);
  const root = merkleRootFromLeafHashes(leaves);
  const wireEnvelopes = messages.map((m, i) => {
    const raw = m.asRaw();
    return {
      leafHash: leaves[i].toString('hex'),
      wireBase64: raw.toString('base64')
    };
  });
  return {
    version: 1,
    contractId: opts.contractId != null ? String(opts.contractId) : null,
    chain: {
      parentRoot: opts.parentChainRoot != null ? String(opts.parentChainRoot) : null,
      merkleRoot: root.toString('hex'),
      leafHashes: leaves.map((h) => h.toString('hex'))
    },
    statePatch: Array.isArray(opts.statePatch) ? opts.statePatch : [],
    messages: wireEnvelopes,
    psbt: opts.psbtProposalBase64 ? { proposalBase64: String(opts.psbtProposalBase64).trim() } : undefined
  };
}

/**
 * Recompute Merkle root from payload `messages` and verify it matches `chain.merkleRoot`.
 * @param {Object} payload from {@link buildContractProposalPayload} or parsed JSON
 * @returns {{ ok: boolean, error?: string }}
 */
function verifyContractProposalPayload (payload) {
  try {
    if (!payload || payload.version !== 1 || !Array.isArray(payload.messages)) {
      return { ok: false, error: 'Invalid or unsupported ContractProposal payload.' };
    }
    const leaves = payload.messages.map((entry) => {
      const raw = Buffer.from(String(entry.wireBase64 || ''), 'base64');
      return sha256(raw);
    });
    const root = merkleRootFromLeafHashes(leaves);
    const want = String(payload.chain && payload.chain.merkleRoot || '');
    if (root.toString('hex') !== want) {
      return { ok: false, error: 'Merkle root mismatch.' };
    }
    if (Array.isArray(payload.chain.leafHashes)) {
      for (let i = 0; i < leaves.length; i++) {
        if (leaves[i].toString('hex') !== payload.chain.leafHashes[i]) {
          return { ok: false, error: 'Leaf hash mismatch at index ' + i };
        }
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * Apply RFC 6902 patch to a deep-cloned JSON object (e.g. hub global state snapshot).
 * @param {object} document
 * @param {object[]} patch
 * @returns {object} new document
 */
function applyStatePatch (document, patch) {
  if (document == null || typeof document !== 'object') throw new Error('document must be an object.');
  if (!Array.isArray(patch)) throw new Error('patch must be an array.');
  const copy = JSON.parse(JSON.stringify(document));
  return jsonpatch.applyPatch(copy, patch, true, false).newDocument;
}

/**
 * Create and optionally sign a ContractProposal {@link Message}.
 * @param {import('../types/key')} key
 * @param {Object} opts passed to {@link buildContractProposalPayload}
 */
function createContractProposalMessage (key, opts = {}) {
  const payload = buildContractProposalPayload(opts);
  const body = JSON.stringify(payload);
  const msg = Message.fromVector(['ContractProposal', body]);
  if (key) msg.signWithKey(key);
  return msg;
}

module.exports = {
  sha256,
  messageLeafHash,
  merkleRootFromLeafHashes,
  leafHashesFromMessages,
  buildContractProposalPayload,
  verifyContractProposalPayload,
  applyStatePatch,
  createContractProposalMessage
};
