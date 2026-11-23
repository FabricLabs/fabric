'use strict';

const crypto = require('crypto');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');
const { stableStringify } = require('../functions/fabricCanonicalJson');
const { verifyBlob } = require('./document');
function verifyInclusion (inclusion, opts) {
  return require('./block').verifyInclusion(inclusion, opts);
}
const Message = require('./message');
const { P2P_FILE_SEND } = require('../constants');
const adaptor = (function () {
/**
 * BIP-340 Schnorr adaptor signatures.
 *
 * A pre-signature on `message` under `publicKey` for the adaptor point
 * `T = t·G` is `R̂ ‖ s'` (65 bytes): the compressed final nonce `R̂ = k·G + T`
 * and `s' = k + e·d`, where `k` is negated when `R̂` has an odd y so that the
 * completed signature `(x(R̂), s' ± t)` is a valid BIP-340 signature. Anyone
 * holding the pre-signature and the completed signature learns `t`.
 *
 * Adapting and extracting follow secp256k1-zkp `musig_adapt` /
 * `musig_extract_adaptor` (t is negated when the final nonce has an odd y);
 * {@link module:types/witness/musig2Adaptor} uses the same arithmetic for
 * 64-byte MuSig2 pre-signatures plus their nonce parity.
 *
 * @module types/witness/adaptor
 */

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const taggedHash = require('./hash256').tagged;

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

const NONCE_TAG = 'FabricAdaptor/nonce';
const PRE_SIGNATURE_BYTES = 65;

function toBytes (value, name, length) {
  let buf;
  if (Buffer.isBuffer(value)) buf = value;
  else if (value instanceof Uint8Array) buf = Buffer.from(value);
  else if (typeof value === 'string' && /^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0) buf = Buffer.from(value, 'hex');
  else throw new TypeError(`${name} must be a Buffer, Uint8Array, or hex string`);
  if (length != null && buf.length !== length) throw new RangeError(`${name} must be ${length} bytes`);
  return buf;
}

function toInt (buf) {
  return buf.length ? BigInt('0x' + buf.toString('hex')) : 0n;
}

function scalarBytes (x) {
  return Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
}

function mod (x) {
  const r = x % N;
  return r < 0n ? r + N : r;
}

function secretScalar (value, name) {
  const x = toInt(toBytes(value, name, 32));
  if (x <= 0n || x >= N) throw new RangeError(`${name} must be in 1..n-1`);
  return x;
}

function point (value, name) {
  const buf = toBytes(value, name, 33);
  if (buf[0] !== 0x02 && buf[0] !== 0x03) throw new RangeError(`${name} must be a compressed point`);
  return Point.fromBytes(buf);
}

function liftX (value, name) {
  const buf = toBytes(value, name);
  if (buf.length === 33) return liftX(buf.subarray(1), name);
  if (buf.length !== 32) throw new RangeError(`${name} must be 32 (x-only) or 33 bytes`);
  return Point.fromBytes(Buffer.concat([Buffer.from([0x02]), buf]));
}

function hasEvenY (P) {
  return (P.toAffine().y & 1n) === 0n;
}

function compressed (P) {
  return Buffer.from(P.toBytes(true));
}

function xOnly (P) {
  return compressed(P).subarray(1);
}

function mulPublic (P, k) {
  return k === 0n ? Point.ZERO : P.multiplyUnsafe(k);
}

function challenge (rx, px, message) {
  return mod(toInt(taggedHash('BIP0340/challenge', Buffer.concat([rx, px, message]))));
}

/**
 * Pre-sign `message` for the adaptor point `adaptor`.
 *
 * @param {Buffer|string} secretKey 32-byte secret key
 * @param {Buffer|string} message message (BIP-340 allows any length)
 * @param {Buffer|string} adaptor 33-byte compressed adaptor point T
 * @param {Object} [options]
 * @param {Buffer|string} [options.aux] 32 bytes of auxiliary randomness (default: fresh random)
 * @returns {Buffer} 65-byte pre-signature `R̂ ‖ s'`
 */
function preSign (secretKey, message, adaptor, options = {}) {
  const d0 = secretScalar(secretKey, 'secretKey');
  const msg = toBytes(message, 'message');
  const T = point(adaptor, 'adaptor');
  const P = G.multiply(d0);
  const d = hasEvenY(P) ? d0 : N - d0;
  const px = xOnly(P);
  const aux = options.aux != null ? toBytes(options.aux, 'aux', 32) : crypto.randomBytes(32);
  const masked = scalarBytes(d);
  const auxHash = taggedHash('BIP0340/aux', aux);
  for (let i = 0; i < 32; i++) masked[i] ^= auxHash[i];
  const k0 = mod(toInt(taggedHash(NONCE_TAG, Buffer.concat([masked, compressed(T), px, msg]))));
  masked.fill(0);
  if (k0 === 0n) throw new Error('adaptor nonce is zero');
  const Rhat = G.multiply(k0).add(T);
  if (Rhat.equals(Point.ZERO)) throw new Error('adaptor final nonce is infinite');
  const k = hasEvenY(Rhat) ? k0 : N - k0;
  const e = challenge(xOnly(Rhat), px, msg);
  const preSignature = Buffer.concat([compressed(Rhat), scalarBytes(mod(k + e * d))]);
  if (!preVerify(preSignature, msg, px, adaptor)) throw new Error('pre-signature failed self-check');
  return preSignature;
}

/**
 * Check that `preSignature` completes, with the secret of `adaptor`, to a valid
 * BIP-340 signature on `message` under `publicKey`.
 *
 * @param {Buffer|string} preSignature 65-byte `R̂ ‖ s'`
 * @param {Buffer|string} message
 * @param {Buffer|string} publicKey 32-byte x-only or 33-byte compressed
 * @param {Buffer|string} adaptor 33-byte compressed adaptor point T
 * @returns {boolean}
 */
function preVerify (preSignature, message, publicKey, adaptor) {
  try {
    const pre = toBytes(preSignature, 'preSignature', PRE_SIGNATURE_BYTES);
    const Rhat = point(pre.subarray(0, 33), 'preSignature nonce');
    const s = toInt(pre.subarray(33));
    if (s >= N) return false;
    const P = liftX(publicKey, 'publicKey');
    const T = point(adaptor, 'adaptor');
    const e = challenge(xOnly(Rhat), xOnly(P), toBytes(message, 'message'));
    let Rk = Rhat.subtract(T);
    if (Rk.equals(Point.ZERO)) return false;
    if (!hasEvenY(Rhat)) Rk = Rk.negate();
    return mulPublic(G, s).equals(Rk.add(mulPublic(P, e)));
  } catch {
    return false;
  }
}

/**
 * Complete a 64-byte pre-signature (`x(R̂) ‖ s'`) whose final nonce has `nonceParity`.
 *
 * @param {Buffer|string} preSignature 64 bytes
 * @param {Buffer|string} secret 32-byte adaptor secret t
 * @param {number} nonceParity 1 when the final nonce has an odd y
 * @returns {Buffer} 64-byte BIP-340 signature
 */
function adaptXonly (preSignature, secret, nonceParity) {
  const pre = toBytes(preSignature, 'preSignature', 64);
  if (nonceParity !== 0 && nonceParity !== 1) throw new RangeError('nonceParity must be 0 or 1');
  const s = toInt(pre.subarray(32));
  if (s >= N) throw new RangeError('pre-signature s is out of range');
  const t = secretScalar(secret, 'secret');
  return Buffer.concat([pre.subarray(0, 32), scalarBytes(mod(nonceParity ? s - t : s + t))]);
}

/**
 * Recover the adaptor secret from a completed signature and its 64-byte pre-signature.
 *
 * @param {Buffer|string} signature 64-byte BIP-340 signature
 * @param {Buffer|string} preSignature 64 bytes
 * @param {number} nonceParity
 * @param {Buffer|string} [adaptor] when given, the secret must match this point
 * @returns {Buffer} 32-byte secret t
 */
function extractXonly (signature, preSignature, nonceParity, adaptor) {
  const sig = toBytes(signature, 'signature', 64);
  const pre = toBytes(preSignature, 'preSignature', 64);
  if (nonceParity !== 0 && nonceParity !== 1) throw new RangeError('nonceParity must be 0 or 1');
  if (!sig.subarray(0, 32).equals(pre.subarray(0, 32))) throw new Error('signature and pre-signature nonces differ');
  const s = toInt(sig.subarray(32));
  const sPre = toInt(pre.subarray(32));
  if (s >= N || sPre >= N) throw new RangeError('signature s is out of range');
  const t = mod(nonceParity ? sPre - s : s - sPre);
  if (t === 0n) throw new Error('no adaptor secret in this signature');
  if (adaptor != null && !G.multiply(t).equals(point(adaptor, 'adaptor'))) {
    throw new Error('extracted secret does not match the adaptor point');
  }
  return scalarBytes(t);
}

function splitPreSignature (preSignature) {
  const pre = toBytes(preSignature, 'preSignature', PRE_SIGNATURE_BYTES);
  if (pre[0] !== 0x02 && pre[0] !== 0x03) throw new RangeError('preSignature nonce must be compressed');
  return { xonly: Buffer.concat([pre.subarray(1, 33), pre.subarray(33)]), nonceParity: pre[0] === 0x03 ? 1 : 0 };
}

/**
 * Complete a 65-byte pre-signature with the adaptor secret.
 *
 * @param {Buffer|string} preSignature 65-byte `R̂ ‖ s'`
 * @param {Buffer|string} secret 32-byte adaptor secret t
 * @returns {Buffer} 64-byte BIP-340 signature
 */
function adapt (preSignature, secret) {
  const { xonly, nonceParity } = splitPreSignature(preSignature);
  return adaptXonly(xonly, secret, nonceParity);
}

/**
 * Recover the adaptor secret from a completed signature and its 65-byte pre-signature.
 *
 * @param {Buffer|string} signature 64-byte BIP-340 signature
 * @param {Buffer|string} preSignature 65-byte `R̂ ‖ s'`
 * @param {Buffer|string} [adaptor] when given, the secret must match this point
 * @returns {Buffer} 32-byte secret t
 */
function extract (signature, preSignature, adaptor) {
  const { xonly, nonceParity } = splitPreSignature(preSignature);
  return extractXonly(signature, xonly, nonceParity, adaptor);
}
  return {
    NONCE_TAG,
    PRE_SIGNATURE_BYTES,
    preSign,
    preVerify,
    adapt,
    extract,
    adaptXonly,
    extractXonly
  };
})();
const bls = (function () {
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
 * bundle (`v: 2`) is a BLS signature over the federation message, a Schnorr
 * link from the secp256k1 key over `LINK_PREFIX` + the BLS public key (hex),
 * and a BLS proof of possession
 * over the secp256k1 pubkey. Threshold checks count those bundles. They do
 * not aggregate public keys, so a rogue-key sum cannot satisfy k-of-n.
 *
 * The link is BIP340 over `taggedHash('Fabric/BLSBinding', LINK_PREFIX + key)`;
 * only `v: 3` bundles verify.
 *
 * `aggregateSignatures` / `verifyAggregate` are the n-of-n algebraic helpers.
 * Callers that aggregate must already trust the public-key set.
 *
 * Bitcoin vault spends stay BIP340 / Taproot. This module authorizes the same
 * canonical federation signing strings (Beacon epochs, sidechain patches).
 *
 * @fileoverview BLS12-381 federation signatures.
 */

const crypto = require('crypto');
const Key = require('./key');

const BLS_BINDING_TAG = require('./key').TAGS.BLS_BINDING;

const SCHEME_SCHNORR = 'schnorr';
const SCHEME_BLS = 'bls';
const CIPHERSUITE = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_';
const PUBLIC_KEY_BYTES = 48;
const SIGNATURE_BYTES = 96;
const SECRET_KEY_BYTES = 32;
const SCHNORR_SIGNATURE_BYTES = 64;
const POP_PREFIX = 'Fabric/BLS/PoP/v1:';
const LINK_PREFIX = 'Fabric/BLS/Link/v1:';
const BUNDLE_VERSION = 3;
const HKDF_SALT = Buffer.from('Fabric-BLS-v1', 'utf8');
const HKDF_INFO = Buffer.from('federation-signer', 'utf8');

let suiteCache = null;

/**
 * `types/federation` reaches this module through `types/peer`, so it loads on first use.
 * @returns {Object}
 * @private
 */
function federation () {
  return require('./federation');
}

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
 *
 * Not safe against rogue-key attacks on its own: a signer who picks its public
 * key as a function of the others can make the sum verify alone. Only pass
 * public keys whose proofs of possession were checked (as
 * {@link verifyFederationBlsBundle} does); federation witnesses use
 * {@link verifyFederationBlsWitness}, which never sums keys.
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
 * Bytes the secp256k1 validator key Schnorr-signs to claim a BLS public key.
 * @param {string} blsPublicKeyHex
 * @returns {Buffer}
 * @private
 */
function linkMessage (blsPublicKeyHex) {
  return Buffer.from(LINK_PREFIX + blsPublicKeyHex, 'utf8');
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
  const link = fabricKey.signSchnorr(linkMessage(blsPublicKey), BLS_BINDING_TAG);
  return {
    v: BUNDLE_VERSION,
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
 * Verify one validator's bundle. The validator id may be compressed or x-only;
 * the proof of possession is checked against either parity of that x.
 * @param {Buffer|Uint8Array|string|object} message
 * @param {string} secpPubkey secp256k1 validator id (compressed or x-only hex)
 * @param {object|string} bundle
 * @returns {boolean}
 */
function verifyFederationBlsBundle (message, secpPubkey, bundle) {
  const parsed = parseBundle(bundle);
  if (!parsed) return false;
  if (Number(parsed.v) !== BUNDLE_VERSION) return false;
  const x = federation().validatorId(secpPubkey);
  if (!x) return false;
  const given = String(secpPubkey).trim().toLowerCase().replace(/^0x/, '');
  const popCandidates = /^0[23][0-9a-f]{64}$/.test(given)
    ? [given, (given.startsWith('02') ? '03' : '02') + x]
    : ['02' + x, '03' + x];
  const blsPk = String(parsed.blsPublicKey || '').trim().toLowerCase();
  const sig = String(parsed.signature || '').trim().toLowerCase();
  const pop = String(parsed.pop || '').trim().toLowerCase();
  const link = String(parsed.link || '').trim().toLowerCase();
  if (blsPk.length !== PUBLIC_KEY_BYTES * 2) return false;
  if (sig.length !== SIGNATURE_BYTES * 2) return false;
  if (pop.length !== SIGNATURE_BYTES * 2) return false;
  if (link.length !== SCHNORR_SIGNATURE_BYTES * 2) return false;
  try {
    // BIP340 verifies over x only, so either parity checks the link.
    const key = new Key({ pubkey: '02' + x });
    if (!key.verifySchnorr(linkMessage(blsPk), Buffer.from(link, 'hex'), BLS_BINDING_TAG)) return false;
    if (!popCandidates.some((pk) => verify(pop, Buffer.from(POP_PREFIX + pk, 'utf8'), blsPk))) return false;
    if (!verify(sig, message, blsPk)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * k-of-n over secp256k1 validator ids. Each witness signature is a bundle,
 * found under the validator's id however the witness spelled it. Each signing
 * key counts once, however its id is spelled.
 * @param {Buffer|Uint8Array|string|object} message
 * @param {object} witness
 * @param {string[]} validatorPubkeys
 * @param {number} [threshold=1]
 * @returns {boolean}
 */
function verifyFederationBlsWitness (message, witness, validatorPubkeys, threshold = 1) {
  if (!witness || !witness.signatures || typeof witness.signatures !== 'object') return false;
  const Federation = federation();
  const pubkeys = Federation.uniqueValidatorPubkeys(validatorPubkeys);
  const thr = Number(threshold);
  if (!Number.isInteger(thr) || thr < 1) return false;
  let valid = 0;
  for (const pubkey of pubkeys) {
    const entry = Federation.witnessSignatureFor(witness.signatures, pubkey);
    if (!verifyFederationBlsBundle(message, pubkey, entry)) continue;
    valid++;
    if (valid >= thr) return true;
  }
  return false;
}
  return {
    BLS_BINDING_TAG,
    SCHEME_SCHNORR,
    SCHEME_BLS,
    CIPHERSUITE,
    PUBLIC_KEY_BYTES,
    SIGNATURE_BYTES,
    SECRET_KEY_BYTES,
    POP_PREFIX,
    LINK_PREFIX,
    BUNDLE_VERSION,
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
})();
const dleq = (function () {
/**
 * Chaum-Pedersen proof that two points share a discrete logarithm:
 * `P1 = x·G` and `P2 = x·H`. Byte-compatible with secp256k1-zkp's DLEQ
 * (the `ecdsa_adaptor` module, after the DLC specification): nonce
 * `k = H_DLEQ(x' ‖ H ‖ SHA256(P1 ‖ P2))` with `x'` masked by
 * `H_ECDSAadaptor/aux(aux)` when auxiliary randomness is given, challenge
 * `e = H_DLEQ(P1 ‖ H ‖ P2 ‖ k·G ‖ k·H)`, response `s = k + e·x`.
 *
 * @module types/witness/dleq
 */

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const taggedHash = require('./hash256').tagged;

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

const TAG = 'DLEQ';
const AUX_TAG = 'ECDSAadaptor/aux';
const PROOF_BYTES = 64;

function toBytes (value, name, length) {
  let buf;
  if (Buffer.isBuffer(value)) buf = value;
  else if (value instanceof Uint8Array) buf = Buffer.from(value);
  else if (typeof value === 'string' && /^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0) buf = Buffer.from(value, 'hex');
  else throw new TypeError(`${name} must be a Buffer, Uint8Array, or hex string`);
  if (length != null && buf.length !== length) throw new RangeError(`${name} must be ${length} bytes`);
  return buf;
}

function toInt (buf) {
  return BigInt('0x' + buf.toString('hex'));
}

function scalarBytes (x) {
  return Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
}

function point (value, name) {
  const buf = toBytes(value, name, 33);
  if (buf[0] !== 0x02 && buf[0] !== 0x03) throw new RangeError(`${name} must be a compressed point`);
  return Point.fromBytes(buf);
}

function compressed (P) {
  return Buffer.from(P.toBytes(true));
}

function challenge (P1, H, P2, R1, R2) {
  return toInt(taggedHash(TAG, Buffer.concat([P1, H, P2, R1, R2].map(compressed)))) % N;
}

/**
 * Prove that `x·G` and `x·generator` share the secret `x`.
 *
 * @param {Buffer|string} secret 32-byte x
 * @param {Buffer|string} generator 33-byte compressed second base H
 * @param {Object} [options]
 * @param {Buffer|string|null} [options.aux] 32 bytes of auxiliary randomness
 *   (default: fresh random; `null`: none, deterministic)
 * @returns {{ p1: Buffer, p2: Buffer, e: Buffer, s: Buffer, proof: Buffer }} `proof` is `e ‖ s`
 */
function prove (secret, generator, options = {}) {
  const x32 = toBytes(secret, 'secret', 32);
  const x = toInt(x32);
  if (x <= 0n || x >= N) throw new RangeError('secret must be in 1..n-1');
  const H = point(generator, 'generator');
  const P1 = G.multiply(x);
  const P2 = H.multiply(x);
  const pointsHash = crypto.createHash('sha256').update(Buffer.concat([compressed(P1), compressed(P2)])).digest();
  const key = Buffer.from(x32);
  const aux = options.aux === undefined ? crypto.randomBytes(32) : options.aux;
  if (aux !== null) {
    const mask = taggedHash(AUX_TAG, toBytes(aux, 'aux', 32));
    for (let i = 0; i < 32; i++) key[i] ^= mask[i];
  }
  const k = toInt(taggedHash(TAG, Buffer.concat([key, compressed(H), pointsHash]))) % N;
  key.fill(0);
  if (k === 0n) throw new Error('DLEQ nonce is zero');
  const e = challenge(P1, H, P2, G.multiply(k), H.multiply(k));
  const s = (k + e * x) % N;
  const eBytes = scalarBytes(e);
  const sBytes = scalarBytes(s);
  return { p1: compressed(P1), p2: compressed(P2), e: eBytes, s: sBytes, proof: Buffer.concat([eBytes, sBytes]) };
}

/**
 * @param {Buffer|string} proof 64-byte `e ‖ s`
 * @param {Buffer|string} p1 33-byte x·G
 * @param {Buffer|string} generator 33-byte H
 * @param {Buffer|string} p2 33-byte x·H
 * @returns {boolean}
 */
function verify (proof, p1, generator, p2) {
  try {
    const bytes = toBytes(proof, 'proof', PROOF_BYTES);
    const e = toInt(bytes.subarray(0, 32));
    const s = toInt(bytes.subarray(32));
    if (e >= N || s >= N) return false;
    const P1 = point(p1, 'p1');
    const H = point(generator, 'generator');
    const P2 = point(p2, 'p2');
    const mul = (P, k) => (k === 0n ? Point.ZERO : P.multiplyUnsafe(k));
    const R1 = mul(G, s).subtract(mul(P1, e));
    const R2 = mul(H, s).subtract(mul(P2, e));
    if (R1.equals(Point.ZERO) || R2.equals(Point.ZERO)) return false;
    return challenge(P1, H, P2, R1, R2) === e;
  } catch {
    return false;
  }
}
  return {
    TAG,
    AUX_TAG,
    PROOF_BYTES,
    prove,
    verify
  };
})();
const musig2 = require('../functions/musig2');
const musig2Adaptor = (function () {
/**
 * MuSig2 adaptor signatures, compatible with secp256k1-zkp's MuSig module.
 *
 * The adaptor point T is added to the first aggregate nonce before the nonce
 * coefficient is hashed (`musig_nonce_process` with an adaptor), so every
 * signer's partial signature is a share of a pre-signature `x(R̂) ‖ s'`. The
 * final nonce parity says whether completing it adds or subtracts t.
 *
 * @module types/witness/musig2Adaptor
 */

const { secp256k1 } = require('@noble/curves/secp256k1.js');
const musig2 = require('../functions/musig2');

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

function requireAdaptor (value) {
  if (value == null) throw new TypeError('an adaptor point is required');
  return value;
}

function hasEvenY (P) {
  return (P.toAffine().y & 1n) === 0n;
}

function toInt (buf) {
  return BigInt('0x' + Buffer.from(buf).toString('hex'));
}

/**
 * @param {Buffer} aggnonce 66-byte aggregate nonce (without the adaptor)
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {Buffer} adaptorPoint 33-byte compressed T
 * @returns {object} session context for {@link module:functions/musig2}
 */
function sessionContext (aggnonce, pubkeys, tweaks, isXonly, msg, adaptorPoint) {
  return musig2.sessionContext(aggnonce, pubkeys, tweaks, isXonly, msg, requireAdaptor(adaptorPoint));
}

/**
 * @param {object} sessionCtx adaptor session context
 * @returns {number} 1 when the final nonce has an odd y
 */
function nonceParity (sessionCtx) {
  requireAdaptor(sessionCtx.adaptor);
  return hasEvenY(musig2.getSessionValues(sessionCtx).R) ? 0 : 1;
}

/**
 * Aggregate the partial signatures of an adaptor session.
 *
 * @param {Array<Buffer>} psigs
 * @param {object} sessionCtx adaptor session context
 * @returns {Buffer} 64-byte pre-signature `x(R̂) ‖ s'`
 */
function preSignatureAgg (psigs, sessionCtx) {
  requireAdaptor(sessionCtx.adaptor);
  return musig2.partialSigAgg(psigs, sessionCtx);
}

/**
 * Check an aggregate pre-signature against the session: completing it with the
 * secret of the session's adaptor point gives a valid BIP-340 signature under
 * the (tweaked) aggregate key.
 *
 * @param {Buffer} preSignature 64 bytes
 * @param {object} sessionCtx adaptor session context
 * @returns {boolean}
 */
function preVerify (preSignature, sessionCtx) {
  try {
    requireAdaptor(sessionCtx.adaptor);
    const pre = Buffer.from(preSignature);
    if (pre.length !== 64) return false;
    const { Q, R, e } = musig2.getSessionValues(sessionCtx);
    if (!pre.subarray(0, 32).equals(Buffer.from(R.toBytes(true)).subarray(1))) return false;
    const s = toInt(pre.subarray(32));
    if (s >= N) return false;
    let Rk = R.subtract(Point.fromBytes(sessionCtx.adaptor));
    if (Rk.equals(Point.ZERO)) return false;
    if (!hasEvenY(R)) Rk = Rk.negate();
    const Qeven = hasEvenY(Q) ? Q : Q.negate();
    const lhs = s === 0n ? Point.ZERO : G.multiplyUnsafe(s);
    const rhs = e === 0n ? Rk : Rk.add(Qeven.multiplyUnsafe(e));
    return lhs.equals(rhs);
  } catch {
    return false;
  }
}

/**
 * Verify one signer's partial signature in an adaptor session.
 *
 * @param {Buffer} psig
 * @param {Array<Buffer>} pubnonces
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {number} i
 * @param {Buffer} adaptorPoint
 * @returns {boolean}
 */
function partialSigVerify (psig, pubnonces, pubkeys, tweaks, isXonly, msg, i, adaptorPoint) {
  return musig2.partialSigVerify(psig, pubnonces, pubkeys, tweaks, isXonly, msg, i, requireAdaptor(adaptorPoint));
}

/**
 * Stateless signing for the last signer of an adaptor session (BIP-327 DeterministicSign).
 *
 * @param {Buffer} sk
 * @param {Buffer} aggothernonce
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {Buffer|null} rand
 * @param {Buffer} adaptorPoint
 * @returns {{ pubnonce: Buffer, psig: Buffer }}
 */
function deterministicSign (sk, aggothernonce, pubkeys, tweaks, isXonly, msg, rand, adaptorPoint) {
  return musig2.deterministicSign(sk, aggothernonce, pubkeys, tweaks, isXonly, msg, rand, requireAdaptor(adaptorPoint));
}
  return {
    sessionContext,
    nonceParity,
    preSignatureAgg,
    preVerify,
    partialSigVerify,
    deterministicSign,
    adapt: adaptor.adaptXonly,
    extract: adaptor.extractXonly
  };
})();
const musig2Session = require('../functions/musig2Session');

const HEX64 = /^[0-9a-f]{64}$/;
/**
 * lazily loaded bitcoinjs (fraud proofs that carry transactions)
 * @private
 */
function bitcoinjs () { return require('bitcoinjs-lib'); }
/**
 * BIP341 helpers; `Policy` initialises the ECC library they need
 * @private
 */
function bip341 () {
  require('./policy');
  return require('bitcoinjs-lib/src/payments/bip341');
}

/**
 * x-only hex from compressed or x-only hex
 * @private
 */
function xOnlyHex (pubkey) {
  const s = String(pubkey || '').toLowerCase();
  return /^(02|03)[0-9a-f]{64}$/.test(s) ? s.slice(2) : s;
}

/**
 * display-order txid of input `i` of a bitcoinjs Transaction
 * @private
 */
function inputTxid (tx, i = 0) {
  return Buffer.from(tx.ins[i].hash).reverse().toString('hex');
}

/**
 * Fraud proof kinds. Each is a self-contained bundle of signed artifacts that
 * any third party verifies from the artifacts alone (decision 6).
 * @private
 */
const FRAUD_PROOF_KINDS = Object.freeze({
  WRONG_LEAF: 'wrong-leaf',
  NON_RESPONSE: 'non-response',
  WRONG_ANSWER_HASH: 'wrong-answer-hash',
  WRONG_BYTES: 'wrong-bytes',
  BAD_KEY: 'bad-key',
  WRONGFUL_PENALTY: 'wrongful-penalty',
  STALE_COMMITMENT: 'stale-commitment'
});

const FRAUD_PROOF_TYPE = 'FraudProof';

class Witness {
  constructor (settings = {}) {
    this.settings = Object.assign({
      curve: 'secp256k1',
      data: null,
      keypair: null
    }, settings);

    this.buffer = Buffer.alloc(32 * 256);
    this._state = {
      data: this.settings.data
    };

    if (settings && settings.keypair) {
      if (settings.keypair.private) {
        this._usePrivateKey(settings.keypair.private);
      } else if (settings.keypair.public) {
        this._usePublicKey(settings.keypair.public);
      }
    }

    if (!this.keypair) {
      const privateKey = crypto.randomBytes(32);
      const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, false));
      this.keypair = { privateKey, publicKey };
    }

    if (settings && settings.data) {
      this._loadData(settings.data);
    }

    Object.defineProperty(this, 'buffer', { enumerable: false });
    Object.defineProperty(this, 'keypair', { enumerable: false });

    return this;
  }

  get data () {
    return this._state.data;
  }

  get hash () {
    return this.digest(this._state.data || '');
  }

  get pubkey () {
    return Buffer.from(this.keypair.publicKey).toString('hex');
  }

  get signature () {
    const digest = Buffer.from(this.hash, 'hex');
    const sig = secp256k1.sign(digest, this.keypair.privateKey, { prehash: false });
    const compact = (sig && typeof sig.toCompactRawBytes === 'function')
      ? Buffer.from(sig.toCompactRawBytes())
      : Buffer.from(sig);

    return {
      curve: this.settings.curve,
      r: compact.slice(0, 32).toString('hex'),
      s: compact.slice(32, 64).toString('hex')
    };
  }

  digest (data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  lock () {
    return Object.freeze(this);
  }

  _dumpKeypair () {
    return {
      private: this.keypair.privateKey,
      public: this.keypair.publicKey
    };
  }

  _usePrivateKey (key) {
    const privateKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
    const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, false));
    this.keypair = { privateKey, publicKey };
  }

  _usePublicKey (key) {
    const publicKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
    this.keypair = { publicKey };
  }

  _loadData (data) {
    if (data && typeof data !== 'string') data = JSON.stringify(data);
    if (this.buffer.size < data.length) return new Error(`Insufficient storage (needed ${data.length} bytes)`);

    try {
      // set internal state and write buffer...
      this._state.data = data;
      this.buffer.write(data);
    } catch (E) {
      console.error('Could not write data for Witness:', E);
    }

    return this;
  }

  _fromBitcoinSignature (_signature = {}) {

  }

  /**
   * Converts the Witness to a Compact DER format.
   */
  toCompactDER () {
    let sig = this.signature;
    let R = sig.r;
    let S = sig.s;

    let payload = [
      0x02, // a header byte indicating an integer.
      32, // A 1-byte length descriptor for the R value
      // TODO: assign R coordinate
      R, // The R coordinate, as a big-endian integer.
      0x02, // a header byte indicating an integer.
      32, // A 1-byte length descriptor for the S value.
      // TODO: assign S coordinate
      S // The S coordinate, as a big-endian integer.
    ].map(x => x.toString(16)).join('');

    console.log('payload:', payload);

    let raw = [
      0x30, // indicates compound structure
      Buffer.from(payload, 'hex').size, // payload size
    ].join('') + payload;

    let der = Buffer.from(raw, 'hex');

    return der;
  }

  /**
   * Verify a Schnorr signature over `digest(msg)` with this witness's public key.
   * @param {Buffer|string} msg
   * @param {Buffer|string} signature
   * @returns {boolean}
   */
  verify (msg, signature) {
    const hash = Buffer.from(this.digest(msg), 'hex');
    const publicKey = Buffer.from(this.keypair.publicKey);
    const compact = Buffer.concat([
      Buffer.from(signature.r, 'hex'),
      Buffer.from(signature.s, 'hex')
    ]);
    const verifies = secp256k1.verify(compact, hash, publicKey, { prehash: false });
    let verification = {
      msg: msg,
      hash: hash.toString('hex'),
      pubkey: this.pubkey,
      signature: signature,
      verifies: verifies
    };

    return verification;
  }

  // --- Signed artifacts (market obligations) ---------------------------------

  /**
   * Canonical JSON of an artifact body (signature fields stripped).
   * @param {object} body
   * @returns {string}
   */
  static canonical (body) {
    // JSON round trip first so `undefined` members and Buffers canonicalize the
    // same way before and after the wire (CONTRACT_MESSAGE bodies are JSON).
    const copy = JSON.parse(JSON.stringify(Object.assign({}, body || {})));
    delete copy.signature;
    return stableStringify(copy);
  }

  /**
   * SHA-256 (hex) over {@link Witness.canonical}.
   * @param {object} body
   * @returns {string}
   */
  static artifactHash (body) {
    return crypto.createHash('sha256').update(Witness.canonical(body)).digest('hex');
  }

  /**
   * BIP340 x-only public key (hex) for a 32-byte private key.
   * @param {Buffer|string} priv32
   * @returns {string}
   */
  static xOnlyPubkeyHex (priv32) {
    const priv = Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex');
    return Buffer.from(schnorr.getPublicKey(priv)).toString('hex');
  }

  /**
   * Sign an artifact body with BIP340 Schnorr over its canonical hash. The
   * returned object carries `pubkey` (x-only hex) and `signature` (64-byte hex)
   * so it can ride a `CONTRACT_MESSAGE` body or a Taproot penalty spend.
   * @param {object} body
   * @param {Buffer|string} priv32
   * @returns {object}
   */
  static signArtifact (body, priv32) {
    const priv = Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex');
    if (priv.length !== 32) throw new Error('signArtifact: 32-byte private key required');
    const unsigned = Object.assign({}, body, { pubkey: Witness.xOnlyPubkeyHex(priv) });
    delete unsigned.signature;
    const digest = Buffer.from(Witness.artifactHash(unsigned), 'hex');
    const signature = Buffer.from(schnorr.sign(digest, priv)).toString('hex');
    return Object.assign(unsigned, { signature });
  }

  /**
   * Verify a {@link Witness.signArtifact} output. Pure.
   * @param {object} artifact
   * @param {string} [expectedPubkey] x-only hex the artifact must be signed by
   * @returns {boolean}
   */
  static verifyArtifact (artifact, expectedPubkey = null) {
    if (!artifact || typeof artifact !== 'object') return false;
    const pubkey = String(artifact.pubkey || '').toLowerCase();
    const signature = String(artifact.signature || '').toLowerCase();
    if (!HEX64.test(pubkey) || !/^[0-9a-f]{128}$/.test(signature)) return false;
    if (expectedPubkey && String(expectedPubkey).toLowerCase() !== pubkey) return false;
    try {
      const digest = Buffer.from(Witness.artifactHash(artifact), 'hex');
      return schnorr.verify(Buffer.from(signature, 'hex'), digest, Buffer.from(pubkey, 'hex'));
    } catch (_) {
      return false;
    }
  }
}

const COMMITMENT_TYPE = 'AvailabilityCommitment';
const CHALLENGE_TYPE = 'AvailabilityChallenge';
const RESPONSE_TYPE = 'AvailabilityResponse';
const RECEIPT_TYPE = 'AvailabilityReceipt';
const ATTESTATION_TYPE = 'EpochAttestation';
const PRESIG_TYPE = 'DepositPenaltyPreSig';

// On-chain facts a verdict rests on must be this many blocks deep unless the
// verifier asks for more (`ctx.minConfirmations`).
const DEFAULT_CONFIRMATIONS = 6;
const DEFAULT_MAX_PENALTY_FEE_SATS = 20000;
// nLockTime at or above this is a Unix time, not a height.
const LOCKTIME_THRESHOLD = 500000000;
const SEQUENCE_FINAL = 0xffffffff;

/**
 * non-negative safe integer from a number or canonical decimal string, else `null`
 * @private
 */
function toInt (value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * lowercase 64-hex string, else `null`
 * @private
 */
function hex64 (value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return HEX64.test(s) ? s : null;
}

/**
 * even-length hex string, else `null`
 * @private
 */
function hexBytes (value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return /^([0-9a-f]{2})+$/i.test(s) ? Buffer.from(s, 'hex') : null;
}

/**
 * SHA-256 hex over the concatenated parts
 * @private
 */
function sha256Hex (...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

/**
 * confirmations the verifier demands of an on-chain fact
 * @private
 */
function minConfirmations (ctx = {}) {
  const n = toInt(ctx.minConfirmations);
  return n != null && n >= 1 ? n : DEFAULT_CONFIRMATIONS;
}

/**
 * blob tree parent, same as `types/tree.js` (display-order hashes)
 * @private
 */
function blobParent (left, right) {
  const rev = (b) => Buffer.from(b).reverse();
  const once = crypto.createHash('sha256').update(Buffer.concat([rev(left), rev(right)])).digest();
  return rev(crypto.createHash('sha256').update(once).digest());
}

/**
 * Strict blob-tree inclusion check. Every left/right choice comes from
 * `index` (not from the prover's `position` labels, which must agree), the
 * branch must be exactly as deep as a tree of `leafCount` leaves, and a
 * self-paired step is accepted only for the odd last node of a level. With
 * `leafCount` pinned by a signed commitment, an inner node cannot pass as a
 * leaf and a padded (CVE-2012-2459) tree cannot stand in for the real one.
 * @param {object} opts
 * @param {string} opts.merkleRootHex
 * @param {string} opts.leafHex 32-byte blob hash
 * @param {number} opts.index leaf position
 * @param {number} opts.leafCount committed number of leaves
 * @param {Array|object} opts.proof `[{ position, data }]` or `{ proof: [...], leafCount }` (as `Challenge#respond` emits)
 * @returns {boolean}
 */
function verifyBlobPath (opts = {}) {
  const root = hex64(opts.merkleRootHex);
  const leaf = hex64(opts.leafHex);
  const index = toInt(opts.index);
  const count = toInt(opts.leafCount);
  if (!root || !leaf || index == null || !count || index >= count) return false;
  const proof = opts.proof;
  const steps = Array.isArray(proof) ? proof : (proof && Array.isArray(proof.proof) ? proof.proof : null);
  if (!steps) return false;
  if (proof && !Array.isArray(proof) && proof.leafCount != null && toInt(proof.leafCount) !== count) return false;
  let hash = Buffer.from(leaf, 'hex');
  let position = index;
  let width = count;
  let used = 0;
  while (width > 1) {
    const step = steps[used++];
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
    const sibling = hex64(typeof step.data === 'string' ? step.data : (Buffer.isBuffer(step.data) ? step.data.toString('hex') : ''));
    if (!sibling) return false;
    const other = Buffer.from(sibling, 'hex');
    if (position % 2 === 1) {
      if (step.position !== 'left') return false;
      hash = blobParent(other, hash);
    } else {
      if (step.position !== 'right') return false;
      if (position === width - 1 && !other.equals(hash)) return false;
      hash = blobParent(hash, other);
    }
    position = Math.floor(position / 2);
    width = Math.ceil(width / 2);
  }
  return used === steps.length && hash.toString('hex') === root;
}

/**
 * `SHA256(root || String(epoch) || nonce) mod blobTotal` — the challenged
 * leaf, which neither party picks.
 * @private
 */
function leafIndexFor (merkleRootHex, epoch, nonceHex, blobTotal) {
  const total = Math.max(1, Math.floor(Number(blobTotal) || 1));
  const digest = crypto.createHash('sha256')
    .update(Buffer.from(String(merkleRootHex).toLowerCase(), 'hex'))
    .update(Buffer.from(String(Number(epoch) || 0)))
    .update(Buffer.from(String(nonceHex).toLowerCase(), 'hex'))
    .digest();
  return Number(digest.readUInt32BE(0) % total);
}

/**
 * Self-contained proof that a market counterparty broke a signed obligation.
 * Shape: `{ type: 'FraudProof', kind, artifacts, claim }`. `verify()` is pure
 * over the artifacts; the few kinds that assert an **on-chain fact** (a
 * broadcast happened, an outpoint is unspent, the tip passed a height) take
 * that fact from `ctx` — the verifier's own chain view, which must describe
 * **confirmed** state at least `ctx.minConfirmations` (default 6) deep — and
 * refuse to conclude without it. No kind infers fraud from a *missing*
 * message alone, and no kind trusts a time its accused party could backdate.
 *
 * Every challenge-based kind binds the challenge to the provider's signed
 * `AvailabilityCommitment` (root, `blobTotal`, publisher) and recomputes the
 * challenged index from the nonce. A verdict carries `reputational: true`
 * only when it may move a reputation score.
 *
 * Kinds:
 * - `wrong-leaf`: challenge + commitment + provider-signed response whose
 *   leaf is not at the challenged index of the committed tree, or (with a
 *   Merkle proof of the publisher's pin) names another blob hash.
 * - `non-response`: challenge + commitment and either
 *   (a) a provider-signed response after `deadlineEpoch` **plus** an anchor
 *   showing the challenge reached the provider in time — a provider-signed
 *   `AvailabilityReceipt` or trusted `EpochAttestation`s (`ctx.beaconPubkeys`)
 *   — or (b) **timelock evidence**: the provider's `DepositPenaltyPreSig`
 *   for the deadline, past `deadlineHeight + confirmations`, with the deposit
 *   outpoint neither checked in nor answered. (b) names the provider as
 *   offender only when the provider had a unilateral way to answer: the
 *   pre-signature acknowledges this challenge (`challengeHash`), the
 *   challenge commits `answerHashHex`, and `artifacts.answerPath` proves the
 *   deposit output carries the provider's `answer` hashlock leaf for it.
 *   Otherwise the publisher could manufacture the silence (by refusing to
 *   co-sign check-in), so the verdict is `offender: null`,
 *   `reputational: false` — the pre-signed penalty is enforceable, but it is
 *   **not** proof of non-response.
 * - `wrong-answer-hash`: challenge + commitment + the challenged blob's bytes
 *   and branch; the answer hash the publisher committed cannot be opened by
 *   those bytes — publisher fraud (it would make an honest answer impossible).
 * - `wrong-bytes`: seller-signed `DocumentOffer` (documentId, root, blob
 *   index, blob hash, payment hash) + the claim preimage + the seller-signed
 *   AMP `P2P_FILE_SEND` frame for the same document / root / index / payment
 *   whose bytes miss the offered `blobHashHex`.
 * - `bad-key`: same artifacts for a sealed offer, but the bytes **match**
 *   `blobHashHex` and the revealed key K (the claim preimage) does not open
 *   them: AES-GCM authentication fails, or the plaintext misses the offered
 *   `plaintextSha256`.
 * - `wrongful-penalty`: challenge + the provider's valid, Merkle-proven
 *   response + an un-backdatable anchor that it existed by the deadline (a
 *   publisher-signed `AvailabilityReceipt`, or trusted `EpochAttestation`s
 *   over the response hash) + the penalty transaction that spent the deposit
 *   outpoint anyway — publisher fraud. The provider's own `epoch` / `height`
 *   fields are never trusted. (An on-chain answer spend needs no such proof:
 *   it consumes the outpoint, so no penalty can follow it.)
 * - `stale-commitment`: a payment-channel party's signed `ChannelRevoke`
 *   (channel, number, `perCommitmentSecret` opening `perCommitmentPoint`,
 *   revoked txid) plus that transaction and evidence it confirmed. Assumes
 *   asymmetric commitments: each party holds only its own commitment, so a
 *   broadcast of the revoked txid can only have come from the revoker.
 */
class FraudProof {
  constructor (body = {}) {
    this.kind = String(body.kind || '');
    this.artifacts = Object.assign({}, body.artifacts || {});
    this.claim = Object.assign({}, body.claim || {});
    this.observedAt = body.observedAt != null ? Number(body.observedAt) : Date.now();
  }

  static get KINDS () { return FRAUD_PROOF_KINDS; }
  static get TYPE () { return FRAUD_PROOF_TYPE; }

  /** @returns {object} `CONTRACT_MESSAGE` body (JSON-safe). */
  toBody () {
    return {
      type: FRAUD_PROOF_TYPE,
      version: 1,
      kind: this.kind,
      artifacts: this.artifacts,
      claim: this.claim,
      observedAt: this.observedAt
    };
  }

  /** @returns {string} SHA-256 hex over the canonical body. */
  get hash () {
    return Witness.artifactHash(this.toBody());
  }

  /**
   * Rehydrate a `FraudProof` from a `CONTRACT_MESSAGE` body (or `null` for other types).
   * @param {Object} body
   * @returns {FraudProof|null}
   */
  static fromBody (body) {
    if (!body || body.type !== FRAUD_PROOF_TYPE) return null;
    return new FraudProof(body);
  }

  /**
   * Stable ids of the evidence this proof rests on. Unlike
   * {@link FraudProof#hash} (which covers `observedAt` and the free-form
   * `claim`) they do not change when the same evidence is re-wrapped, so
   * ledgers dedupe and refuse replays on them: two proofs sharing any id are
   * the same offence.
   * - `challenge:<hash>` wrong-leaf, non-response
   * - `answer:<challenge hash>` wrong-answer-hash
   * - `payment:<seller x-only>:<payment hash>` and `frame:<sha256 of frame>` wrong-bytes, bad-key
   * - `penalty-tx:<txid>` wrongful-penalty
   * - `stale-tx:<txid>` stale-commitment
   * @returns {string[]}
   */
  evidenceIds () {
    const a = this.artifacts || {};
    const ids = [];
    const objectHash = (artifact) => (artifact && typeof artifact === 'object' ? Witness.artifactHash(artifact) : null);
    switch (this.kind) {
      case FRAUD_PROOF_KINDS.WRONG_LEAF:
      case FRAUD_PROOF_KINDS.NON_RESPONSE: {
        const h = objectHash(a.challenge);
        if (h) ids.push(`challenge:${h}`);
        break;
      }
      case FRAUD_PROOF_KINDS.WRONG_ANSWER_HASH: {
        const h = objectHash(a.challenge);
        if (h) ids.push(`answer:${h}`);
        break;
      }
      case FRAUD_PROOF_KINDS.WRONG_BYTES:
      case FRAUD_PROOF_KINDS.BAD_KEY: {
        const offer = a.offer || {};
        const seller = hex64(xOnlyHex(offer.pubkey));
        const payment = hex64(offer.paymentHashHex);
        if (seller && payment) ids.push(`payment:${seller}:${payment}`);
        const frame = hexBytes(a.delivery && (a.delivery.frameHex || a.delivery.frame));
        if (frame) ids.push(`frame:${sha256Hex(frame)}`);
        break;
      }
      case FRAUD_PROOF_KINDS.WRONGFUL_PENALTY: {
        try {
          ids.push(`penalty-tx:${bitcoinjs().Transaction.fromHex(String(a.penaltyTxHex || '').trim()).getId()}`);
        } catch (_) { /* no transaction, no id */ }
        break;
      }
      case FRAUD_PROOF_KINDS.STALE_COMMITMENT: {
        const txid = hex64(a.revoke && a.revoke.commitmentTxid);
        if (txid) ids.push(`stale-tx:${txid}`);
        break;
      }
    }
    return ids;
  }

  /**
   * @param {object} [ctx] verifier's chain view and trust roots
   * @param {number} [ctx.tipHeight] current block height (timelocked non-response)
   * @param {number} [ctx.minConfirmations] depth every on-chain fact needs (default 6)
   * @param {function} [ctx.outpointSpend] `(txid, vout) → null | { leafId, height }` confirmed spend of the deposit (preferred: tells check-in / answer from withdraw)
   * @param {function} [ctx.outpointUnspent] `(txid, vout) → boolean` confirmed-unspent fallback
   * @param {function} [ctx.headerKnown] `(blockHash) → boolean` block is in the verifier's best chain
   * @param {function} [ctx.confirmations] `(blockHash) → number` depth of that block
   * @param {function} [ctx.txCount] `(blockHash) → number` transactions in that block (pins the branch depth)
   * @param {function} [ctx.txConfirmations] `(txid) → number` depth of a transaction
   * @param {function} [ctx.txConfirmed] `(txid, depth) → boolean` legacy: the transaction is at least `depth` (`minConfirmations`) deep; prefer `ctx.txConfirmations`
   * @param {string[]} [ctx.beaconPubkeys] keys whose `EpochAttestation`s anchor times
   * @param {number} [ctx.beaconThreshold] distinct attestations needed (default 1)
   * @param {number} [ctx.minResponseEpochs] epochs a provider must have had to answer (default 1)
   * @param {string} [ctx.channelId] channel the verifier is judging (stale-commitment)
   * @returns {{ ok: boolean, offender: (string|null), reason: (string|null), reputational: boolean, evidence: (string|undefined), enforceableAfterHeight: (number|undefined) }}
   */
  verify (ctx = {}) {
    const fail = (reason, extra = {}) => Object.assign({ ok: false, offender: null, reputational: false, reason }, extra);
    switch (this.kind) {
      case FRAUD_PROOF_KINDS.WRONG_LEAF: return this._verifyWrongLeaf(fail);
      case FRAUD_PROOF_KINDS.NON_RESPONSE: return this._verifyNonResponse(ctx, fail);
      case FRAUD_PROOF_KINDS.WRONG_ANSWER_HASH: return this._verifyWrongAnswerHash(fail);
      case FRAUD_PROOF_KINDS.WRONG_BYTES: return this._verifyWrongBytes(fail);
      case FRAUD_PROOF_KINDS.BAD_KEY: return this._verifyBadKey(fail);
      case FRAUD_PROOF_KINDS.WRONGFUL_PENALTY: return this._verifyWrongfulPenalty(ctx, fail);
      case FRAUD_PROOF_KINDS.STALE_COMMITMENT: return this._verifyStaleCommitment(ctx, fail);
      default: return fail(`unknown fraud proof kind: ${this.kind}`);
    }
  }

  /** @private */
  _verifyWrongLeaf (fail) {
    const a = this.artifacts;
    const bound = FraudProof.bindChallenge(a.challenge, a.commitment);
    if (!bound.ok) return fail(bound.reason);
    const pair = FraudProof._responseTo(a.challenge, a.response, bound.provider);
    if (!pair.ok) return fail(pair.reason);
    const response = a.response;
    const index = toInt(response.blobIndex);
    if (index == null) return fail('response blobIndex is not an integer');
    if (index !== bound.blobIndex) return convict(bound.provider, 'response answers a different blob index');
    const pin = hex64(a.challenge.blobHashHex);
    if (pin && FraudProof._pinProven(a.challenge, bound, a.pinProof) && hex64(response.blobHashHex) !== pin) {
      return convict(bound.provider, 'response names a blob hash other than the proven pinned leaf');
    }
    if (!verifyBlobPath({ merkleRootHex: bound.root, leafHex: response.blobHashHex, index, leafCount: bound.blobTotal, proof: response.proof })) {
      return convict(bound.provider, 'response leaf is not at the challenged index of the committed tree');
    }
    return fail('response is valid — no wrong-leaf fraud');
  }

  /** @private */
  _verifyNonResponse (ctx, fail) {
    const a = this.artifacts;
    const challenge = a.challenge;
    const bound = FraudProof.bindChallenge(challenge, a.commitment);
    if (!bound.ok) return fail(bound.reason);
    if (!a.response) return FraudProof._timelockedAbsence(bound, challenge, a.commitment, a, ctx, fail);
    const pair = FraudProof._responseTo(challenge, a.response, bound.provider);
    if (!pair.ok) return fail(pair.reason);
    const epoch = toInt(a.response.epoch);
    if (epoch == null) return fail('response epoch is not an integer');
    if (epoch <= bound.deadlineEpoch) return fail('response was in time — no non-response fraud');
    // The provider's own late epoch only shows *when it answered*; that the
    // challenge reached it in time needs a time it cannot have been handed late.
    const challengeHash = Witness.artifactHash(challenge);
    const anchor = FraudProof.anchorEpoch(a.anchor, { digest: challengeHash, challengeHash, receiptSigner: bound.provider }, ctx);
    if (!anchor.ok) return fail(`late response: ${anchor.reason}`);
    const lag = toInt(ctx.minResponseEpochs) || 1;
    if (anchor.epoch + lag > bound.deadlineEpoch) {
      return fail(`challenge is anchored at epoch ${anchor.epoch}, too close to deadline ${bound.deadlineEpoch} to demand an answer`);
    }
    return convict(bound.provider, `response signed in epoch ${epoch} after deadline ${bound.deadlineEpoch}`, { evidence: 'late-response', anchor: anchor.kind });
  }

  /** @private */
  _verifyWrongAnswerHash (fail) {
    const a = this.artifacts;
    const bound = FraudProof.bindChallenge(a.challenge, a.commitment);
    if (!bound.ok) return fail(bound.reason);
    const answerHash = hex64(a.challenge.answerHashHex);
    if (!answerHash) return fail('challenge commits no answer hash');
    const blob = a.blob || {};
    const bytes = hexBytes(blob.bytesHex);
    if (!bytes) return fail('challenged blob bytes required (blob.bytesHex)');
    if (!verifyBlobPath({ merkleRootHex: bound.root, leafHex: sha256Hex(bytes), index: bound.blobIndex, leafCount: bound.blobTotal, proof: blob.proof })) {
      return fail('bytes are not the challenged leaf of the committed tree');
    }
    if (FraudProof.answerHashFor(FraudProof.possessionHex(bound.nonce, bytes)) === answerHash) {
      return fail('the challenged blob opens the answer hash — no fraud');
    }
    return convict(bound.publisher, 'publisher committed an answer hash the challenged blob cannot open', { evidence: 'blob-bytes' });
  }

  /** @private */
  _verifyWrongBytes (fail) {
    const d = FraudProof._offerDelivery(this.artifacts);
    if (!d.ok) return fail(d.reason);
    if (verifyBlob(d.bytes, d.want)) return fail('delivered bytes match the offer — no wrong-bytes fraud');
    return convict(d.seller, 'seller-signed delivery does not hash to the offered blob', { evidence: 'signed-frame', deliveredBlobHashHex: sha256Hex(d.bytes) });
  }

  /** @private */
  _verifyBadKey (fail) {
    const d = FraudProof._offerDelivery(this.artifacts);
    if (!d.ok) return fail(d.reason);
    if (d.offer.sealed !== true) return fail('bad-key needs a sealed offer (offer.sealed)');
    if (!verifyBlob(d.bytes, d.want)) return fail('delivered bytes miss the offered blob — that is wrong-bytes, not bad-key');
    const ivBase64 = typeof d.offer.iv === 'string' && d.offer.iv ? d.offer.iv : (typeof d.body.iv === 'string' ? d.body.iv : '');
    const iv = Buffer.from(ivBase64, 'base64');
    if (iv.length !== 12) return fail('no 12-byte IV in the signed offer or frame');
    const { openCiphertext } = require('../functions/documentSealedExchange');
    let plaintext;
    try {
      plaintext = openCiphertext(d.bytes, Buffer.from(d.preimage, 'hex'), iv.toString('base64'));
    } catch (_) {
      return convict(d.seller, 'revealed key does not decrypt the delivered blob (AES-GCM authentication fails)', { evidence: 'aes-gcm' });
    }
    const plain = hex64(d.offer.plaintextSha256);
    if (plain && sha256Hex(plaintext) !== plain) {
      return convict(d.seller, 'decrypted blob does not hash to the offered plaintextSha256', { evidence: 'plaintext-hash' });
    }
    return fail('revealed key opens the delivered blob — no bad-key fraud');
  }

  /** @private */
  _verifyWrongfulPenalty (ctx, fail) {
    const a = this.artifacts;
    const { challenge, response } = a;
    if (!challenge || challenge.type !== CHALLENGE_TYPE || !Witness.verifyArtifact(challenge)) return fail('challenge signature invalid');
    const publisher = xOnlyHex(challenge.pubkey);
    const provider = hex64(xOnlyHex(challenge.providerPubkey));
    if (!provider) return fail('challenge names no provider');
    const pair = FraudProof._responseTo(challenge, response, provider);
    if (!pair.ok) return fail(pair.reason);
    const root = hex64(challenge.merkleRootHex);
    const total = toInt(challenge.blobTotal);
    const index = toInt(challenge.blobIndex);
    const deadlineEpoch = toInt(challenge.deadlineEpoch);
    if (!root || !total || index == null || index >= total || deadlineEpoch == null) return fail('challenge root / blob index / total / deadline malformed');
    if (toInt(response.blobIndex) !== index) return fail('response answers a different blob index');
    const pin = hex64(challenge.blobHashHex);
    if (pin && hex64(response.blobHashHex) !== pin) return fail('response names the wrong blob hash');
    if (!verifyBlobPath({ merkleRootHex: root, leafHex: response.blobHashHex, index, leafCount: total, proof: response.proof })) {
      return fail('response leaf is not at the challenged index of the tree');
    }
    const answerHash = hex64(challenge.answerHashHex);
    if (answerHash) {
      const possession = hex64(response.possessionHex);
      if (!possession || FraudProof.answerHashFor(possession) !== answerHash) return fail('response possession digest does not open the committed answer hash');
    }
    const responseHash = Witness.artifactHash(response);
    const anchor = FraudProof.anchorEpoch(a.anchor, { digest: responseHash, challengeHash: response.challengeHash, responseHash, receiptSigner: publisher }, ctx);
    if (!anchor.ok) return fail(`in-time response: ${anchor.reason}`);
    if (anchor.epoch > deadlineEpoch) return fail(`response is anchored at epoch ${anchor.epoch}, after deadline ${deadlineEpoch}`);
    const deadlineHeight = toInt(challenge.deadlineHeight);
    if (deadlineHeight && anchor.height != null && anchor.height > deadlineHeight) return fail('response is anchored after the deadline height');
    // The penalty must actually have been taken: a transaction spending the
    // deposit outpoint the challenge names.
    const dep = challenge.deposit || {};
    const depTxid = hex64(dep.txid);
    const depVout = toInt(dep.vout);
    if (!depTxid || depVout == null) return fail('challenge names no deposit outpoint');
    let penalty;
    try { penalty = bitcoinjs().Transaction.fromHex(String(a.penaltyTxHex || '').trim()); } catch (_) { return fail('penaltyTxHex missing or not a transaction'); }
    const spendIndex = penalty.ins.findIndex((inp, i) => inputTxid(penalty, i) === depTxid && inp.index === depVout);
    if (spendIndex < 0) return fail('penalty transaction does not spend the deposit outpoint');
    const witness = penalty.ins[spendIndex].witness || [];
    if (!witness.length || witness.every((w) => !w || !w.length)) return fail('penalty transaction carries no witness for the deposit input');
    // Check-in, answer, and withdraw also spend the deposit: only a spend
    // through the 2-of-2 `penalty` leaf is a penalty.
    const path = FraudProof._scriptPathOf(witness);
    if (!path) return fail('deposit input is not a tapscript spend');
    const penaltyLeaves = FraudProof._penaltyLeafScripts(publisher, provider);
    if (!penaltyLeaves.some((s) => s.equals(path.script))) return fail('deposit input does not spend the penalty leaf (check-in, answer, or withdraw is not a penalty)');
    // The txid does not commit to the witness: the control block must commit
    // that leaf to the deposit output, and both signatures must verify.
    const prevouts = FraudProof._prevouts(a.prevouts, penalty);
    if (!prevouts) return fail('prevouts required: [{ scriptHex, valueSats }] for every penalty input');
    if (!FraudProof._controlBlockCommits(prevouts.scripts[spendIndex], path.script, path.controlBlock)) {
      return fail('control block does not commit the penalty leaf to the deposit output');
    }
    if (!FraudProof._scriptPathSignedBy(penalty, spendIndex, prevouts, path, [publisher, provider])) {
      return fail('penalty leaf signatures do not verify for the deposit spend');
    }
    const evidence = FraudProof._broadcastEvidence(penalty, a.inclusion, ctx);
    if (!evidence.ok) return fail(evidence.reason);
    return convict(publisher, 'valid in-time response was penalized', { evidence: evidence.kind, anchor: anchor.kind, penaltyTxid: penalty.getId(), blockHash: evidence.blockHash || null });
  }

  /** @private */
  _verifyStaleCommitment (ctx, fail) {
    const { revoke, staleTxHex, inclusion } = this.artifacts;
    if (!revoke || revoke.type !== 'ChannelRevoke') return fail('ChannelRevoke artifact missing');
    if (!Witness.verifyArtifact(revoke)) return fail('revoke signature invalid');
    const channelId = typeof revoke.channelId === 'string' ? revoke.channelId : '';
    if (!channelId) return fail('revoke names no channelId');
    if (this.claim.channelId != null && String(this.claim.channelId) !== channelId) return fail('claim names another channel than the revoke');
    if (ctx.channelId != null && String(ctx.channelId) !== channelId) return fail('revoke is for another channel');
    const commitmentTxid = hex64(revoke.commitmentTxid);
    if (!commitmentTxid) return fail('revoke names no commitment txid');
    const secret = hex64(revoke.perCommitmentSecret);
    if (!secret) return fail('revoke carries no per-commitment secret');
    const point = String(revoke.perCommitmentPoint || '').toLowerCase();
    if (!/^(02|03)[0-9a-f]{64}$/.test(point)) return fail('revoke carries no perCommitmentPoint');
    if (FraudProof._commitmentPoint(secret) !== point) return fail('perCommitmentSecret does not open perCommitmentPoint');
    let tx;
    try { tx = bitcoinjs().Transaction.fromHex(String(staleTxHex || '').trim()); } catch (_) { return fail('staleTxHex is not a transaction'); }
    const txid = tx.getId();
    if (txid !== commitmentTxid) return fail('transaction is not the revoked commitment');
    // Possessing the signed bytes proves nothing (the verifier may simply
    // hold the old commitment): require evidence it reached the chain.
    const evidence = FraudProof._broadcastEvidence(tx, inclusion, ctx);
    if (!evidence.ok) return fail(evidence.reason);
    return convict(xOnlyHex(revoke.pubkey), `revoked commitment ${revoke.number} (${txid}) was broadcast`, { evidence: evidence.kind, blockHash: evidence.blockHash || null });
  }

  /**
   * Bind a challenge to the provider's signed `AvailabilityCommitment`: the
   * commitment fixes root, leaf count, and publisher, and the challenged
   * index is recomputed from the nonce. Pure.
   * @param {object} challenge signed `AvailabilityChallenge`
   * @param {object} commitment signed `AvailabilityCommitment`
   * @returns {{ ok: boolean, reason: (string|undefined), provider: string, publisher: string, root: string, blobTotal: number, blobIndex: number, epoch: number, deadlineEpoch: number, nonce: string }}
   */
  static bindChallenge (challenge, commitment) {
    const no = (reason) => ({ ok: false, reason });
    if (!challenge || challenge.type !== CHALLENGE_TYPE || !Witness.verifyArtifact(challenge)) return no('challenge signature invalid');
    const provider = hex64(xOnlyHex(challenge.providerPubkey));
    if (!provider) return no('challenge names no provider');
    if (!commitment || commitment.type !== COMMITMENT_TYPE) return no('provider AvailabilityCommitment required');
    if (!Witness.verifyArtifact(commitment, provider)) return no('commitment is not signed by the challenged provider');
    const publisher = hex64(xOnlyHex(commitment.publisherPubkey));
    if (!publisher) return no('commitment names no publisherPubkey — anyone could challenge it');
    if (publisher !== xOnlyHex(challenge.pubkey)) return no('challenge was not issued by the committed publisher');
    const root = hex64(challenge.merkleRootHex);
    if (!root || root !== hex64(commitment.merkleRootHex)) return no('commitment does not cover the challenged tree');
    const blobTotal = toInt(commitment.blobTotal);
    if (!blobTotal) return no('commitment names no blobTotal');
    if (toInt(challenge.blobTotal) !== blobTotal) return no('challenge blobTotal differs from the commitment');
    const epoch = toInt(challenge.epoch);
    const nonce = hex64(challenge.nonceHex);
    if (epoch == null || !nonce) return no('challenge epoch / nonce malformed');
    const blobIndex = leafIndexFor(root, epoch, nonce, blobTotal);
    if (toInt(challenge.blobIndex) !== blobIndex) return no('challenge blobIndex is not the nonce-derived leaf');
    const from = commitment.fromEpoch == null ? 0 : toInt(commitment.fromEpoch);
    if (from == null || epoch < from) return no('challenge issued before the commitment began');
    if (commitment.untilEpoch != null) {
      const until = toInt(commitment.untilEpoch);
      if (until == null || epoch > until) return no('challenge issued after the commitment expired');
    }
    const deadlineEpoch = toInt(challenge.deadlineEpoch);
    if (deadlineEpoch == null || deadlineEpoch <= epoch) return no('challenge deadlineEpoch must be an integer after its epoch');
    return { ok: true, provider, publisher, root, blobTotal, blobIndex, epoch, deadlineEpoch, nonce };
  }

  /**
   * Earliest epoch at which `want.digest` provably existed, from an anchor
   * its author cannot backdate:
   * - an `AvailabilityReceipt` `{ challengeHash, responseHash?, epoch, height? }`
   *   signed by `want.receiptSigner` (the counterparty, who gains nothing by
   *   dating it early);
   * - `EpochAttestation`s `{ digestHex, epoch, height? }` from distinct keys in
   *   `ctx.beaconPubkeys`, at least `ctx.beaconThreshold` (default 1) of them;
   *   the anchored epoch is the latest one that threshold agrees on.
   * @param {object|object[]} anchor
   * @param {{ digest: string, challengeHash: string, responseHash: (string|undefined), receiptSigner: string }} want
   * @param {object} [ctx]
   * @returns {{ ok: boolean, reason: (string|undefined), kind: (string|undefined), epoch: (number|undefined), height: (number|null|undefined) }}
   */
  static anchorEpoch (anchor, want = {}, ctx = {}) {
    const items = (Array.isArray(anchor) ? anchor : [anchor]).filter((item) => item && typeof item === 'object');
    if (!items.length) return { ok: false, reason: 'anchor required (counterparty AvailabilityReceipt or trusted EpochAttestation)' };
    const digest = hex64(want.digest);
    const challengeHash = hex64(want.challengeHash);
    const responseHash = want.responseHash ? hex64(want.responseHash) : null;
    const signer = hex64(xOnlyHex(want.receiptSigner));
    for (const item of items) {
      if (item.type !== RECEIPT_TYPE || !signer || !Witness.verifyArtifact(item, signer)) continue;
      if (!challengeHash || hex64(item.challengeHash) !== challengeHash) continue;
      if (responseHash && hex64(item.responseHash) !== responseHash) continue;
      const epoch = toInt(item.epoch);
      if (epoch == null) continue;
      return { ok: true, kind: 'receipt', epoch, height: toInt(item.height) };
    }
    const trusted = new Set((Array.isArray(ctx.beaconPubkeys) ? ctx.beaconPubkeys : []).map((k) => hex64(xOnlyHex(k))).filter(Boolean));
    if (!trusted.size) return { ok: false, reason: 'no valid counterparty receipt, and no trusted beacon keys (ctx.beaconPubkeys) for attestations' };
    const threshold = Math.max(1, toInt(ctx.beaconThreshold) || 1);
    const bySigner = new Map();
    for (const item of items) {
      if (item.type !== ATTESTATION_TYPE) continue;
      const key = hex64(xOnlyHex(item.pubkey));
      if (!key || !trusted.has(key) || bySigner.has(key)) continue;
      if (!digest || hex64(item.digestHex) !== digest) continue;
      const epoch = toInt(item.epoch);
      if (epoch == null || !Witness.verifyArtifact(item, key)) continue;
      bySigner.set(key, { epoch, height: toInt(item.height) });
    }
    if (bySigner.size < threshold) return { ok: false, reason: `need ${threshold} trusted EpochAttestation(s), have ${bySigner.size}` };
    const at = [...bySigner.values()].sort((x, y) => x.epoch - y.epoch)[threshold - 1];
    return { ok: true, kind: 'attestation', epoch: at.epoch, height: at.height };
  }

  /**
   * Nonce-bound proof of possession: `SHA256(nonce || blob bytes)` hex.
   * @param {string} nonceHex
   * @param {Buffer} bytes
   * @returns {string}
   */
  static possessionHex (nonceHex, bytes) {
    return sha256Hex(Buffer.from(String(nonceHex).toLowerCase(), 'hex'), bytes);
  }

  /**
   * Answer hash committed per round: `SHA256(possession digest bytes)`, so
   * revealing the possession digest on-chain opens the `answer` leaf.
   * @param {string} possessionHex
   * @returns {string}
   */
  static answerHashFor (possessionHex) {
    return sha256Hex(Buffer.from(String(possessionHex).toLowerCase(), 'hex'));
  }

  /**
   * The deposit's provider-unilateral `answer` leaf for `answerHashHex`
   * (`OP_SHA256 <answerHash> OP_EQUALVERIFY <provider> OP_CHECKSIG`).
   * @param {string} providerPubkey x-only or compressed hex
   * @param {string} answerHashHex
   * @returns {Buffer|null}
   */
  static answerLeafScript (providerPubkey, answerHashHex) {
    const provider = hex64(xOnlyHex(providerPubkey));
    const answerHash = hex64(answerHashHex);
    if (!provider || !answerHash) return null;
    const { buildHashlockLeaf } = require('./policy');
    try {
      return buildHashlockLeaf({ id: 'answer', commitmentHex: answerHash, pubkeyHex: `02${provider}` }).script;
    } catch (_) {
      return null;
    }
  }

  /**
   * Structural checks every penalty PSBT must pass before anyone signs it and
   * whenever a pre-signature is verified: exactly one input, on the challenged
   * deposit outpoint; a non-final nSequence (else nLockTime is ignored);
   * `nLockTime` equal to the deadline, which must be a block height; every
   * output paying the publisher-named destination (at least `minValueSats`);
   * and a fee no larger than `maxFeeSats` (default 20000). Without a named
   * destination the result is `enforceable: false` — the provider, who signs
   * first, would choose where the penalty pays.
   * @param {object} psbt bitcoinjs Psbt
   * @param {object} expect `{ deposit: { txid, vout, penaltyAddress?, minPenaltySats? }, deadlineHeight, depositAddress?, destinationAddress?, destinationScriptHex?, minValueSats?, maxFeeSats? }`
   * @returns {{ ok: boolean, reason: (string|undefined), txid: (string|undefined), spentScript: (Buffer|undefined), feeSats: (number|undefined), enforceable: (boolean|undefined) }}
   */
  static checkPenaltyPsbt (psbt, expect = {}) {
    const no = (reason) => ({ ok: false, reason });
    const tx = psbt.__CACHE.__TX;
    if (tx.ins.length !== 1 || psbt.data.inputs.length !== 1) return no('penalty must spend exactly one input (the deposit outpoint)');
    const dep = expect.deposit || {};
    const depTxid = hex64(dep.txid);
    const depVout = toInt(dep.vout);
    if (!depTxid || depVout == null) return no('deposit outpoint { txid, vout } required');
    if (inputTxid(tx, 0) !== depTxid || tx.ins[0].index !== depVout) return no('penalty does not spend the challenged deposit outpoint');
    if (!(tx.ins[0].sequence < SEQUENCE_FINAL)) return no('penalty input nSequence is final — its nLockTime would not be enforced');
    const deadline = toInt(expect.deadlineHeight);
    if (!deadline || deadline >= LOCKTIME_THRESHOLD) return no('deadlineHeight must be a block height');
    if (tx.locktime !== deadline) return no(`penalty nLockTime ${tx.locktime} is not the deadline ${deadline}`);
    const input = psbt.data.inputs[0];
    if (!input.witnessUtxo) return no('PSBT carries no witnessUtxo for the deposit');
    const spent = Buffer.from(input.witnessUtxo.script);
    if (expect.depositAddress && !FraudProof._addressScripts(expect.depositAddress).some((s) => s.equals(spent))) {
      return no('penalty does not spend the deposit address');
    }
    const destination = FraudProof._penaltyDestination(expect);
    if (destination) {
      if (!destination.scripts.length) return no(`penalty destination ${destination.label} is not a valid address or script`);
      const toDestination = (o) => destination.scripts.some((s) => Buffer.from(o.script).equals(s));
      const min = destination.minValueSats;
      if (!tx.outs.some((o) => toDestination(o) && (!min || Number(o.value) >= min))) {
        return no(`penalty does not pay ${min ? `at least ${min} sats to ` : ''}${destination.label}`);
      }
      if (!tx.outs.every(toDestination)) return no(`penalty pays outputs other than ${destination.label}`);
    }
    const fee = BigInt(input.witnessUtxo.value) - tx.outs.reduce((n, o) => n + BigInt(o.value), 0n);
    if (fee < 0n) return no('penalty outputs exceed the deposit');
    const cap = toInt(expect.maxFeeSats) != null ? toInt(expect.maxFeeSats) : DEFAULT_MAX_PENALTY_FEE_SATS;
    if (fee > BigInt(cap)) return no(`penalty fee ${fee} exceeds the cap ${cap}`);
    return { ok: true, txid: tx.getId(), spentScript: spent, feeSats: Number(fee), enforceable: !!destination, deadlineHeight: deadline, deposit: { txid: depTxid, vout: depVout } };
  }

  /**
   * Verify a provider's `DepositPenaltyPreSig`: a signed artifact wrapping a
   * penalty PSBT that passes {@link FraudProof.checkPenaltyPsbt} and carries
   * the provider's valid tapscript signature on the canonical publisher +
   * provider penalty leaf, whose control block commits to the spent deposit
   * output. Pure.
   * @param {object} preSig artifact `{ type: 'DepositPenaltyPreSig', psbtBase64, deposit: { txid, vout }, deadlineHeight, txid, challengeHash?, pubkey, signature }`
   * @param {object} expect as {@link FraudProof.checkPenaltyPsbt}, plus `providerPubkey`, `publisherPubkey`, and optional `challengeHash` the pre-signature must acknowledge
   * @returns {{ ok: boolean, reason: (string|undefined), txid: (string|undefined), psbt: (object|undefined), enforceable: (boolean|undefined), spentScript: (Buffer|undefined), feeSats: (number|undefined) }}
   */
  static verifyPenaltyPreSig (preSig, expect = {}) {
    const no = (reason) => ({ ok: false, reason });
    if (!preSig || preSig.type !== PRESIG_TYPE) return no('DepositPenaltyPreSig artifact missing');
    const provider = hex64(xOnlyHex(expect.providerPubkey));
    if (!provider || !Witness.verifyArtifact(preSig, provider)) return no('pre-signature artifact not signed by the provider');
    let psbt;
    try { psbt = bitcoinjs().Psbt.fromBase64(String(preSig.psbtBase64 || '')); } catch (_) { return no('pre-signature PSBT invalid'); }
    const check = FraudProof.checkPenaltyPsbt(psbt, expect);
    if (!check.ok) return check;
    if (toInt(preSig.deadlineHeight) !== check.deadlineHeight) return no('pre-signature names another deadline');
    if (hex64(preSig.txid) !== check.txid) return no('pre-signature txid does not match its PSBT');
    const named = preSig.deposit || {};
    if (hex64(named.txid) !== check.deposit.txid || toInt(named.vout) !== check.deposit.vout) return no('pre-signature names another deposit outpoint');
    if (expect.challengeHash && hex64(preSig.challengeHash) !== hex64(expect.challengeHash)) return no('pre-signature is for another challenge');
    // The provider signs the PSBT and so chooses its leaf: only the canonical
    // 2-of-2 penalty leaf, committed to the deposit output, is a penalty.
    const penaltyLeaves = FraudProof._penaltyLeafScripts(expect.publisherPubkey, provider);
    if (!penaltyLeaves.length) return no('publisherPubkey required to identify the penalty leaf');
    const input = psbt.data.inputs[0];
    const leaves = input.tapLeafScript || [];
    if (!leaves.length) return no('PSBT names no tapscript leaf');
    if (!leaves.every((l) => penaltyLeaves.some((s) => s.equals(Buffer.from(l.script))))) return no('PSBT spends a leaf other than the penalty leaf');
    if (!leaves.every((l) => FraudProof._controlBlockCommits(check.spentScript, Buffer.from(l.script), Buffer.from(l.controlBlock)))) {
      return no('control block does not commit the penalty leaf to the deposit output');
    }
    const b = bip341();
    const leafHashes = leaves.map((l) => Buffer.from(b.tapleafHash({ output: Buffer.from(l.script), version: l.leafVersion })));
    const sigs = input.tapScriptSig || [];
    const mine = sigs.find((s) => Buffer.from(s.pubkey).toString('hex') === provider && leafHashes.some((h) => h.equals(Buffer.from(s.leafHash))));
    if (!mine) return no('PSBT carries no provider tapscript signature on the penalty leaf');
    let valid = false;
    try {
      valid = psbt.validateSignaturesOfInput(0, (pk, msghash, sig) => schnorr.verify(sig, msghash, pk), Buffer.from(provider, 'hex'));
    } catch (e) {
      return no(`tapscript signature check failed: ${e.message}`);
    }
    if (!valid) return no('provider tapscript signature invalid');
    return { ok: true, txid: check.txid, psbt, enforceable: check.enforceable, spentScript: check.spentScript, feeSats: check.feeSats };
  }

  /**
   * Publisher-controlled penalty destination from `expect` (explicit fields
   * win over the challenge's signed `deposit`). `null` when none is named.
   * @private
   * @param {object} expect
   * @returns {{ scripts: Buffer[], minValueSats: number, label: string }|null}
   */
  static _penaltyDestination (expect = {}) {
    const dep = expect.deposit || {};
    const address = expect.destinationAddress || dep.penaltyAddress || null;
    const scriptHex = expect.destinationScriptHex || null;
    if (!address && !scriptHex) return null;
    const minValueSats = Math.max(0, Math.floor(Number(expect.minValueSats != null ? expect.minValueSats : dep.minPenaltySats) || 0));
    const scripts = [];
    if (scriptHex && /^([0-9a-f]{2})+$/i.test(String(scriptHex))) scripts.push(Buffer.from(String(scriptHex), 'hex'));
    if (address) scripts.push(...FraudProof._addressScripts(address));
    return { scripts, minValueSats, label: String(address || scriptHex) };
  }

  /**
   * Output script for `address` on the first network that parses it.
   * @private
   * @param {string} address
   * @returns {Buffer[]} one script, or none when the address is invalid
   */
  static _addressScripts (address) {
    const { address: addr, networks } = bitcoinjs();
    for (const net of [networks.bitcoin, networks.testnet, networks.regtest]) {
      try { return [Buffer.from(addr.toOutputScript(String(address), net))]; } catch (_) { /* try the next network */ }
    }
    return [];
  }

  /**
   * Leaf script revealed by a Taproot script-path witness
   * (`[…stack, script, controlBlock, annex?]`), or `null` for a key-path spend.
   * @private
   * @param {Buffer[]} witness
   * @returns {Buffer|null}
   */
  static _tapscriptOf (witness = []) {
    const path = FraudProof._scriptPathOf(witness);
    return path ? path.script : null;
  }

  /**
   * Taproot script-path witness split into its parts, or `null` for a
   * key-path spend.
   * @private
   * @param {Buffer[]} witness
   * @returns {{ stack: Buffer[], script: Buffer, controlBlock: Buffer, annex: (Buffer|null) }|null}
   */
  static _scriptPathOf (witness = []) {
    let items = witness.filter((w) => Buffer.isBuffer(w) || w instanceof Uint8Array).map((w) => Buffer.from(w));
    let annex = null;
    if (items.length >= 2 && items[items.length - 1].length && items[items.length - 1][0] === 0x50) {
      annex = items[items.length - 1];
      items = items.slice(0, -1);
    }
    if (items.length < 2) return null;
    const control = items[items.length - 1];
    if (control.length < 33 || (control.length - 33) % 32 !== 0 || (control[0] & 0xfe) !== 0xc0) return null;
    return { stack: items.slice(0, -2), script: items[items.length - 2], controlBlock: control, annex };
  }

  /**
   * Spent outputs for every input of `tx` (the Taproot sighash commits to all
   * of them), from `[{ scriptHex, valueSats }]` aligned with `tx.ins`.
   * @private
   * @param {object[]} rows
   * @param {object} tx bitcoinjs Transaction
   * @returns {{ scripts: Buffer[], values: bigint[] }|null}
   */
  static _prevouts (rows, tx) {
    if (!Array.isArray(rows) || rows.length !== tx.ins.length) return null;
    const scripts = [];
    const values = [];
    for (const row of rows) {
      const scriptHex = String((row && row.scriptHex) || '');
      if (!/^([0-9a-f]{2})+$/i.test(scriptHex)) return null;
      let value;
      try { value = BigInt(row.valueSats); } catch (_) { return null; }
      if (value < 0n) return null;
      scripts.push(Buffer.from(scriptHex, 'hex'));
      values.push(value);
    }
    return { scripts, values };
  }

  /**
   * Whether `controlBlock` commits `leafScript` to the Taproot output
   * `prevoutScript` (`OP_1 <32-byte output key>`).
   * @private
   * @param {Buffer} prevoutScript
   * @param {Buffer} leafScript
   * @param {Buffer} controlBlock
   * @returns {boolean}
   */
  static _controlBlockCommits (prevoutScript, leafScript, controlBlock) {
    const out = Buffer.from(prevoutScript || []);
    const control = Buffer.from(controlBlock || []);
    if (out.length !== 34 || out[0] !== 0x51 || out[1] !== 0x20) return false;
    if (control.length < 33 || (control.length - 33) % 32 !== 0) return false;
    try {
      const b = bip341();
      const leafHash = b.tapleafHash({ output: Buffer.from(leafScript), version: control[0] & 0xfe });
      const tweaked = b.tweakKey(control.subarray(1, 33), b.rootHashFromPath(control, leafHash));
      return !!tweaked && tweaked.parity === (control[0] & 1) && Buffer.from(tweaked.x).equals(out.subarray(2));
    } catch (_) {
      return false;
    }
  }

  /**
   * Whether every key in `pubkeys` has a valid BIP340 signature on the
   * script-path stack over input `index` of `tx` through `path.script`.
   * @private
   * @param {object} tx bitcoinjs Transaction
   * @param {number} index
   * @param {{ scripts: Buffer[], values: bigint[] }} prevouts
   * @param {object} path from {@link FraudProof._scriptPathOf}
   * @param {string[]} pubkeys x-only hex
   * @returns {boolean}
   */
  static _scriptPathSignedBy (tx, index, prevouts, path, pubkeys) {
    const b = bip341();
    const leafHash = b.tapleafHash({ output: path.script, version: path.controlBlock[0] & 0xfe });
    const digests = new Map();
    const digest = (hashType) => {
      if (!digests.has(hashType)) {
        digests.set(hashType, Buffer.from(tx.hashForWitnessV1(index, prevouts.scripts, prevouts.values, hashType, leafHash, path.annex || undefined)));
      }
      return digests.get(hashType);
    };
    return pubkeys.every((pk) => HEX64.test(String(pk || '')) && path.stack.some((sig) => {
      if (sig.length !== 64 && sig.length !== 65) return false;
      const hashType = sig.length === 65 ? sig[64] : 0x00;
      if (sig.length === 65 && hashType === 0x00) return false;
      try {
        return schnorr.verify(sig.subarray(0, 64), digest(hashType), Buffer.from(pk, 'hex'));
      } catch (_) {
        return false;
      }
    }));
  }

  /**
   * Every byte form the deposit's `penalty` leaf (2-of-2 publisher + provider,
   * no lock — see `Bond.buildDeposit`) can take for two x-only keys. The leaf
   * sorts compressed keys, so each parity combination is a candidate.
   * @private
   * @param {string} publisherPubkey x-only or compressed hex
   * @param {string} providerPubkey x-only or compressed hex
   * @returns {Buffer[]}
   */
  static _penaltyLeafScripts (publisherPubkey, providerPubkey) {
    const { buildSpendLeaf } = require('./policy');
    const a = xOnlyHex(publisherPubkey);
    const b = xOnlyHex(providerPubkey);
    if (!HEX64.test(String(a || '')) || !HEX64.test(String(b || '')) || a === b) return [];
    const out = [];
    for (const pa of ['02', '03']) {
      for (const pb of ['02', '03']) {
        try {
          const script = buildSpendLeaf({ id: 'penalty', keys: [pa + a, pb + b], threshold: 2 }).script;
          if (!out.some((s) => s.equals(script))) out.push(script);
        } catch (_) { /* not a curve point */ }
      }
    }
    return out;
  }

  /**
   * Evidence that `tx` confirmed in the verifier's chain at least
   * `ctx.minConfirmations` (default 6) deep: an SPV inclusion proof whose
   * header meets its target, is in the verifier's best chain
   * (`ctx.headerKnown`), is deep enough (`ctx.confirmations`), and whose
   * branch depth matches the block's transaction count (`ctx.txCount`, else
   * the artifact's own `txCount`); or the verifier's own
   * `ctx.txConfirmations(txid)` (preferred), else `ctx.txConfirmed(txid, depth)`,
   * which the host must answer for at least `depth` confirmations — it is
   * trusted as given. Without a chain view nothing verifies — a
   * header anyone can build proves nothing.
   * @private
   * @param {object} tx bitcoinjs Transaction
   * @param {object} [inclusion] `BitcoinTxInclusion` artifact
   * @param {object} ctx verifier chain view
   * @returns {{ ok: boolean, reason: (string|undefined), kind: (string|undefined), blockHash: (string|undefined) }}
   */
  static _broadcastEvidence (tx, inclusion, ctx = {}) {
    const txid = tx.getId();
    const depth = minConfirmations(ctx);
    // A 64-byte transaction can masquerade as an inner Merkle node.
    if (tx.byteLength(false) === 64) return { ok: false, reason: '64-byte transaction cannot be proven by a Merkle branch' };
    const ownView = () => {
      if (typeof ctx.txConfirmations === 'function') {
        const n = toInt(ctx.txConfirmations(txid));
        if (n == null || n < depth) return { ok: false, reason: `transaction has ${n || 0} of ${depth} confirmations in the verifier's chain view` };
        return { ok: true, kind: 'chain-view' };
      }
      if (typeof ctx.txConfirmed === 'function') {
        if (!ctx.txConfirmed(txid, depth)) return { ok: false, reason: 'transaction is not confirmed in the verifier\'s chain view' };
        return { ok: true, kind: 'chain-view' };
      }
      return null;
    };
    if (inclusion && typeof inclusion === 'object') {
      if (String(inclusion.txid || '').toLowerCase() !== txid) return { ok: false, reason: 'inclusion artifact is for another transaction' };
      if (typeof ctx.headerKnown === 'function') {
        const header = verifyInclusion(inclusion);
        if (!header.ok && header.reason !== 'txCount required to pin the branch depth') {
          return { ok: false, reason: `inclusion artifact invalid: ${header.reason}` };
        }
        const blockHash = header.blockHash;
        if (!blockHash || !ctx.headerKnown(blockHash)) return { ok: false, reason: `block ${blockHash} is not in the verifier's header chain` };
        if (typeof ctx.confirmations !== 'function') return { ok: false, reason: 'chain view required: ctx.confirmations(blockHash) for inclusion depth' };
        const confirmations = toInt(ctx.confirmations(blockHash));
        if (confirmations == null || confirmations < depth) return { ok: false, reason: `block ${blockHash} has ${confirmations || 0} of ${depth} confirmations` };
        const txCount = typeof ctx.txCount === 'function' ? ctx.txCount(blockHash) : undefined;
        const check = verifyInclusion(inclusion, { txCount, requireTxCount: true });
        if (!check.ok) return { ok: false, reason: `inclusion artifact invalid: ${check.reason}` };
        return { ok: true, kind: 'inclusion', blockHash };
      }
      const view = ownView();
      if (view) {
        if (!view.ok) return view;
        const check = verifyInclusion(inclusion);
        return Object.assign(view, { blockHash: check.ok ? check.blockHash : undefined });
      }
      return { ok: false, reason: 'chain view required: ctx.headerKnown + ctx.confirmations, or ctx.txConfirmations' };
    }
    const view = ownView();
    if (view) return view;
    return { ok: false, reason: 'broadcast evidence required: inclusion artifact with ctx.headerKnown + ctx.confirmations, or ctx.txConfirmations' };
  }

  /**
   * Non-response absence anchored to a timelock (see class doc). The deposit
   * outpoint's state must come from confirmed chain data at least
   * `ctx.minConfirmations` deep past the deadline; a mempool view would let a
   * pending check-in or answer be ignored.
   * @private
   */
  static _timelockedAbsence (bound, challenge, commitment, a, ctx, fail) {
    const deadlineHeight = toInt(challenge.deadlineHeight);
    if (!deadlineHeight) return fail('absence needs a challenge with deadlineHeight — silence alone is not provable');
    const dep = challenge.deposit || {};
    const depTxid = hex64(dep.txid);
    const depVout = toInt(dep.vout);
    if (!depTxid || depVout == null) return fail('challenge names no deposit outpoint');
    const challengeHash = Witness.artifactHash(challenge);
    const check = Witness.verifyPenaltyPreSig(a.penaltyPreSig, {
      providerPubkey: bound.provider,
      publisherPubkey: bound.publisher,
      deposit: dep,
      deadlineHeight,
      depositAddress: commitment.depositAddress || dep.address || null
    });
    if (!check.ok) return fail(`penalty pre-signature: ${check.reason}`);
    const base = { evidence: 'timelock', enforceableAfterHeight: deadlineHeight, penaltyTxid: check.txid, enforceable: check.enforceable };
    const tip = toInt(ctx.tipHeight);
    if (tip == null) return fail('chain view required: ctx.tipHeight', base);
    const depth = minConfirmations(ctx);
    if (tip < deadlineHeight + depth) return fail(`deadline height ${deadlineHeight} is not yet ${depth} blocks deep (tip ${tip})`, base);
    let alreadyEnforced = false;
    let withdrawn = false;
    if (typeof ctx.outpointSpend === 'function') {
      const spend = ctx.outpointSpend(depTxid, depVout);
      if (spend) {
        const leafId = String(spend.leafId || '');
        if (leafId === 'penalty') alreadyEnforced = true;
        else if (leafId === 'withdraw') withdrawn = true;
        else return fail(`deposit outpoint was spent${leafId ? ` through ${leafId}` : ''} — the provider checked in or answered`, base);
      }
    } else if (typeof ctx.outpointUnspent === 'function') {
      if (!ctx.outpointUnspent(depTxid, depVout)) return fail('deposit outpoint was spent — the provider checked in, answered, or was already penalized', base);
    } else {
      return fail('chain view required: ctx.outpointSpend or ctx.outpointUnspent', base);
    }
    Object.assign(base, { enforceable: check.enforceable && !alreadyEnforced && !withdrawn, alreadyEnforced, withdrawn });
    const acknowledged = hex64(a.penaltyPreSig.challengeHash) === challengeHash;
    const answerable = FraudProof._answerPathProven(challenge, bound.provider, check.spentScript, a.answerPath);
    if (acknowledged && answerable && check.enforceable) {
      return convict(bound.provider, `provider held challenge ${challengeHash.slice(0, 16)}… with a unilateral answer path and neither answered nor checked in by height ${deadlineHeight} (tip ${tip})`, base);
    }
    const why = !acknowledged
      ? 'the pre-signature does not acknowledge this challenge'
      : (!answerable ? 'the deposit has no provider-unilateral answer path for this challenge' : 'the penalty names no publisher destination');
    return Object.assign({
      ok: true,
      offender: null,
      reputational: false,
      accused: bound.provider,
      reason: `pre-signed penalty ${check.txid} is past its deadline, but this is not proof of non-response: ${why}`
    }, base);
  }

  /**
   * Whether `answerPath.controlBlockHex` commits the provider's `answer` leaf
   * for `challenge.answerHashHex` to the spent deposit output.
   * @private
   */
  static _answerPathProven (challenge, provider, spentScript, answerPath) {
    if (!answerPath || !spentScript) return false;
    const script = FraudProof.answerLeafScript(provider, challenge.answerHashHex);
    const control = hexBytes(answerPath.controlBlockHex);
    return !!script && !!control && FraudProof._controlBlockCommits(spentScript, script, control);
  }

  /**
   * Whether the publisher's pinned `blobHashHex` is proven to sit at the
   * challenged index (`challenge.pinProof`, or one carried beside it).
   * @private
   */
  static _pinProven (challenge, bound, extraProof) {
    const proof = challenge.pinProof || extraProof;
    return !!proof && verifyBlobPath({ merkleRootHex: bound.root, leafHex: challenge.blobHashHex, index: bound.blobIndex, leafCount: bound.blobTotal, proof });
  }

  /**
   * provider-signed response to exactly this challenge
   * @private
   */
  static _responseTo (challenge, response, provider) {
    if (!response || response.type !== RESPONSE_TYPE) return { ok: false, reason: 'response missing' };
    if (!Witness.verifyArtifact(response, provider)) return { ok: false, reason: 'response signature invalid' };
    if (hex64(response.challengeHash) !== Witness.artifactHash(challenge)) return { ok: false, reason: 'response answers another challenge' };
    return { ok: true };
  }

  /**
   * Seller-signed offer + paid, seller-signed delivery frame for the same
   * document, root, blob index, and payment (wrong-bytes, bad-key).
   * @private
   */
  static _offerDelivery (a = {}) {
    const no = (reason) => ({ ok: false, reason });
    const { offer, claim, delivery } = a;
    if (!offer || offer.type !== 'DocumentOffer') return no('signed DocumentOffer required');
    if (!Witness.verifyArtifact(offer)) return no('offer signature invalid');
    const seller = xOnlyHex(offer.pubkey);
    const documentId = typeof offer.documentId === 'string' ? offer.documentId.trim() : '';
    if (!documentId) return no('offer names no documentId');
    const root = hex64(offer.merkleRootHex);
    if (!root) return no('offer names no merkleRootHex');
    const blobIndex = toInt(offer.blobIndex);
    if (blobIndex == null) return no('offer names no integer blobIndex');
    const want = hex64(offer.blobHashHex);
    if (!want) return no('offer carries no blobHashHex');
    const offeredHash = hex64(offer.paymentHashHex);
    if (!offeredHash) return no('offer carries no paymentHashHex — payment cannot be bound to the delivery');
    const preimage = hex64(claim && claim.preimageHex);
    if (!preimage) return no('claim preimage missing');
    if (sha256Hex(Buffer.from(preimage, 'hex')) !== offeredHash) return no('claim preimage does not match the offered payment hash');
    const frameHex = delivery && (delivery.frameHex || delivery.frame);
    if (!frameHex) return no('delivery frame missing — needs the seller-signed P2P_FILE_SEND frame');
    const frame = Message.verifyFrameAuthor(frameHex);
    if (!frame.ok) return no(`delivery frame: ${frame.reason}`);
    if (frame.type !== P2P_FILE_SEND) return no('delivery frame is not a P2P_FILE_SEND');
    if (frame.author !== seller) return no('delivery frame was not signed by the offer signer');
    let body = null;
    try { body = JSON.parse(frame.body.toString('utf8')); } catch (_) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return no('delivery frame body is not a P2P_FILE_SEND object');
    // Only the signed body binds the delivery to the payment; anything beside
    // the frame (e.g. `delivery.paymentHashHex`) is attacker-chosen.
    const onWire = hex64(body.paymentHashHex);
    if (!onWire) return no('delivery frame does not sign a paymentHashHex — it is not the paid delivery');
    if (onWire !== offeredHash) return no('delivery frame is for another payment hash');
    if (String(body.documentId || body.name || '').trim() !== documentId) return no('delivery frame is for another document');
    if (hex64(body.merkleRootHex) !== root) return no('delivery frame is for another tree root');
    if (toInt(body.blobIndex) !== blobIndex) return no('delivery frame is for another blob index');
    if (typeof body.body !== 'string') return no('delivery frame carries no blob body');
    return { ok: true, seller, want, preimage, offer, body, bytes: Buffer.from(body.body, 'base64') };
  }

  /**
   * Compressed `secret · G` (secret reduced mod n, as `Channel.commitmentPoint`).
   * @private
   */
  static _commitmentPoint (secretHex) {
    try {
      const n = secp256k1.Point.CURVE().n;
      const k = BigInt(`0x${secretHex}`) % n;
      return k === 0n ? null : secp256k1.Point.BASE.multiply(k).toHex(true);
    } catch (_) {
      return null;
    }
  }
}

/**
 * verdict that names an offender and may move reputation
 * @private
 */
function convict (offender, reason, extra = {}) {
  return Object.assign({ ok: true, offender, reputational: true, reason }, extra);
}

FraudProof.DEFAULT_CONFIRMATIONS = DEFAULT_CONFIRMATIONS;
FraudProof.TYPES = Object.freeze({
  COMMITMENT: COMMITMENT_TYPE,
  CHALLENGE: CHALLENGE_TYPE,
  RESPONSE: RESPONSE_TYPE,
  RECEIPT: RECEIPT_TYPE,
  ATTESTATION: ATTESTATION_TYPE,
  PENALTY_PRESIG: PRESIG_TYPE
});
FraudProof.verifyBlobPath = verifyBlobPath;
FraudProof.leafIndexFor = leafIndexFor;
FraudProof.toInt = toInt;

Witness.FraudProof = FraudProof;
Witness.verifyPenaltyPreSig = FraudProof.verifyPenaltyPreSig;
Witness.checkPenaltyPsbt = FraudProof.checkPenaltyPsbt;
Witness.verifyBlobPath = verifyBlobPath;
Witness.FRAUD_PROOF_KINDS = FRAUD_PROOF_KINDS;

// BIP-327 MuSig2 (key aggregation, nonces, partial signatures); `Session` is
// the Fabric round state machine over it, `Adaptor` its adaptor sessions.
Witness.MuSig2 = Object.freeze(Object.assign({}, musig2, {
  Adaptor: musig2Adaptor,
  Session: musig2Session
}));

// BIP-340 adaptor signatures: pre-sign, pre-verify, adapt, extract.
Witness.Adaptor = adaptor;

// Chaum-Pedersen discrete-log equality proofs.
Witness.DLEQ = dleq;

// BLS12-381 signatures and the federation witness bundles bound to secp256k1 validators.
Witness.BLS = bls;

module.exports = Witness;
