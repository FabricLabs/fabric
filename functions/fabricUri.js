'use strict';

/**
 * @fileoverview Canonical `fabric:<frame>` strings: one complete signed AMP
 * frame (208-byte header + body) carried across a trust boundary — a page and
 * a browser extension, an extension and a desktop app, a clipboard, a QR code.
 *
 * Encoding: base64url without padding (default) or hex. Decoding also accepts
 * standard base64, `0x` hex, and the legacy `base64,` / `b64,` / `hex,`
 * prefixes. `fabric://login`, `fabric://link`, and other hierarchical forms
 * are not opaque frames and are refused here.
 *
 * Decoding checks the frame (magic, size field, body hash, frame cap) and,
 * unless `allowUnsigned`, the BIP-340 signature of the author in the header.
 * A valid frame proves who wrote it and that the body is intact. It does not
 * say who it is for, when it expires, or whether it was seen before: message
 * types that cross a boundary carry those in their body (see
 * {@link module:@fabric/core/functions/passport}).
 *
 * @module functions/fabricUri
 */

const Message = require('../types/message');
const Hash256 = require('../types/hash256');
const { HEADER_SIZE, MAGIC_BYTES, MAX_FRAME_BYTES } = require('../constants');

/** URI scheme, including the colon. */
const FABRIC_URI_SCHEME = 'fabric:';

/** @private */
const LEGACY_PREFIXES = Object.freeze([
  ['base64,', 'base64'],
  ['b64,', 'base64'],
  ['hex,', 'hex']
]);

/** @private */
const ZERO_AUTHOR = Buffer.alloc(32);

/**
 * @private
 * @param {Message|Buffer|Uint8Array} input
 * @returns {Buffer}
 */
function frameBytes (input) {
  if (input instanceof Message) return input.toBuffer();
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  throw new TypeError('encodeFabricUri: Message or frame bytes required');
}

/**
 * Encode one AMP frame as a `fabric:` string.
 * @param {Message|Buffer|Uint8Array} input Signed Message or raw frame bytes.
 * @param {Object} [options]
 * @param {string} [options.encoding='base64url'] `base64url` or `hex`.
 * @returns {string}
 */
function encodeFabricUri (input, options = {}) {
  const buffer = frameBytes(input);
  if (buffer.length < HEADER_SIZE) throw new RangeError('frame shorter than an AMP header');
  if (buffer.length > MAX_FRAME_BYTES) throw new RangeError(`frame exceeds MAX_FRAME_BYTES (${MAX_FRAME_BYTES})`);
  const encoding = options.encoding || 'base64url';
  if (encoding === 'hex') return FABRIC_URI_SCHEME + buffer.toString('hex');
  if (encoding !== 'base64url') throw new TypeError(`unsupported fabric: encoding ${encoding}`);
  return FABRIC_URI_SCHEME + encodeBase64Url(buffer);
}

/**
 * Browser `buffer` polyfills have no `base64url` encoding, so derive it from `base64`.
 * @private
 * @param {Buffer} buffer
 * @returns {string}
 */
function encodeBase64Url (buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @private
 * @param {string} text
 * @returns {Buffer|null}
 */
function decodeBase64 (text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]+$/.test(normalized)) return null;
  if (normalized.length % 4 === 1) return null;
  return Buffer.from(normalized, 'base64');
}

/**
 * @private
 * @param {string} text
 * @returns {Buffer|null}
 */
function decodeHex (text) {
  const raw = text.replace(/^0x/i, '');
  if (!raw || raw.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

/**
 * @private
 * @param {Buffer|null} buffer
 * @returns {boolean}
 */
function hasMagic (buffer) {
  return !!buffer && buffer.length >= 4 && buffer.readUInt32BE(0) === MAGIC_BYTES;
}

/**
 * Split a `fabric:` string into frame bytes, without checking the frame.
 * @param {string} uri
 * @param {Object} [options]
 * @param {number} [options.maxBytes=MAX_FRAME_BYTES]
 * @returns {{ ok: true, buffer: Buffer, encoding: string }|{ ok: false, error: string }}
 */
function parseFabricUriBytes (uri, options = {}) {
  if (typeof uri !== 'string') return { ok: false, error: 'fabric: string required' };
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? Math.min(options.maxBytes, MAX_FRAME_BYTES)
    : MAX_FRAME_BYTES;
  let text = uri.trim();
  if (text.slice(0, FABRIC_URI_SCHEME.length).toLowerCase() !== FABRIC_URI_SCHEME) {
    return { ok: false, error: 'not a fabric: string' };
  }
  text = text.slice(FABRIC_URI_SCHEME.length);
  if (text.startsWith('//')) return { ok: false, error: 'fabric:// URLs are not opaque frames' };
  // Hex is 2 chars per byte, the longest encoding we accept.
  if (text.length > (maxBytes * 2) + 16) return { ok: false, error: 'fabric: string too long' };
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text);
    } catch (_) {
      return { ok: false, error: 'invalid percent-encoding' };
    }
  }
  text = text.replace(/\s+/g, '');

  let forced = null;
  for (const [prefix, encoding] of LEGACY_PREFIXES) {
    if (text.toLowerCase().startsWith(prefix)) {
      forced = encoding;
      text = text.slice(prefix.length);
      break;
    }
  }
  if (!text) return { ok: false, error: 'empty fabric: body' };

  let buffer = null;
  let encoding = null;
  if (forced === 'hex') {
    buffer = decodeHex(text);
    encoding = 'hex';
  } else if (forced === 'base64') {
    buffer = decodeBase64(text);
    encoding = 'base64';
  } else {
    const hex = decodeHex(text);
    if (hasMagic(hex)) {
      buffer = hex;
      encoding = 'hex';
    } else {
      buffer = decodeBase64(text);
      encoding = /[-_]/.test(text) || !/[+/=]/.test(text) ? 'base64url' : 'base64';
    }
  }
  if (!buffer) return { ok: false, error: `invalid ${encoding || 'fabric:'} encoding` };
  if (buffer.length < HEADER_SIZE) return { ok: false, error: 'frame shorter than an AMP header' };
  if (buffer.length > maxBytes) return { ok: false, error: `frame exceeds ${maxBytes} bytes` };
  if (!hasMagic(buffer)) return { ok: false, error: 'bad magic' };
  return { ok: true, buffer, encoding };
}

/**
 * Decode and check a `fabric:` string.
 * @param {string} uri
 * @param {Object} [options]
 * @param {number} [options.maxBytes=MAX_FRAME_BYTES] Frame cap (never above `MAX_FRAME_BYTES`).
 * @param {Array<string|number>} [options.allowedTypes] Wire names, friendly names, or opcodes; others are refused.
 * @param {boolean} [options.allowUnsigned=false] Accept frames with a zero author (no signature).
 * @param {boolean} [options.allowUnknownTypes=false] Accept opcodes this build does not know.
 * @returns {{ ok: true, message: Message, buffer: Buffer, encoding: string, type: string, author: string|null, signed: boolean }|{ ok: false, error: string }}
 */
function decodeFabricUri (uri, options = {}) {
  const parsed = parseFabricUriBytes(uri, options);
  if (!parsed.ok) return parsed;
  const { buffer, encoding } = parsed;

  const size = buffer.readUInt32BE(76);
  const body = buffer.subarray(HEADER_SIZE);
  if (body.length !== size) return { ok: false, error: 'body length does not match header size' };
  const hash = buffer.subarray(80, 112).toString('hex');
  if (Hash256.doubleDigest(body) !== hash) return { ok: false, error: 'body hash mismatch' };

  const opcode = buffer.readUInt32BE(72);
  const type = Message.canonicalTypeName(opcode);
  if (!type && !options.allowUnknownTypes) return { ok: false, error: `unknown message type ${opcode}` };
  if (Array.isArray(options.allowedTypes) && options.allowedTypes.length) {
    const allowed = options.allowedTypes.some((t) => Message.canonicalTypeCode(t) === opcode);
    if (!allowed) return { ok: false, error: `message type ${type || opcode} not allowed here` };
  }

  const authorBytes = buffer.subarray(40, 72);
  const signed = !authorBytes.equals(ZERO_AUTHOR);
  if (!signed && !options.allowUnsigned) return { ok: false, error: 'frame is unsigned' };
  if (signed) {
    const verified = Message.verifyFrameAuthor(buffer);
    if (!verified.ok) return { ok: false, error: verified.reason || 'frame signature invalid' };
  } else if (!buffer.subarray(144, HEADER_SIZE).equals(Buffer.alloc(64))) {
    return { ok: false, error: 'unsigned frame carries a signature' };
  }

  const message = Message.fromBuffer(Buffer.from(buffer));
  return {
    ok: true,
    message,
    buffer,
    encoding,
    type: type || String(opcode),
    author: signed ? authorBytes.toString('hex') : null,
    signed
  };
}

/**
 * True when `value` looks like an opaque `fabric:` frame string (cheap check, no decode).
 * @param {*} value
 * @returns {boolean}
 */
function isFabricUri (value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.slice(0, FABRIC_URI_SCHEME.length).toLowerCase() === FABRIC_URI_SCHEME &&
    !text.slice(FABRIC_URI_SCHEME.length).startsWith('//') &&
    text.length > FABRIC_URI_SCHEME.length;
}

module.exports = {
  FABRIC_URI_SCHEME,
  encodeFabricUri,
  decodeFabricUri,
  parseFabricUriBytes,
  isFabricUri
};
