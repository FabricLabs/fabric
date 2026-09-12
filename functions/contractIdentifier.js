'use strict';

/**
 * Dual-read helper for the coordinated `contractId` → `contractIdentifier`
 * rename (Author Style). Prefer writing `contractIdentifier` on new objects;
 * accept legacy `contractId` until Hub / `@fabric/http` / apps finish the wave.
 *
 * This module does **not** rewrite wire schemas. OUTSTANDING keeps the rename
 * as an open Blocker until consumers land.
 *
 * @fileoverview contractIdentifier dual-field resolve / stamp helpers.
 * @module functions/contractIdentifier
 */

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeContractIdentifier (value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * Read `contractIdentifier` or legacy `contractId` from an object.
 * @param {object|null|undefined} obj
 * @returns {string|null}
 */
function resolveContractIdentifier (obj) {
  if (!obj || typeof obj !== 'object') return null;
  return normalizeContractIdentifier(obj.contractIdentifier) ||
    normalizeContractIdentifier(obj.contractId);
}

/**
 * Stamp both fields with the same value so old and new readers converge.
 * Does not delete either key.
 * @param {object} obj
 * @param {string} identifier
 * @returns {object} the same object
 */
function stampContractIdentifier (obj, identifier) {
  if (!obj || typeof obj !== 'object') return obj;
  const id = normalizeContractIdentifier(identifier);
  if (!id) return obj;
  obj.contractIdentifier = id;
  obj.contractId = id;
  return obj;
}

module.exports = {
  normalizeContractIdentifier,
  resolveContractIdentifier,
  stampContractIdentifier
};
