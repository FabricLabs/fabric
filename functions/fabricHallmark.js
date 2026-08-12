'use strict';

/**
 * Fabric OP_RETURN hallmarks — short-format on-chain presence marks (40 bytes).
 *
 * Layout:
 *   [0..3]  magic              c0d3f33d (MAGIC_BYTES big-endian)
 *   [4..7]  tipHashSuffix      last 4 bytes of tip Bitcoin block hash
 *   [8..39] hallmarkCommitment SHA-256 over tip + contractId + latest state digests
 *
 * Not an AMP Message (208-byte header). On-chain only — no P2P broadcast.
 *
 * @module functions/fabricHallmark
 * @see docs/STATECHAIN.md
 */

const crypto = require('crypto');
const { fabricCanonicalJson, jsonSafe } = require('./fabricCanonicalJson');

const HALLMARK_MAGIC_HEX = 'c0d3f33d';
const HALLMARK_PAYLOAD_LENGTH = 40;
const HALLMARK_TIP_SUFFIX_LENGTH = 4;
const HALLMARK_COMMITMENT_KIND = 'FabricHallmarkCommitment';
const HALLMARK_MAGIC = Buffer.from(HALLMARK_MAGIC_HEX, 'hex');

/**
 * @param {string} hex
 * @param {number} byteLen
 * @returns {Buffer}
 */
function requireHexBytes (hex, byteLen) {
  const h = String(hex || '').replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${byteLen * 2}}$`).test(h)) {
    throw new Error(`expected ${byteLen * 2} hex chars, got ${h.length}`);
  }
  return Buffer.from(h, 'hex');
}

/**
 * Normalize a Bitcoin tip hash (64 hex) to 32 raw bytes.
 * @param {string} blockHashHex
 * @returns {Buffer}
 */
function tipHashBytesFromBlockHash (blockHashHex) {
  return requireHexBytes(blockHashHex, 32);
}

/**
 * Last 4 bytes of the tip block hash (fast scan filter).
 * @param {string} blockHashHex
 * @returns {Buffer}
 */
function tipHashSuffixFromBlockHash (blockHashHex) {
  const tip = tipHashBytesFromBlockHash(blockHashHex);
  return tip.subarray(tip.length - HALLMARK_TIP_SUFFIX_LENGTH);
}

/**
 * Normalize optional `{ clock, stateDigest }` snapshot for commitment.
 * @param {object|null|undefined} snap
 * @returns {{ clock: number, stateDigest: string|null }|null}
 */
function normalizeStateHead (snap) {
  if (snap == null) return null;
  if (typeof snap !== 'object') return null;
  const clock = Number(snap.clock);
  const dig = snap.stateDigest != null ? String(snap.stateDigest).replace(/^0x/i, '').toLowerCase() : null;
  return {
    clock: Number.isFinite(clock) ? clock : 0,
    // Malformed digests must not enter the commitment (treat as absent).
    stateDigest: dig && /^[0-9a-f]{64}$/.test(dig) ? dig : null
  };
}

/**
 * SHA-256 hex of the hallmark commitment (bytes 8–39 when encoded).
 *
 * @param {Object} opts
 * @param {string} opts.tipBlockHashHex
 * @param {string} opts.contractIdHex
 * @param {object|null} [opts.sidechain]
 * @param {object|null} [opts.contracts]
 * @returns {string} 64-char lowercase hex
 */
function deriveFabricHallmarkCommitmentHex (opts = {}) {
  const tipBlockHash = requireHexBytes(opts.tipBlockHashHex, 32).toString('hex');
  const contractId = requireHexBytes(opts.contractIdHex, 32).toString('hex');
  const body = {
    version: 1,
    kind: HALLMARK_COMMITMENT_KIND,
    tipBlockHash,
    contractId,
    state: {
      sidechain: normalizeStateHead(opts.sidechain),
      contracts: normalizeStateHead(opts.contracts)
    }
  };
  const canonical = fabricCanonicalJson(jsonSafe(body));
  return crypto.createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

/**
 * Encode a 40-byte hallmark payload.
 *
 * @param {Object} opts
 * @param {string} opts.tipBlockHashHex
 * @param {string} opts.commitmentHex - 64 hex chars (derived commitment)
 * @returns {Buffer}
 */
function encodeFabricHallmark (opts = {}) {
  const suffix = tipHashSuffixFromBlockHash(opts.tipBlockHashHex);
  const commitment = requireHexBytes(opts.commitmentHex, 32);
  return Buffer.concat([HALLMARK_MAGIC, suffix, commitment], HALLMARK_PAYLOAD_LENGTH);
}

/**
 * Derive commitment from tip + contract + state, then encode.
 *
 * @param {Object} opts
 * @param {string} opts.tipBlockHashHex
 * @param {string} opts.contractIdHex
 * @param {object|null} [opts.sidechain]
 * @param {object|null} [opts.contracts]
 * @returns {{ payload: Buffer, commitmentHex: string, tipHashSuffixHex: string }}
 */
function encodeFabricHallmarkFromState (opts = {}) {
  const commitmentHex = deriveFabricHallmarkCommitmentHex(opts);
  const payload = encodeFabricHallmark({
    tipBlockHashHex: opts.tipBlockHashHex,
    commitmentHex
  });
  return {
    payload,
    commitmentHex,
    tipHashSuffixHex: tipHashSuffixFromBlockHash(opts.tipBlockHashHex).toString('hex')
  };
}

/**
 * @param {Buffer|string} payload - raw bytes or hex
 * @returns {{ magicHex: string, tipHashSuffixHex: string, commitmentHex: string }|null}
 */
function decodeFabricHallmark (payload) {
  let buf;
  if (Buffer.isBuffer(payload)) {
    buf = payload;
  } else if (typeof payload === 'string') {
    const h = payload.replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(h) || h.length !== HALLMARK_PAYLOAD_LENGTH * 2) return null;
    buf = Buffer.from(h, 'hex');
  } else {
    return null;
  }
  if (buf.length !== HALLMARK_PAYLOAD_LENGTH) return null;
  if (!buf.subarray(0, 4).equals(HALLMARK_MAGIC)) return null;
  return {
    magicHex: HALLMARK_MAGIC_HEX,
    tipHashSuffixHex: buf.subarray(4, 8).toString('hex'),
    commitmentHex: buf.subarray(8, 40).toString('hex')
  };
}

/**
 * @param {Buffer|string} payload
 * @param {Object} opts
 * @param {string} opts.tipBlockHashHex
 * @param {string} [opts.commitmentHex]
 * @returns {boolean}
 */
function verifyFabricHallmark (payload, opts = {}) {
  const decoded = decodeFabricHallmark(payload);
  if (!decoded) return false;
  let expectedSuffix;
  try {
    expectedSuffix = tipHashSuffixFromBlockHash(opts.tipBlockHashHex).toString('hex');
  } catch (_) {
    return false;
  }
  if (decoded.tipHashSuffixHex !== expectedSuffix) return false;
  if (opts.commitmentHex != null) {
    let want;
    try {
      want = requireHexBytes(opts.commitmentHex, 32).toString('hex');
    } catch (_) {
      return false;
    }
    if (decoded.commitmentHex !== want) return false;
  }
  return true;
}

module.exports = {
  HALLMARK_MAGIC_HEX,
  // Fresh Buffer so consumers cannot mutate the module-internal magic bytes.
  get HALLMARK_MAGIC () {
    return Buffer.from(HALLMARK_MAGIC);
  },
  HALLMARK_PAYLOAD_LENGTH,
  HALLMARK_TIP_SUFFIX_LENGTH,
  HALLMARK_COMMITMENT_KIND,
  tipHashBytesFromBlockHash,
  tipHashSuffixFromBlockHash,
  deriveFabricHallmarkCommitmentHex,
  encodeFabricHallmark,
  encodeFabricHallmarkFromState,
  decodeFabricHallmark,
  verifyFabricHallmark
};
