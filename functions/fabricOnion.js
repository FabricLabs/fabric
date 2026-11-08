'use strict';

/**
 * Directed onion / source-routed forwarding for Fabric AMP.
 *
 * Wire type {@link P2P_FORWARD} nests an inner Message so intermediate peers
 * forward without opening a direct TCP path from origin to destination — the
 * destination only sees the last hop's IP.
 *
 * Body schema (V1 fields):
 *   nextPeer — bytes32 x-only secp256k1 pubkey (same encoding as AMP `author`)
 *   ttl      — u8 remaining hops (must be ≥ 1 on create; peers drop ttl === 0)
 *   inner    — message (nested AMP frame bytes)
 *
 * Nesting: wrap from destination outward. Each hop peels when `nextPeer` matches
 * the local x-only key, then either delivers the payload or forwards the next
 * layer bit-identical to the following peer.
 *
 * This is **source-routed nesting**, not Sphinx/BOLT4 encryption. Hop IDs in
 * cleartext at each layer are visible to that hop; IP privacy comes from
 * directed single-peer forward (no mesh flood). Encrypt `inner` at the app
 * layer when confidentiality is required.
 *
 * @module @fabric/core/functions/fabricOnion
 */

const {
  P2P_FORWARD,
  P2P_FORWARD_MAX_HOPS
} = require('../constants');
const Message = require('../types/message');

const SCHEMA_P2P_FORWARD = Message.SCHEMA_P2P_FORWARD;

/**
 * Normalize a compressed (33) or x-only (32) pubkey to 32-byte x-only Buffer.
 * @param {Buffer|string|Uint8Array|null|undefined} value
 * @returns {Buffer}
 */
function toXOnlyPeerId (value) {
  if (value == null) return Buffer.alloc(32);
  let buf;
  if (Buffer.isBuffer(value)) {
    buf = value;
  } else if (ArrayBuffer.isView(value)) {
    buf = Buffer.from(value);
  } else {
    const s = String(value).trim();
    const hex = (s.startsWith('0x') || s.startsWith('0X')) ? s.slice(2) : s;
    if (!/^[0-9a-fA-F]+$/.test(hex) || (hex.length !== 64 && hex.length !== 66)) {
      throw new TypeError('toXOnlyPeerId: expected 32- or 33-byte hex pubkey');
    }
    buf = Buffer.from(hex, 'hex');
  }
  if (buf.length === 32) return Buffer.from(buf);
  if (buf.length === 33 && (buf[0] === 0x02 || buf[0] === 0x03)) {
    return Buffer.from(buf.subarray(1));
  }
  throw new TypeError(`toXOnlyPeerId: unsupported pubkey length ${buf.length}`);
}

/**
 * X-only pubkey bytes from a Key / Identity-like object.
 * @param {{ public?: { encodeCompressed: Function }, pubkey?: string, key?: object }} keyLike
 * @returns {Buffer}
 */
function xOnlyFromKey (keyLike) {
  if (!keyLike) throw new TypeError('xOnlyFromKey: key required');
  if (keyLike.public && typeof keyLike.public.encodeCompressed === 'function') {
    const compressed = Buffer.from(keyLike.public.encodeCompressed('hex'), 'hex');
    return toXOnlyPeerId(compressed);
  }
  if (keyLike.key) return xOnlyFromKey(keyLike.key);
  if (keyLike.pubkey) return toXOnlyPeerId(keyLike.pubkey);
  throw new TypeError('xOnlyFromKey: no public key material');
}

/**
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {boolean}
 */
function xOnlyEquals (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== 32 || b.length !== 32) {
    return false;
  }
  return a.equals(b);
}

/**
 * Ensure AMP frame bytes (Message instance or Buffer).
 * @param {Message|Buffer|Uint8Array} messageOrBuffer
 * @returns {Buffer}
 */
function toInnerBuffer (messageOrBuffer) {
  if (Buffer.isBuffer(messageOrBuffer)) return messageOrBuffer;
  if (ArrayBuffer.isView(messageOrBuffer)) return Buffer.from(messageOrBuffer);
  if (messageOrBuffer && typeof messageOrBuffer.toBuffer === 'function') {
    return messageOrBuffer.toBuffer();
  }
  throw new TypeError('inner must be a Message or Buffer');
}

/**
 * Build one signed {@code P2P_FORWARD} layer.
 * @param {object} opts
 * @param {Buffer|string} opts.nextPeer x-only or compressed pubkey of the intended hop
 * @param {Message|Buffer} opts.inner nested AMP frame
 * @param {object} opts.key signing Key (path builder / origin)
 * @param {number} [opts.ttl=1]
 * @returns {Message}
 */
function wrapForwardLayer (opts = {}) {
  const nextPeer = toXOnlyPeerId(opts.nextPeer);
  const inner = toInnerBuffer(opts.inner);
  const ttl = opts.ttl == null ? 1 : (Number(opts.ttl) | 0);
  if (ttl < 1 || ttl > 255) {
    throw new RangeError('wrapForwardLayer: ttl must be 1..255');
  }
  if (!opts.key) throw new TypeError('wrapForwardLayer: key required');
  if (!inner.length) throw new RangeError('wrapForwardLayer: empty inner');

  const msg = Message.fromFields('P2P_FORWARD', {
    nextPeer,
    ttl,
    inner
  });
  msg.signWithKey(opts.key);
  return msg;
}

/**
 * Nest {@code path} hops around {@code payload} (destination last).
 * {@code path[0]} is the immediate TCP peer; {@code path[path.length-1]} is the
 * final recipient that peels to the payload.
 *
 * @param {object} opts
 * @param {Array<Buffer|string>} opts.path hop pubkeys (x-only or compressed), length 1..MAX
 * @param {Message|Buffer} opts.payload innermost signed application Message (or bytes)
 * @param {object} opts.key originator signing key (signs every outer layer)
 * @param {number} [opts.maxHops] override {@link P2P_FORWARD_MAX_HOPS}
 * @returns {Message} outermost {@code P2P_FORWARD} ready to send to {@code path[0]}
 */
function wrapOnionPath (opts = {}) {
  const path = Array.isArray(opts.path) ? opts.path : [];
  const maxHops = Number(opts.maxHops) > 0 ? Number(opts.maxHops) : P2P_FORWARD_MAX_HOPS;
  if (!path.length) throw new RangeError('wrapOnionPath: path requires at least one hop');
  if (path.length > maxHops) {
    throw new RangeError(`wrapOnionPath: path length ${path.length} exceeds max ${maxHops}`);
  }
  if (!opts.key) throw new TypeError('wrapOnionPath: key required');

  let current = toInnerBuffer(opts.payload);
  for (let i = path.length - 1; i >= 0; i--) {
    const ttl = path.length - i;
    current = wrapForwardLayer({
      nextPeer: path[i],
      inner: current,
      ttl,
      key: opts.key
    }).toBuffer();
  }
  return Message.fromBuffer(current);
}

/**
 * Decode a {@code P2P_FORWARD} body, or null if not that type / malformed.
 * @param {Message} message
 * @returns {{ nextPeer: Buffer, ttl: number, inner: Buffer }|null}
 */
function tryDecodeForward (message) {
  if (!message) return null;
  const t = message.type || message.wireType || message.friendlyType;
  if (t !== 'P2P_FORWARD' && message.raw && message.raw.type) {
    const code = message.raw.type.readUInt32BE(0);
    if (code !== P2P_FORWARD) return null;
  } else if (t !== 'P2P_FORWARD') {
    return null;
  }
  const fields = typeof message.toFields === 'function' ? message.toFields() : null;
  if (!fields || !Buffer.isBuffer(fields.nextPeer) || !Buffer.isBuffer(fields.inner)) {
    return null;
  }
  return {
    nextPeer: fields.nextPeer,
    ttl: Number(fields.ttl) || 0,
    inner: fields.inner
  };
}

module.exports = {
  P2P_FORWARD,
  P2P_FORWARD_MAX_HOPS,
  SCHEMA_P2P_FORWARD,
  toXOnlyPeerId,
  xOnlyFromKey,
  xOnlyEquals,
  toInnerBuffer,
  wrapForwardLayer,
  wrapOnionPath,
  tryDecodeForward
};
