'use strict';

/**
 * Shared helpers for opt-in fuzz-style tests (random inputs on parser / wire / UI surfaces).
 * Iteration count: {@link process.env.FABRIC_FUZZ_ITERATIONS} (positive integer) or default.
 *
 * Target runtime: Node 24.14.1 (see package.json engines).
 */

const crypto = require('crypto');
const net = require('net');
const { HEADER_SIZE, MAX_MESSAGE_SIZE, PERSISTED_JSON_MAX_CHARS } = require('../../constants');

/**
 * @param {number} [defaultN]
 * @returns {number}
 */
function fuzzIterations (defaultN = 400) {
  const n = Number(process.env.FABRIC_FUZZ_ITERATIONS);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 50000);
  return defaultN;
}

/**
 * Iterations for live peer chaos (TCP + NOISE); capped to keep CI reasonable.
 * Override with {@link process.env.FABRIC_FUZZ_PEER_CHAOS_ITERATIONS}.
 * @param {number} [defaultN]
 * @returns {number}
 */
function fuzzPeerChaosIterations (defaultN = 80) {
  const raw = Number(process.env.FABRIC_FUZZ_PEER_CHAOS_ITERATIONS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(Math.floor(raw), 500);
  return Math.min(fuzzIterations(defaultN), 250);
}

/**
 * @returns {Promise<number>}
 */
async function getFreePort () {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      s.close(() => {
        if (!port) return reject(new Error('Could not allocate a free port'));
        resolve(port);
      });
    });
  });
}

/**
 * @param {number} maxLen inclusive upper bound on length
 * @returns {Buffer}
 */
function randomBuffer (maxLen) {
  const len = crypto.randomInt(0, maxLen + 1);
  return crypto.randomBytes(len);
}

/** Random AMP-sized frame: 0 … HEADER_SIZE + MAX_MESSAGE_SIZE bytes. */
function randomAmpFrame () {
  const maxTotal = HEADER_SIZE + MAX_MESSAGE_SIZE;
  const total = crypto.randomInt(0, maxTotal + 1);
  return crypto.randomBytes(total);
}

/**
 * @param {number} maxChars — max UTF-16 code units in result
 * @param {number} [maxByteBudget] — cap on random bytes read (default min(n*4, 65536))
 * @param {number} [minChars=0] — inclusive lower bound on length (for forcing oversize persisted strings)
 * @returns {string}
 */
function randomUtf8String (maxChars, maxByteBudget, minChars = 0) {
  const lo = Math.max(0, Math.min(minChars | 0, maxChars));
  const n = crypto.randomInt(lo, maxChars + 1);
  if (n === 0) return '';
  const defaultCap = Math.min(n * 4, 65536);
  const byteCap = maxByteBudget != null ? Math.max(1, maxByteBudget) : defaultCap;
  const raw = crypto.randomBytes(byteCap);
  return raw.toString('utf8').slice(0, n);
}

/** Sometimes longer than wire/persisted limits to exercise rejection paths. */
function randomWireLikeString () {
  const roll = crypto.randomInt(0, 10);
  const cap = roll === 0
    ? MAX_MESSAGE_SIZE + crypto.randomInt(1, 500)
    : MAX_MESSAGE_SIZE;
  return randomUtf8String(cap);
}

function randomPersistedLikeString () {
  const roll = crypto.randomInt(0, 20);
  if (roll === 0) {
    const cap = PERSISTED_JSON_MAX_CHARS + crypto.randomInt(1, 2000);
    const byteBudget = Math.min(cap * 4 + 4096, PERSISTED_JSON_MAX_CHARS * 4 + 8192);
    return randomUtf8String(cap, byteBudget, PERSISTED_JSON_MAX_CHARS + 1);
  }
  const cap = Math.min(PERSISTED_JSON_MAX_CHARS, 50000);
  return randomUtf8String(cap);
}

/**
 * Small random tree (bounded node count — avoid exponential blow-up).
 * @param {number} maxDepth
 * @param {number} [budget]
 * @returns {*}
 */
function randomAcyclicObject (maxDepth, budget = 40) {
  if (budget <= 0 || maxDepth <= 0) {
    const k = crypto.randomInt(0, 6);
    if (k === 0) return null;
    if (k === 1) return true;
    if (k === 2) return false;
    if (k === 3) return crypto.randomInt(-1e9, 1e9);
    if (k === 4) return randomUtf8String(24);
    return [];
  }
  const o = {};
  const n = crypto.randomInt(0, Math.min(4, budget + 1));
  let b = budget - 1;
  for (let i = 0; i < n; i++) {
    const spend = Math.max(1, Math.floor(b / (n - i)));
    b -= spend;
    o[`k${i}_${crypto.randomInt(0, 1000)}`] = randomAcyclicObject(maxDepth - 1, spend);
  }
  return o;
}

module.exports = {
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  PERSISTED_JSON_MAX_CHARS,
  fuzzIterations,
  fuzzPeerChaosIterations,
  getFreePort,
  randomBuffer,
  randomAmpFrame,
  randomUtf8String,
  randomWireLikeString,
  randomPersistedLikeString,
  randomAcyclicObject
};
