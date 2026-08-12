'use strict';

/**
 * Off-chain `when` predicates for contract spend tiers.
 * Unknown ops fail closed (PSBT prep must not proceed).
 */

/**
 * @param {object} state Contract / tip state bag
 * @param {string} path JSON-pointer-ish `/a/b`
 * @returns {*}
 */
function getPath (state, path) {
  if (!path || typeof path !== 'string') return undefined;
  const parts = path.replace(/^\//, '').split('/').filter(Boolean);
  let cur = state;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

const OPS = Object.freeze(Object.assign(Object.create(null), {
  tipClockGte (pred, ctx) {
    const tip = Number(ctx && ctx.tipClock);
    const need = Number(pred && pred.value);
    return Number.isFinite(tip) && Number.isFinite(need) && tip >= need;
  },
  statePathEq (pred, ctx) {
    if (!pred || pred.path == null || pred.path === '' || !Object.prototype.hasOwnProperty.call(pred, 'value')) {
      return false;
    }
    const actual = getPath(ctx && ctx.contractState, pred.path);
    return actual === pred.value;
  }
}));

/**
 * @param {object|null|undefined} when
 * @param {{ tipClock?: number, contractState?: object }} ctx
 * @returns {boolean}
 */
function evaluateTierWhen (when, ctx = {}) {
  if (when == null) return true;
  if (typeof when !== 'object') return false;
  const allOf = Array.isArray(when.allOf) ? when.allOf : null;
  if (!allOf || !allOf.length) return false;
  for (const pred of allOf) {
    if (!pred || typeof pred !== 'object') return false;
    const op = String(pred.op || '');
    // Own keys only — never inherit Object.prototype (constructor, toString, …).
    if (!Object.prototype.hasOwnProperty.call(OPS, op)) return false;
    const fn = OPS[op];
    if (typeof fn !== 'function') return false;
    if (!fn(pred, ctx)) return false;
  }
  return true;
}

module.exports = {
  evaluateTierWhen,
  getPath,
  OPS
};
