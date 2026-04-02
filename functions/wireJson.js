'use strict';

/**
 * Bounded JSON.parse for AMP message bodies, persisted store/Level blobs, and Jade→blessed
 * UI attrs. Centralizes length checks and parse failures so wire handlers stay consistent.
 *
 * Body size is already capped when messages are constructed, but this guards against
 * regressions or non-AMP callers passing huge strings before `JSON.parse`.
 *
 * @module functions/wireJson
 */

const { MAX_MESSAGE_SIZE, PERSISTED_JSON_MAX_CHARS } = require('../constants');

/**
 * Normalize {@link Message#data} to a string for parsing.
 * @param {*} data
 * @returns {string}
 */
function messageDataToString (data) {
  if (data == null) return '{}';
  return typeof data === 'string' ? data : String(data);
}

/**
 * Parse JSON with an explicit UTF-16 length bound (wire, LevelDB, local files).
 * @param {string} raw
 * @param {number} maxChars — reject when `raw.length > maxChars`
 * @returns {{ ok: true, value: * } | { ok: false, error: Error }}
 */
function tryParseJsonBounded (raw, maxChars) {
  if (typeof raw !== 'string') {
    return { ok: false, error: new TypeError('bounded JSON: expected string') };
  }
  if (!Number.isFinite(maxChars) || maxChars < 0) {
    return { ok: false, error: new TypeError('bounded JSON: maxChars must be a non-negative finite number') };
  }
  if (raw.length > maxChars) {
    return { ok: false, error: new RangeError(`bounded JSON: length ${raw.length} exceeds maxChars ${maxChars}`) };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return { ok: false, error: e };
  }
}

/**
 * Parse JSON from an AMP message body (see {@link MAX_MESSAGE_SIZE}).
 * @param {string} raw
 * @returns {{ ok: true, value: * } | { ok: false, error: Error }}
 */
function tryParseWireJson (raw) {
  return tryParseJsonBounded(raw, MAX_MESSAGE_SIZE);
}

/**
 * AMP / hub bodies that use empty string as “no object”: coerce to <code>'{}'</code> then {@link tryParseWireJson}.
 * @param {string} [raw]
 * @returns {{ ok: true, value: * } | { ok: false, error: Error }}
 */
function tryParseWireJsonBody (raw) {
  const s = raw == null ? '' : typeof raw === 'string' ? raw : String(raw);
  return tryParseWireJson(s === '' ? '{}' : s);
}

/**
 * LevelDB / local files / store roots: same bound as {@link PERSISTED_JSON_MAX_CHARS}.
 * @param {string} raw
 * @returns {{ ok: true, value: * } | { ok: false, error: Error }}
 */
function tryParsePersistedJson (raw) {
  return tryParseJsonBounded(raw, PERSISTED_JSON_MAX_CHARS);
}

/**
 * Like {@link JSON.parse} for persisted payloads (see {@link PERSISTED_JSON_MAX_CHARS}).
 * @param {string} raw
 * @returns {*}
 */
function parsePersistedJson (raw) {
  return parseJsonBounded(raw, PERSISTED_JSON_MAX_CHARS);
}

/**
 * String or Buffer (Level / store) → UTF-8 string for {@link tryParsePersistedJson}.
 * @param {*} raw
 * @returns {string}
 */
function utf8FromPersistedRaw (raw) {
  if (raw == null) return '';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(raw)) return raw.toString('utf8');
  return typeof raw === 'string' ? raw : String(raw);
}

/**
 * Like {@link JSON.parse} with an explicit UTF-16 length bound (throws on oversize or invalid JSON).
 * @param {string} raw
 * @param {number} maxChars
 * @returns {*}
 */
function parseJsonBounded (raw, maxChars) {
  const pr = tryParseJsonBounded(raw, maxChars);
  if (!pr.ok) throw pr.error;
  return pr.value;
}

/**
 * Jade-parser {@link Tag} attrs → blessed() params (JSON attrs use {@link parsePersistedJson}).
 * @param {Array<{ name: string, val: string }>|undefined} astAttrs
 * @returns {{ attrs: string[], params: Object }}
 */
function blessedParamsFromJadeAttrs (astAttrs) {
  const attrs = [];
  const params = {};
  if (!astAttrs) return { attrs, params };
  for (const a in astAttrs) {
    const attr = astAttrs[a];
    if (!attr || attr.name == null) continue;
    const name = String(attr.name);
    const valRaw = attr.val == null ? '' : attr.val;
    const valStr = typeof valRaw === 'string' ? valRaw : String(valRaw);
    attrs.push(name + '=' + valStr);
    if (valStr[0] === "'") {
      const content = valStr.substring(1, valStr.length - 1);
      if (content[0] === '{') {
        const pr = tryParsePersistedJson(content);
        params[name] = pr.ok ? pr.value : content;
      } else {
        params[name] = content;
      }
    } else {
      const pr = tryParsePersistedJson(valStr);
      params[name] = pr.ok ? pr.value : valStr;
    }
  }
  return { attrs, params };
}

module.exports = {
  messageDataToString,
  utf8FromPersistedRaw,
  tryParseJsonBounded,
  tryParseWireJson,
  tryParseWireJsonBody,
  tryParsePersistedJson,
  parsePersistedJson,
  parseJsonBounded,
  blessedParamsFromJadeAttrs,
  MAX_WIRE_JSON_CHARS: MAX_MESSAGE_SIZE
};
