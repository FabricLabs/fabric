/**
 * BIP-340 Tagged Hash Implementation
 *
 * Computes tagged hash as specified in BIP-340:
 * tagged_hash(tag, msg) = SHA256(SHA256(tag) || SHA256(tag) || msg)
 *
 * Uses @noble/hashes for browser compatibility (avoids crypto-browserify digest errors).
 *
 * @module functions/taggedHash
 */

const { sha256 } = require('@noble/hashes/sha256');

/**
 * Compute BIP-340 tagged hash
 *
 * @param {String|Buffer} tag - Tag string (e.g., "Fabric/Message")
 * @param {Buffer} data - Data to hash
 * @returns {Buffer} 32-byte hash
 */
function taggedHash (tag, data) {
  if (!tag) throw new Error('Tag is required');
  if (!data) throw new Error('Data is required');

  // Convert tag to Buffer if it's a string
  if (typeof tag === 'string') {
    tag = Buffer.from(tag, 'utf8');
  }

  if (!Buffer.isBuffer(tag)) {
    throw new Error('Tag must be a string or Buffer');
  }

  if (!Buffer.isBuffer(data)) {
    throw new Error('Data must be a Buffer');
  }

  // SHA256(tag)
  const tagHash = Buffer.from(sha256(new Uint8Array(tag)));

  // SHA256(SHA256(tag) || SHA256(tag) || msg)
  const buffer = Buffer.concat([
    tagHash,
    tagHash,
    data
  ]);

  return Buffer.from(sha256(new Uint8Array(buffer)));
}

module.exports = taggedHash;
