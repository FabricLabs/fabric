'use strict';

/**
 * Seedable PRNG (mulberry32) for reproducible simulator schedules.
 */

/**
 * @param {number|string|null|undefined} seed
 * @returns {number} uint32 seed
 */
function normalizeSeed (seed) {
  if (seed == null || seed === '') {
    return (Date.now() ^ (Math.floor(Math.random() * 0xffffffff))) >>> 0;
  }
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  const s = String(seed).trim();
  // Numeric strings (CLI `--seed 42`) keep their integer value.
  if (/^-?\d+$/.test(s)) {
    return (Number(s) >>> 0);
  }
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {number|string|null|undefined} [seed]
 * @returns {{ seed: number, next: function(): number, int: function(number, number=): number, pick: function(Array): *, chance: function(number): boolean }}
 */
function createRng (seed) {
  let state = normalizeSeed(seed);
  const fixedSeed = state;

  function next () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Inclusive lo, exclusive hi (like crypto.randomInt).
   * @param {number} lo
   * @param {number} [hi]
   */
  function int (lo, hi) {
    if (hi == null) {
      hi = lo;
      lo = 0;
    }
    if (hi <= lo) return lo;
    return lo + Math.floor(next() * (hi - lo));
  }

  function pick (arr) {
    if (!arr || !arr.length) return undefined;
    return arr[int(0, arr.length)];
  }

  /** @param {number} p probability in [0,1] */
  function chance (p) {
    return next() < p;
  }

  return {
    seed: fixedSeed,
    next,
    int,
    pick,
    chance
  };
}

module.exports = {
  normalizeSeed,
  createRng
};
