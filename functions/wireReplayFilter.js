'use strict';

/**
 * Remembers wire-envelope hashes across two Bloom filter generations, rotated
 * when the current one is full (`capacity`) or older than `maxAgeMs`; the
 * previous one is dropped `2 × maxAgeMs` after it started. That outlasts the
 * Peer's exact FIFO cache (flushed by 10k frames), but capacity still bounds
 * it: about `2 × capacity` distinct frames rotate a hash out, however soon.
 * The price of a full filter is a rare false "seen", which drops a frame,
 * never a replay accepted.
 *
 * The wire header has no timestamp or sequence number, so frames older than
 * two generations can still be replayed; closing that needs a signed field in
 * a new message version.
 */

const DEFAULTS = Object.freeze({
  /** Hashes per generation before it rotates. */
  capacity: 500000,
  /** Target false-positive rate of a full generation. */
  falsePositiveRate: 1e-6,
  /** A generation rotates after this long even when not full. */
  maxAgeMs: 24 * 60 * 60 * 1000
});

class WireReplayFilter {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.capacity]
   * @param {number} [settings.falsePositiveRate]
   * @param {number} [settings.maxAgeMs]
   * @param {function(): number} [settings.now]
   */
  constructor (settings = {}) {
    const s = Object.assign({}, DEFAULTS, settings);
    this.capacity = Math.max(1, Math.floor(Number(s.capacity) || DEFAULTS.capacity));
    const p = Number(s.falsePositiveRate) > 0 && Number(s.falsePositiveRate) < 1 ? Number(s.falsePositiveRate) : DEFAULTS.falsePositiveRate;
    this.bits = Math.max(64, Math.ceil(-this.capacity * Math.log(p) / (Math.LN2 * Math.LN2)));
    this.hashes = Math.max(1, Math.min(32, Math.round((this.bits / this.capacity) * Math.LN2)));
    this.maxAgeMs = Number(s.maxAgeMs) > 0 ? Number(s.maxAgeMs) : DEFAULTS.maxAgeMs;
    this._now = typeof s.now === 'function' ? s.now : Date.now;
    this._current = this._generation();
    this._previous = null;
  }

  /** @private */
  _generation () {
    return { bits: new Uint8Array(Math.ceil(this.bits / 8)), count: 0, since: this._now() };
  }

  /**
   * Bit positions for a hash (double hashing over two 32-bit words of it).
   * @private
   * @param {string} hex SHA-256 hex (already uniform)
   */
  _positions (hex) {
    const h1 = parseInt(hex.slice(0, 8), 16) >>> 0;
    const h2 = (parseInt(hex.slice(8, 16), 16) | 1) >>> 0;
    const out = new Array(this.hashes);
    for (let i = 0; i < this.hashes; i++) out[i] = (h1 + Math.imul(i, h2) >>> 0) % this.bits;
    return out;
  }

  /** @private */
  _test (gen, positions) {
    for (const p of positions) if (!(gen.bits[p >>> 3] & (1 << (p & 7)))) return false;
    return true;
  }

  /** @private */
  _rotateIfDue () {
    if (this._current.count >= this.capacity || this._now() - this._current.since >= this.maxAgeMs) {
      this._previous = this._current;
      this._current = this._generation();
    }
    if (this._previous && this._now() - this._previous.since >= 2 * this.maxAgeMs) this._previous = null;
  }

  /**
   * @param {string} hex wire hash (SHA-256 hex)
   * @returns {boolean} true when this hash was (probably) added within the window
   */
  has (hex) {
    if (typeof hex !== 'string' || hex.length < 16) return false;
    this._rotateIfDue();
    const positions = this._positions(hex);
    return this._test(this._current, positions) || (!!this._previous && this._test(this._previous, positions));
  }

  /**
   * @param {string} hex wire hash (SHA-256 hex)
   */
  add (hex) {
    if (typeof hex !== 'string' || hex.length < 16) return;
    this._rotateIfDue();
    for (const p of this._positions(hex)) this._current.bits[p >>> 3] |= (1 << (p & 7));
    this._current.count++;
  }
}

module.exports = WireReplayFilter;
module.exports.WIRE_REPLAY_FILTER_DEFAULTS = DEFAULTS;
