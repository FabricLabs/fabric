'use strict';

/**
 * @fileoverview Proof of discrete log equivalence (PoDLE) for the coinjoin
 * market's anti-snooping rule, after JoinMarket. Before a maker reveals its
 * UTXOs, the taker commits to one of its own P2TR UTXOs without naming it:
 *
 * - `P = q·G` is the UTXO's (even-y) output key and `q` its private key;
 * - `J_i` is a nothing-up-my-sleeve generator for index `i` (0–2);
 * - `P2 = q·J_i`, and the commitment is `SHA256(P2)`.
 *
 * The reveal names the UTXO and carries `P`, `P2`, and a Schnorr-style DLEQ
 * proof that `log_G(P) = log_J(P2)`. Each UTXO yields only
 * {@link PODLE_MAX_INDEX} distinct commitments, and makers remember used
 * ones ({@link PodleBlacklist}), so a taker who aborts rounds to learn maker
 * UTXOs burns its own coins' tries. See `docs/COINJOIN_MARKET.md`.
 */

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1.js');

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

/** Distinct commitments one UTXO can produce (indices `0 … PODLE_MAX_INDEX − 1`). */
const PODLE_MAX_INDEX = 3;
/** Domain tag mixed into the DLEQ challenge. */
const PODLE_TAG = 'fabric/podle/v1';
/** Default: the commitment UTXO must be this many blocks deep. */
const DEFAULT_MIN_AGE_CONFS = 5;
/** Default: the commitment UTXO must be worth this percent of the coinjoin amount. */
const DEFAULT_MIN_VALUE_PCT = 20;
/** Default size of a maker's used-commitment memory. */
const DEFAULT_BLACKLIST_SIZE = 100000;

/** @private */
function fail (message) {
  throw new Error(`podle: ${message}`);
}

/** @private */
function sha256 (...parts) {
  const h = crypto.createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest();
}

/** @private */
function hexOf (label, value, bytes) {
  const s = String(value == null ? '' : value).trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(s) || s.length !== bytes * 2) fail(`${label} must be ${bytes * 2} hex characters`);
  return s;
}

/** @private */
function scalarFromBytes (buf) {
  return BigInt('0x' + Buffer.from(buf).toString('hex')) % N;
}

/** @private */
function scalarHex (k) {
  return k.toString(16).padStart(64, '0');
}

/** @private */
function pointHex (P) {
  return Buffer.from(P.toBytes(true)).toString('hex');
}

/** @private */
function pointOf (label, hex) {
  const s = hexOf(label, hex, 33);
  try {
    return Point.fromHex(s);
  } catch {
    return fail(`${label} is not a point on secp256k1`);
  }
}

/** @private */
function isEvenY (P) {
  return (P.toAffine().y & 1n) === 0n;
}

const generators = new Map();

/**
 * Nothing-up-my-sleeve generator `J_index`: the first `SHA256(G ‖ index ‖ counter)`
 * that is a valid x coordinate, lifted to even y. Nobody knows `log_G(J)`.
 * @param {number} index 0 … {@link PODLE_MAX_INDEX} − 1
 * @returns {Object} noble `Point`
 */
function generatorJ (index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= PODLE_MAX_INDEX) fail(`index must be an integer in [0, ${PODLE_MAX_INDEX - 1}]`);
  if (generators.has(i)) return generators.get(i);
  const seed = Buffer.from(G.toBytes(true));
  for (let counter = 0; counter < 256; counter++) {
    const x = sha256(seed, Buffer.from([i, counter]));
    try {
      const J = Point.fromHex(Buffer.concat([Buffer.from([0x02]), x]).toString('hex'));
      generators.set(i, J);
      return J;
    } catch {}
  }
  return fail('no generator found');
}

/**
 * The commitment for a `P2` point.
 * @param {string} p2Hex compressed point
 * @returns {string} 64 hex characters
 */
function commitmentOf (p2Hex) {
  return sha256(Buffer.from(hexOf('P2', p2Hex, 33), 'hex')).toString('hex');
}

/**
 * Private key for the even-y form of a key's point (BIP340 convention), so
 * `P` matches a P2TR output key by its x coordinate alone.
 * @param {Buffer|string} priv32 the UTXO's output (tweaked) private key
 * @returns {{ k: bigint, P: Object }}
 * @private
 */
function evenKey (priv32) {
  const buf = Buffer.isBuffer(priv32) || priv32 instanceof Uint8Array
    ? Buffer.from(priv32)
    : Buffer.from(hexOf('privateKey', priv32, 32), 'hex');
  if (buf.length !== 32) fail('privateKey must be 32 bytes');
  let k = BigInt('0x' + buf.toString('hex'));
  if (k <= 0n || k >= N) fail('invalid private key');
  let P = G.multiply(k);
  if (!isEvenY(P)) {
    k = N - k;
    P = P.negate();
  }
  return { k, P };
}

/** @private */
function outpointOf (utxo = {}) {
  const txid = hexOf('txid', utxo.txid, 32);
  const vout = Number(utxo.vout);
  if (!Number.isSafeInteger(vout) || vout < 0) fail('vout must be a non-negative integer');
  return { txid, vout };
}

/** @private */
function challenge ({ Kg, Kj, P, P2, txid, vout, index }) {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(vout, 0);
  head.writeUInt8(index, 4);
  return scalarFromBytes(sha256(
    Buffer.from(PODLE_TAG),
    Buffer.from(Kg.toBytes(true)),
    Buffer.from(Kj.toBytes(true)),
    Buffer.from(P.toBytes(true)),
    Buffer.from(P2.toBytes(true)),
    Buffer.from(txid, 'hex'),
    head
  ));
}

/**
 * Taker: commit to a UTXO it owns.
 * @param {Object} opts
 * @param {Buffer|string} opts.privateKey 32-byte private key of the UTXO's P2TR output key
 * @param {Object} opts.utxo `{ txid, vout }`
 * @param {number} [opts.index=0] which of the UTXO's commitments to use
 * @returns {{ commitment: string, reveal: { txid: string, vout: number, index: number, P: string, P2: string, e: string, s: string } }}
 */
function generatePodle (opts = {}) {
  const { txid, vout } = outpointOf(opts.utxo);
  const index = opts.index == null ? 0 : Number(opts.index);
  const J = generatorJ(index);
  const { k, P } = evenKey(opts.privateKey);
  const P2 = J.multiply(k);
  let r = 0n;
  while (r === 0n) r = scalarFromBytes(crypto.randomBytes(32));
  const Kg = G.multiply(r);
  const Kj = J.multiply(r);
  const e = challenge({ Kg, Kj, P, P2, txid, vout, index });
  const s = (r + (e * k)) % N;
  const reveal = {
    txid,
    vout,
    index,
    P: pointHex(P),
    P2: pointHex(P2),
    e: scalarHex(e),
    s: scalarHex(s)
  };
  return { commitment: commitmentOf(reveal.P2), reveal };
}

/**
 * Maker: check a reveal against the commitment it was promised.
 * @param {Object} opts
 * @param {string} opts.commitment
 * @param {Object} opts.reveal
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function verifyPodle (opts = {}) {
  const bad = (reason) => ({ ok: false, reason });
  try {
    const reveal = opts.reveal || {};
    const commitment = hexOf('commitment', opts.commitment, 32);
    const { txid, vout } = outpointOf(reveal);
    const index = Number(reveal.index);
    const J = generatorJ(index);
    const P = pointOf('P', reveal.P);
    const P2 = pointOf('P2', reveal.P2);
    if (!isEvenY(P)) return bad('P must have even y');
    if (commitmentOf(reveal.P2) !== commitment) return bad('P2 does not match the commitment');
    const e = BigInt('0x' + hexOf('e', reveal.e, 32));
    const s = BigInt('0x' + hexOf('s', reveal.s, 32));
    if (e === 0n || e >= N || s === 0n || s >= N) return bad('proof scalars out of range');
    const Kg = G.multiply(s).subtract(P.multiply(e));
    const Kj = J.multiply(s).subtract(P2.multiply(e));
    if (Kg.equals(Point.ZERO) || Kj.equals(Point.ZERO)) return bad('degenerate proof');
    if (challenge({ Kg, Kj, P, P2, txid, vout, index }) !== e) return bad('bad DLEQ proof');
    return { ok: true, reason: null };
  } catch (err) {
    return bad(err.message);
  }
}

/**
 * Maker: check the revealed UTXO itself, as read from the chain. The output
 * must be P2TR to `P`'s x coordinate, old enough, and large enough for the
 * coinjoin it is used for.
 * @param {Object} opts
 * @param {Object} opts.reveal
 * @param {Object|null} opts.utxo `{ scriptPubKeyHex, valueSats, confirmations }` (`null` = spent / unknown)
 * @param {number} opts.amountSats coinjoin amount
 * @param {number} [opts.minAgeConfs=5]
 * @param {number} [opts.minValuePct=20]
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function checkPodleUtxo (opts = {}) {
  const bad = (reason) => ({ ok: false, reason });
  const utxo = opts.utxo;
  if (!utxo) return bad('commitment UTXO is spent or unknown');
  const reveal = opts.reveal || {};
  let xonly;
  try {
    xonly = hexOf('P', reveal.P, 33).slice(2);
  } catch (err) {
    return bad(err.message);
  }
  if (String(utxo.scriptPubKeyHex || '').toLowerCase() !== `5120${xonly}`) return bad('commitment UTXO is not a P2TR output to P');
  const minAge = opts.minAgeConfs != null ? Number(opts.minAgeConfs) : DEFAULT_MIN_AGE_CONFS;
  if (!(Number(utxo.confirmations) >= minAge)) return bad(`commitment UTXO needs ${minAge} confirmations`);
  const pct = opts.minValuePct != null ? Number(opts.minValuePct) : DEFAULT_MIN_VALUE_PCT;
  const amount = Number(opts.amountSats);
  if (!Number.isFinite(amount) || amount <= 0) return bad('amountSats is required');
  if (Number(utxo.valueSats) * 100 < amount * pct) return bad(`commitment UTXO must be worth ${pct}% of the amount`);
  return { ok: true, reason: null };
}

/**
 * Lowest commitment index the taker has not used for a UTXO.
 * @param {number[]} used indices already spent on rounds
 * @returns {number|null} `null` once the UTXO is exhausted
 */
function nextIndex (used = []) {
  const taken = new Set(used.map(Number));
  for (let i = 0; i < PODLE_MAX_INDEX; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

/**
 * A maker's bounded memory of commitments already seen. A commitment is
 * used once; the oldest is forgotten first.
 */
class PodleBlacklist {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.max=100000]
   * @param {string[]} [settings.commitments] restore
   */
  constructor (settings = {}) {
    this.max = Math.max(1, Number(settings.max) || DEFAULT_BLACKLIST_SIZE);
    this._seen = new Set();
    for (const c of settings.commitments || []) this.add(c);
  }

  /** @returns {number} */
  get size () {
    return this._seen.size;
  }

  /**
   * @param {string} commitment
   * @returns {boolean}
   */
  has (commitment) {
    return this._seen.has(String(commitment || '').toLowerCase());
  }

  /**
   * Remember a commitment.
   * @param {string} commitment
   * @returns {boolean} false when it was already known
   */
  add (commitment) {
    const c = hexOf('commitment', commitment, 32);
    if (this._seen.has(c)) return false;
    while (this._seen.size >= this.max) this._seen.delete(this._seen.values().next().value);
    this._seen.add(c);
    return true;
  }

  /** @returns {string[]} oldest first */
  toJSON () {
    return Array.from(this._seen);
  }
}

module.exports = {
  PODLE_MAX_INDEX,
  PODLE_TAG,
  DEFAULT_MIN_AGE_CONFS,
  DEFAULT_MIN_VALUE_PCT,
  generatorJ,
  commitmentOf,
  generatePodle,
  verifyPodle,
  checkPodleUtxo,
  nextIndex,
  PodleBlacklist
};
