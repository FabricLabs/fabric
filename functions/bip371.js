/**
 * BIP-371 Taproot fields for PSBT inputs (`PSBT_IN_TAP_INTERNAL_KEY`,
 * `PSBT_IN_TAP_LEAF_SCRIPT`, optional `PSBT_IN_TAP_MERKLE_ROOT`).
 *
 * Inventory HTLC and contract-vault leaf spends already populate these bags;
 * this helper is the named construction so hardware / collaborative signers
 * see one shape.
 *
 * @fileoverview BIP-371 taproot PSBT input fields.
 * @module functions/bip371
 */
'use strict';

/** BIP-341 leaf version for tapscript (0xc0). */
const LEAF_VERSION_TAPSCRIPT = 0xc0;

/**
 * @param {Buffer|Uint8Array|string} value
 * @param {string} [encoding]
 * @returns {Buffer|null}
 * @private
 */
function asBuffer (value, encoding = 'hex') {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    const hex = String(value).trim().replace(/^0x/i, '');
    if (!hex || hex.length % 2) return null;
    return Buffer.from(hex, encoding);
  }
  return null;
}

/**
 * One `PSBT_IN_TAP_LEAF_SCRIPT` entry (script + control block + leaf version).
 *
 * @param {Object} opts
 * @param {Buffer|Uint8Array|string} opts.script
 * @param {Buffer|Uint8Array|string} opts.controlBlock
 * @param {number} [opts.leafVersion]
 * @returns {{ leafVersion: number, script: Buffer, controlBlock: Buffer }}
 */
function tapLeafScriptEntry (opts = {}) {
  const script = asBuffer(opts.script);
  const controlBlock = asBuffer(opts.controlBlock);
  if (!script || !script.length) {
    throw new Error('BIP371 tapLeafScript requires script bytes');
  }
  if (!controlBlock || controlBlock.length < 33) {
    throw new Error('BIP371 controlBlock must be at least 33 bytes');
  }
  const leafVersion = opts.leafVersion != null
    ? Number(opts.leafVersion)
    : LEAF_VERSION_TAPSCRIPT;
  if (!Number.isInteger(leafVersion) || leafVersion < 0 || leafVersion > 255) {
    throw new Error('BIP371 leafVersion must be an 8-bit integer');
  }
  return { leafVersion, script, controlBlock };
}

/**
 * Taproot PSBT input fields for a script-path spend.
 *
 * Spread onto `Psbt#addInput` alongside `hash` / `index` / `witnessUtxo`.
 *
 * @param {Object} opts
 * @param {Buffer|Uint8Array|string} opts.tapInternalKey 32-byte x-only internal key
 * @param {Buffer|Uint8Array|string} opts.script tapscript for this leaf
 * @param {Buffer|Uint8Array|string} opts.controlBlock BIP-341 control block
 * @param {number} [opts.leafVersion]
 * @param {Buffer|Uint8Array|string} [opts.tapMerkleRoot] optional 32-byte merkle root
 * @returns {Object} `tapInternalKey`, `tapLeafScript`; `tapMerkleRoot` when provided
 */
function taprootPsbtInputFields (opts = {}) {
  const tapInternalKey = asBuffer(opts.tapInternalKey);
  if (!tapInternalKey || tapInternalKey.length !== 32) {
    throw new Error('BIP371 tapInternalKey must be 32 bytes (x-only)');
  }
  const fields = {
    tapInternalKey,
    tapLeafScript: [tapLeafScriptEntry(opts)]
  };
  if (opts.tapMerkleRoot != null && opts.tapMerkleRoot !== '') {
    const tapMerkleRoot = asBuffer(opts.tapMerkleRoot);
    if (!tapMerkleRoot || tapMerkleRoot.length !== 32) {
      throw new Error('BIP371 tapMerkleRoot must be 32 bytes');
    }
    fields.tapMerkleRoot = tapMerkleRoot;
  }
  return fields;
}

module.exports = {
  LEAF_VERSION_TAPSCRIPT,
  tapLeafScriptEntry,
  taprootPsbtInputFields
};
