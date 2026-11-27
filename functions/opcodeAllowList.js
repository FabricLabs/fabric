'use strict';

/**
 * Normalize ARC / Program opcode allow-lists for {@link Machine}.
 *
 * @module functions/opcodeAllowList
 * @see docs/PROGRAM.md
 * @see docs/CONTRACTS.md
 */

/**
 * @param {Iterable<*>} [list]
 * @returns {string[]}
 */
function normalizeOpcodeAllowList (list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const name = String(raw == null ? '' : raw).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Read `primitives.opcodes` (or top-level `opcodes`) from a genesis / ARC / Program bag.
 * @param {object} [source]
 * @returns {string[]} empty when unrestricted / absent
 */
function opcodesFromGenesis (source = {}) {
  const src = source && typeof source === 'object' ? source : {};
  const primitives = src.primitives && typeof src.primitives === 'object' ? src.primitives : {};
  const fromPrim = Array.isArray(primitives.opcodes) ? primitives.opcodes : [];
  const fromTop = Array.isArray(src.opcodes) ? src.opcodes : [];
  const fromSettings = src.settings && Array.isArray(src.settings.opcodes)
    ? src.settings.opcodes
    : [];
  const fromAllowed = Array.isArray(src.allowedOpcodes) ? src.allowedOpcodes : [];
  if (fromPrim.length) return normalizeOpcodeAllowList(fromPrim);
  if (fromTop.length) return normalizeOpcodeAllowList(fromTop);
  if (fromSettings.length) return normalizeOpcodeAllowList(fromSettings);
  if (fromAllowed.length) return normalizeOpcodeAllowList(fromAllowed);
  return [];
}

/**
 * @param {string[]} allowList
 * @param {string} name
 * @returns {boolean}
 */
function opcodeAllowed (allowList, name) {
  if (!allowList || !allowList.length) return true;
  return allowList.includes(String(name || ''));
}

/**
 * @param {string[]} allowList
 * @param {Iterable<*>} steps
 * @returns {{ ok: true }|{ ok: false, error: string, unknown: string[] }}
 */
function assertStepsAllowed (allowList, steps) {
  if (!allowList || !allowList.length) return { ok: true };
  const unknown = [];
  for (const step of steps || []) {
    const name = String(step == null ? '' : step).trim();
    if (!name) continue;
    if (!opcodeAllowed(allowList, name)) unknown.push(name);
  }
  if (!unknown.length) return { ok: true };
  return {
    ok: false,
    error: `opcode(s) not in primitives.opcodes allow-list: ${unknown.join(', ')}`,
    unknown
  };
}

module.exports = {
  normalizeOpcodeAllowList,
  opcodesFromGenesis,
  opcodeAllowed,
  assertStepsAllowed
};
