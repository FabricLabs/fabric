'use strict';

/**
 * @fileoverview Verify the author of a raw AMP `Message` frame without
 * instantiating a {@link Message} or a {@link Key}. Fraud proofs carry the
 * exact bytes a counterparty put on the wire; a verifier only needs to know
 * (a) who signed them and (b) what the body was. Header layout and the
 * BIP-340 `Fabric/Message` tagged hash mirror `types/message.js` and the C
 * implementation.
 */

const { schnorr } = require('@noble/curves/secp256k1.js');
const taggedHash = require('./taggedHash');
const { HEADER_SIZE, MAGIC_BYTES } = require('../constants');

const OFFSETS = Object.freeze({
  magic: [0, 4],
  version: [4, 8],
  parent: [8, 40],
  author: [40, 72],
  type: [72, 76],
  size: [76, 80],
  hash: [80, 112],
  preimage: [112, 144],
  signature: [144, 208]
});

/**
 * Parse and verify a raw frame.
 * @param {Buffer|string} frame raw bytes or hex
 * @returns {{ ok: boolean, reason?: string, author?: string, type?: number, body?: Buffer, hash?: string, parent?: string }} `author` is the x-only hex pubkey that signed the frame
 */
function verifyFrameAuthor (frame) {
  let buffer;
  try {
    buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(String(frame || '').trim(), 'hex');
  } catch (_) {
    return { ok: false, reason: 'frame is not hex' };
  }
  if (buffer.length < HEADER_SIZE) return { ok: false, reason: 'frame shorter than an AMP header' };
  const magic = buffer.readUInt32BE(OFFSETS.magic[0]);
  if (magic !== MAGIC_BYTES) return { ok: false, reason: 'bad magic' };
  const size = buffer.readUInt32BE(OFFSETS.size[0]);
  const body = buffer.subarray(HEADER_SIZE);
  if (body.length !== size) return { ok: false, reason: 'body length does not match header size' };
  const author = buffer.subarray(...OFFSETS.author);
  const signature = buffer.subarray(...OFFSETS.signature);
  if (author.equals(Buffer.alloc(32))) return { ok: false, reason: 'frame is unsigned (zero author)' };
  const headerForHash = Buffer.concat([
    buffer.subarray(OFFSETS.magic[0], OFFSETS.signature[0]),
    Buffer.alloc(64)
  ]);
  const digest = taggedHash('Fabric/Message', Buffer.concat([headerForHash, body]));
  let ok = false;
  try { ok = schnorr.verify(signature, digest, author); } catch (_) { ok = false; }
  if (!ok) return { ok: false, reason: 'frame signature invalid' };
  return {
    ok: true,
    author: author.toString('hex'),
    type: buffer.readUInt32BE(OFFSETS.type[0]),
    body,
    hash: buffer.subarray(...OFFSETS.hash).toString('hex'),
    parent: buffer.subarray(...OFFSETS.parent).toString('hex')
  };
}

module.exports = { verifyFrameAuthor, OFFSETS };
