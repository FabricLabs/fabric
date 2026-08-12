'use strict';

/**
 * Two-phase delivery commit for Application Resource Contract messages.
 *
 * Phase 1 — received: a reader in the contract reader set confirmed the wire frame.
 * Phase 2 — receipt: that reader sent a BIP340-backed MessageReceipt.
 *
 * Sidecar to content fold (see contractMessageAccumulate); does not alter stateDigest.
 *
 * @module functions/contractMessageCommit
 */

const Key = require('../types/key');
const { pubkeyXOnly } = require('./groupChatSeal');

/**
 * Canonical UTF-8 message for BIP340 MessageReceipt signatures.
 * @param {string} messageId wire hash / pending id
 * @returns {string}
 */
function receiptSigningMessage (messageId) {
  return `fabric:message-receipt:1:${String(messageId || '').trim().toLowerCase()}`;
}

/**
 * @param {Iterable<*>} readers
 * @returns {string[]}
 */
function normalizeReaders (readers) {
  const set = new Set();
  for (const r of readers || []) {
    const x = pubkeyXOnly(r);
    if (x) set.add(x);
  }
  return Array.from(set).sort();
}

/**
 * @param {object} opts
 * @param {string} opts.id Message id (usually wire hash)
 * @param {string} opts.contractId
 * @param {string} [opts.wireHash]
 * @param {string} [opts.contentHash]
 * @param {Iterable<*>} opts.readers
 * @returns {object}
 */
function createPending (opts = {}) {
  const id = String(opts.id || opts.wireHash || '').trim().toLowerCase();
  if (!id) throw new Error('createPending: id required');
  const contractId = String(opts.contractId || '').trim().toLowerCase();
  if (!contractId) throw new Error('createPending: contractId required');
  const readers = normalizeReaders(opts.readers);
  if (!readers.length) throw new Error('createPending: at least one reader required');
  const peers = {};
  for (const r of readers) peers[r] = {};
  return {
    id,
    contractId,
    wireHash: opts.wireHash != null ? String(opts.wireHash).toLowerCase() : id,
    contentHash: opts.contentHash != null ? String(opts.contentHash).toLowerCase() : null,
    createdAt: opts.createdAt || new Date().toISOString(),
    readers: readers.slice(),
    peers
  };
}

function _peerSlot (record, pubkey) {
  const x = pubkeyXOnly(pubkey);
  if (!x) throw new Error('invalid reader pubkey');
  if (!record.peers[x] && record.readers.includes(x)) {
    record.peers[x] = {};
  }
  if (!record.peers[x]) {
    throw new Error('pubkey not in reader set');
  }
  return { x, slot: record.peers[x] };
}

/**
 * Phase 1: mark received for a reader.
 * @param {object} record
 * @param {*} pubkey
 * @param {string} [at]
 * @returns {object}
 */
function markReceived (record, pubkey, at) {
  const { slot } = _peerSlot(record, pubkey);
  if (!slot.receivedAt) slot.receivedAt = at || new Date().toISOString();
  return record;
}

/**
 * Verify BIP340 receipt over the pending message id / wire hash.
 * @param {object} record
 * @param {*} pubkey
 * @param {string} receiptSig 64-byte hex
 * @returns {boolean}
 */
function verifyReceiptSignature (record, pubkey, receiptSig) {
  const x = pubkeyXOnly(pubkey);
  const sigHex = String(receiptSig || '').trim().toLowerCase();
  if (!x || !/^[0-9a-f]{128}$/.test(sigHex)) return false;
  const id = String((record && (record.id || record.wireHash)) || '').toLowerCase();
  if (!id) return false;
  try {
    const key = new Key({ public: `02${x}` });
    return !!key.verifySchnorr(receiptSigningMessage(id), Buffer.from(sigHex, 'hex'));
  } catch (_) {
    return false;
  }
}

/**
 * Phase 2: mark receipt for a reader.
 * Requires a BIP340 `receiptSig` over {@link receiptSigningMessage}(record.id).
 * @param {object} record
 * @param {*} pubkey
 * @param {string} [at]
 * @param {string} receiptSig
 * @returns {object}
 */
function markReceipt (record, pubkey, at, receiptSig) {
  const { x, slot } = _peerSlot(record, pubkey);
  if (receiptSig == null || receiptSig === '') {
    throw new Error('receiptSig required (BIP340 over message id)');
  }
  if (!verifyReceiptSignature(record, x, receiptSig)) {
    throw new Error('invalid receiptSig');
  }
  if (!slot.receivedAt) slot.receivedAt = at || new Date().toISOString();
  if (!slot.receiptAt) {
    slot.receiptAt = at || new Date().toISOString();
    slot.receiptSig = String(receiptSig).toLowerCase();
  }
  return record;
}

/**
 * @param {object} record
 * @param {*} pubkey
 * @returns {{ received: boolean, receipt: boolean }}
 */
function phaseFlags (record, pubkey) {
  const x = pubkeyXOnly(pubkey);
  const slot = x && record && record.peers ? record.peers[x] : null;
  return {
    received: !!(slot && slot.receivedAt),
    receipt: !!(slot && slot.receiptAt)
  };
}

/**
 * True when every reader has completed both phases.
 * @param {object} record
 * @returns {boolean}
 */
function allPhasesComplete (record) {
  const readers = (record && record.readers) || [];
  if (!readers.length) return false;
  return readers.every((r) => {
    const f = phaseFlags(record, r);
    return f.received && f.receipt;
  });
}

/**
 * Aggregate UI flags: lit only when all readers completed that phase.
 * @param {object} record
 * @returns {{ received: boolean, receipt: boolean }}
 */
function aggregatePhaseFlags (record) {
  const readers = (record && record.readers) || [];
  if (!readers.length) return { received: false, receipt: false };
  return {
    received: readers.every((r) => phaseFlags(record, r).received),
    receipt: readers.every((r) => phaseFlags(record, r).receipt)
  };
}

/**
 * Records still awaiting full 2PC (for local relay queues).
 * @param {object[]} records
 * @returns {object[]}
 */
function pendingForRelay (records) {
  return (Array.isArray(records) ? records : []).filter((r) => !allPhasesComplete(r));
}

module.exports = {
  normalizeReaders,
  receiptSigningMessage,
  createPending,
  markReceived,
  markReceipt,
  verifyReceiptSignature,
  phaseFlags,
  allPhasesComplete,
  aggregatePhaseFlags,
  pendingForRelay
};
