'use strict';

/**
 * Boneh–Lynn–Shacham signatures for Fabric federations.
 *
 * Ciphersuite: BLS12-381 minimal public-key size (IETF basic scheme),
 * DST `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_` via
 * `@noble/curves` `longSignatures`.
 *
 * - secret keys: 32-byte scalars
 * - public keys: 48-byte compressed G1
 * - signatures: 96-byte compressed G2
 *
 * Federation members keep their secp256k1 validator identity. A BLS key is
 * derived from that Fabric private key (HKDF-SHA256). A portable witness
 * bundle is a BLS signature over the federation message, a Schnorr link from
 * the secp256k1 key over the BLS public key, and a BLS proof of possession
 * over the secp256k1 pubkey. Threshold checks count those bundles. They do
 * not aggregate public keys, so a rogue-key sum cannot satisfy k-of-n.
 *
 * `aggregateSignatures` / `verifyAggregate` are the n-of-n algebraic helpers.
 * Callers that aggregate must already trust the public-key set.
 *
 * Bitcoin vault spends stay BIP340 / Taproot. This module authorizes the same
 * canonical federation signing strings (Beacon epochs, sidechain patches).
 *
 * @fileoverview BLS12-381 federation signatures.
 * @module functions/bls
 */

const crypto = require('crypto');
const Key = require('../types/key');

const SCHEME_SCHNORR = 'schnorr';
const SCHEME_BLS = 'bls';
const CIPHERSUITE = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_';
const PUBLIC_KEY_BYTES = 48;
const SIGNATURE_BYTES = 96;
const SECRET_KEY_BYTES = 32;
const SCHNORR_SIGNATURE_BYTES = 64;
const POP_PREFIX = 'Fabric/BLS/PoP/v1:';
const HKDF_SALT = Buffer.from('Fabric-BLS-v1', 'utf8');
const HKDF_INFO = Buffer.from('federation-signer', 'utf8');

let suiteCache = null;

/**
 * @returns {object} noble longSignatures (G1 public keys, G2 signatures)
 * @private
 */
function suite () {
  if (suiteCache) return suiteCache;
  const mod = require('@noble/curves/bls12-381.js');
  const curve = mod && (mod.bls12_381 || (mod.default && mod.default.bls12_381));
  if (!curve || !curve.longSignatures) {
    throw new Error('BLS12-381 longSignatures are unavailable');
  }
  suiteCache = curve.longSignatures;
  return suiteCache;
}

/**
 * @param {string|boolean|number|null|undefined} value
 * @returns {'schnorr'|'bls'}
 */
function normalizeSignatureScheme (value) {
  if (value === true || value === 1) return SCHEME_BLS;
  if (value === false || value === 0 || value == null) return SCHEME_SCHNORR;
  const s = String(value).trim().toLowerCase();
  if (s === 'bls' || s === 'bls12-381' || s === 'bls12_381' || s === 'true') return SCHEME_BLS;
  return SCHEME_SCHNORR;
}

/**
 * @returns {number}
 * @private
 */
function seedLength () {
  const n = suite().lengths && suite().lengths.seed;
  return Number(n) || 48;
}

/**
 * @param {Buffer} buf
 * @returns {Uint8Array}
 * @private
 */
function toU8 (buf) {
  return Uint8Array.from(buf);
}

/**
 * @param {Buffer|Uint8Array|string} input
 * @param {number|null} expected
 * @param {string} label
 * @returns {Buffer}
 * @private
 */
function bytesFromHex (input, expected, label) {
  let buf;
  if (Buffer.isBuffer(input)) buf = input;
  else if (input instanceof Uint8Array) buf = Buffer.from(input);
  else if (typeof input === 'string') {
    const hex = input.trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]*$/.test(hex) || (hex.length % 2) !== 0) {
      throw new TypeError(label + ' must be hex or bytes');
    }
    buf = Buffer.from(hex, 'hex');
  } else {
    throw new TypeError(label + ' must be hex or bytes');
  }
  if (expected != null && buf.length !== expected) {
    throw new TypeError(label + ' must be ' + expected + ' bytes, got ' + buf.length);
  }
  return buf;
}

/**
 * @param {Buffer|Uint8Array|string|object} message
 * @returns {Buffer}
 * @private
 */
function messageBytes (message) {
  if (Buffer.isBuffer(message)) return message;
  if (message instanceof Uint8Array) return Buffer.from(message);
  if (typeof message === 'string') return Buffer.from(message, 'utf8');
  if (message && message.data != null) return messageBytes(message.data);
  throw new TypeError('message must be bytes or a string');
}

/**
 * @param {object|Uint8Array|Buffer} point
 * @returns {Buffer}
 * @private
 */
function pointToBuffer (point) {
  if (Buffer.isBuffer(point)) return Buffer.from(point);
  if (point instanceof Uint8Array) return Buffer.from(point);
  if (point && typeof point.toBytes === 'function') return Buffer.from(point.toBytes());
  if (point && typeof point.toRawBytes === 'function') return Buffer.from(point.toRawBytes(true));
  throw new TypeError('unexpected BLS point');
}

/**
 * Fresh BLS keypair. Pass a seed of {@link seedLength} bytes for a deterministic key.
 * @param {Buffer|Uint8Array|string} [seed]
 * @returns {{ secretKey: Buffer, publicKey: Buffer }}
 */
function keygen (seed) {
  const s = suite();
  const out = seed == null
    ? s.keygen()
    : s.keygen(toU8(bytesFromHex(seed, seedLength(), 'seed')));
  return {
    secretKey: Buffer.from(out.secretKey),
    publicKey: pointToBuffer(out.publicKey)
  };
}

/**
 * Deterministic federation BLS key from a 32-byte Fabric (secp256k1) private key.
 * @param {Buffer|Uint8Array|string} fabricPrivateKey
 * @returns {{ secretKey: Buffer, publicKey: Buffer }}
 */
function deriveFederationSigner (fabricPrivateKey) {
  const ikm = bytesFromHex(fabricPrivateKey, SECRET_KEY_BYTES, 'fabric private key');
  const seed = Buffer.from(crypto.hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, seedLength()));
  return keygen(seed);
}

/**
 * @param {Buffer|Uint8Array|string} secretKey
 * @returns {Buffer} 48-byte compressed G1 public key
 */
function getPublicKey (secretKey) {
  const sk = bytesFromHex(secretKey, SECRET_KEY_BYTES, 'secret key');
  return pointToBuffer(suite().getPublicKey(toU8(sk)));
}

/**
 * Sign UTF-8 or raw message bytes. Hash-to-curve uses the ciphersuite DST.
 * @param {Buffer|Uint8Array|string|object} message
 * @param {Buffer|Uint8Array|string} secretKey
 * @returns {Buffer} 96-byte compressed G2 signature
 */
function sign (message, secretKey) {
  const s = suite();
  const sk = bytesFromHex(secretKey, SECRET_KEY_BYTES, 'secret key');
  const hashed = s.hash(toU8(messageBytes(message)));
  return pointToBuffer(s.sign(hashed, toU8(sk)));
}

/**
 * @param {Buffer|Uint8Array|string} signature
 * @param {Buffer|Uint8Array|string|object} message
 * @param {Buffer|Uint8Array|string} publicKey
 * @returns {boolean}
 */
function verify (signature, message, publicKey) {
  try {
    const sig = bytesFromHex(signature, SIGNATURE_BYTES, 'signature');
    const pk = bytesFromHex(publicKey, PUBLIC_KEY_BYTES, 'public key');
    const hashed = suite().hash(toU8(messageBytes(message)));
    return suite().verify(toU8(sig), hashed, toU8(pk)) === true;
  } catch (_) {
    return false;
  }
}

/**
 * Sum signatures over one message (n-of-n). Empty input throws.
 * @param {Array<Buffer|Uint8Array|string>} signatures
 * @returns {Buffer}
 */
function aggregateSignatures (signatures) {
  if (!Array.isArray(signatures) || signatures.length < 1) {
    throw new TypeError('at least one BLS signature is required');
  }
  const points = signatures.map((sig) => toU8(bytesFromHex(sig, SIGNATURE_BYTES, 'signature')));
  return pointToBuffer(suite().aggregateSignatures(points));
}

/**
 * Sum public keys. Empty input throws.
 * @param {Array<Buffer|Uint8Array|string>} publicKeys
 * @returns {Buffer}
 */
function aggregatePublicKeys (publicKeys) {
  if (!Array.isArray(publicKeys) || publicKeys.length < 1) {
    throw new TypeError('at least one BLS public key is required');
  }
  const points = publicKeys.map((pk) => toU8(bytesFromHex(pk, PUBLIC_KEY_BYTES, 'public key')));
  return pointToBuffer(suite().aggregatePublicKeys(points));
}

/**
 * Verify one aggregate signature against the sum of public keys (same message).
 * @param {Buffer|Uint8Array|string} signature
 * @param {Buffer|Uint8Array|string|object} message
 * @param {Array<Buffer|Uint8Array|string>} publicKeys
 * @returns {boolean}
 */
function verifyAggregate (signature, message, publicKeys) {
  try {
    const agg = aggregatePublicKeys(publicKeys);
    return verify(signature, message, agg);
  } catch (_) {
    return false;
  }
}

/**
 * Portable federation witness entry for one secp256k1 validator.
 * @param {Buffer|Uint8Array|string|object} message
 * @param {object} fabricKey Fabric {@link Key} with a private key
 * @returns {{ v: number, blsPublicKey: string, signature: string, pop: string, link: string }}
 */
function createFederationBlsBundle (message, fabricKey) {
  if (!fabricKey || !fabricKey.private) {
    throw new Error('Fabric private key required for a federation BLS bundle');
  }
  if (!fabricKey.public || typeof fabricKey.public.encodeCompressed !== 'function') {
    throw new Error('Fabric public key required for a federation BLS bundle');
  }
  const secpPubkey = String(fabricKey.public.encodeCompressed('hex')).trim().toLowerCase();
  const derived = deriveFederationSigner(fabricKey.private);
  const blsPublicKey = derived.publicKey.toString('hex');
  const pop = sign(Buffer.from(POP_PREFIX + secpPubkey, 'utf8'), derived.secretKey);
  const signature = sign(message, derived.secretKey);
  const link = fabricKey.signSchnorr(derived.publicKey);
  return {
    v: 1,
    blsPublicKey,
    signature: signature.toString('hex'),
    pop: pop.toString('hex'),
    link: Buffer.isBuffer(link) ? link.toString('hex') : Buffer.from(link).toString('hex')
  };
}

/**
 * @param {*} entry
 * @returns {object|null}
 * @private
 */
function parseBundle (entry) {
  if (!entry) return null;
  if (typeof entry === 'object') return entry;
  if (typeof entry === 'string') {
    const s = entry.trim();
    if (!s.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * @param {Buffer|Uint8Array|string|object} message
 * @param {string} secpPubkey compressed secp256k1 hex
 * @param {object|string} bundle
 * @returns {boolean}
 */
function verifyFederationBlsBundle (message, secpPubkey, bundle) {
  const parsed = parseBundle(bundle);
  if (!parsed || Number(parsed.v) !== 1) return false;
  const pk = String(secpPubkey || '').trim().toLowerCase();
  if (!/^0[23][0-9a-f]{64}$/.test(pk)) return false;
  const blsPk = String(parsed.blsPublicKey || '').trim().toLowerCase();
  const sig = String(parsed.signature || '').trim().toLowerCase();
  const pop = String(parsed.pop || '').trim().toLowerCase();
  const link = String(parsed.link || '').trim().toLowerCase();
  if (blsPk.length !== PUBLIC_KEY_BYTES * 2) return false;
  if (sig.length !== SIGNATURE_BYTES * 2) return false;
  if (pop.length !== SIGNATURE_BYTES * 2) return false;
  if (link.length !== SCHNORR_SIGNATURE_BYTES * 2) return false;
  try {
    const key = new Key({ pubkey: pk });
    if (!key.verifySchnorr(Buffer.from(blsPk, 'hex'), Buffer.from(link, 'hex'))) return false;
    if (!verify(pop, Buffer.from(POP_PREFIX + pk, 'utf8'), blsPk)) return false;
    if (!verify(sig, message, blsPk)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * k-of-n over secp256k1 validator ids. Each `witness.signatures[pubkey]` is a bundle.
 * Duplicate validator ids count once.
 * @param {Buffer|Uint8Array|string|object} message
 * @param {object} witness
 * @param {string[]} validatorPubkeys
 * @param {number} [threshold=1]
 * @returns {boolean}
 */
function verifyFederationBlsWitness (message, witness, validatorPubkeys, threshold = 1) {
  if (!witness || !witness.signatures || typeof witness.signatures !== 'object') return false;
  const pubkeys = Array.from(new Set(
    (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])
      .filter((p) => typeof p === 'string' && p)
  ));
  const thr = Number(threshold);
  if (!Number.isInteger(thr) || thr < 1) return false;
  let valid = 0;
  for (const pubkey of pubkeys) {
    const entry = witness.signatures[pubkey];
    if (!verifyFederationBlsBundle(message, pubkey, entry)) continue;
    valid++;
    if (valid >= thr) return true;
  }
  return false;
}

module.exports = {
  SCHEME_SCHNORR,
  SCHEME_BLS,
  CIPHERSUITE,
  PUBLIC_KEY_BYTES,
  SIGNATURE_BYTES,
  SECRET_KEY_BYTES,
  POP_PREFIX,
  normalizeSignatureScheme,
  keygen,
  deriveFederationSigner,
  getPublicKey,
  sign,
  verify,
  aggregateSignatures,
  aggregatePublicKeys,
  verifyAggregate,
  createFederationBlsBundle,
  verifyFederationBlsBundle,
  verifyFederationBlsWitness
};
