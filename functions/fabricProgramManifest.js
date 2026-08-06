'use strict';

/**
 * Program manifest v1: program identity + allowed traffic + optional federation /
 * sidechain policy. Parsed by {@link Machine.parseManifest}.
 *
 * @module functions/fabricProgramManifest
 */

/**
 * Setup-phase manifest schema (v1).
 * @param {object} raw
 * @returns {{ ok: boolean, error?: string, manifest?: object }}
 */
function parseProgramManifestV1 (raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'manifest must be an object' };
  const version = Number(raw.version);
  if (version !== 1) return { ok: false, error: 'unsupported manifest version' };
  const programId = typeof raw.programId === 'string' ? raw.programId.trim() : '';
  const programHash = typeof raw.programHash === 'string' ? raw.programHash.trim() : '';
  if (!programId || !programHash) return { ok: false, error: 'programId and programHash are required' };
  const allowedMessageTypes = Array.isArray(raw.allowedMessageTypes)
    ? raw.allowedMessageTypes.filter((t) => typeof t === 'string')
    : [];
  const federation = raw.federation && typeof raw.federation === 'object'
    ? {
        validators: Array.isArray(raw.federation.validators)
          ? raw.federation.validators.filter((v) => typeof v === 'string')
          : [],
        threshold: Math.max(1, Number(raw.federation.threshold) || 1)
      }
    : null;
  let sidechainPolicy = null;
  if (raw.sidechainPolicy && typeof raw.sidechainPolicy === 'object') {
    try {
      const sidechainState = require('./sidechainState');
      sidechainPolicy = sidechainState.parseStatechainPathPolicy(raw.sidechainPolicy);
    } catch (_) {
      sidechainPolicy = null;
    }
  }
  return {
    ok: true,
    manifest: {
      version: 1,
      programId,
      programHash,
      allowedMessageTypes,
      federation,
      sidechainPolicy
    }
  };
}

/** @deprecated Use {@link parseProgramManifestV1}. */
const parseDistributedManifestV1 = parseProgramManifestV1;

module.exports = {
  parseProgramManifestV1,
  parseDistributedManifestV1
};
