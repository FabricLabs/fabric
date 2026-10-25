'use strict';

/**
 * Beacon Federation signature collection rounds + epoch signing helpers.
 *
 * When k-of-n validators are configured, epoch seals wait until a threshold
 * witness is assembled over `signingStringForBeaconEpoch(payload)`. The default
 * witness is BIP340 Schnorr. `signatureScheme: 'bls'` uses BLS12-381 bundles.
 *
 * Used by Hub Beacon and any app that seals L1-tied epochs under a Federation.
 *
 * @see docs/STATECHAIN.md
 * @see docs/PROGRAM.md
 */

const crypto = require('crypto');
const Key = require('../types/key');
const fabricCanonicalJson = require('./fabricCanonicalJson');
const bls = require('./bls');
const Federation = require('../types/federation');
const { jsonSafe } = fabricCanonicalJson;

const BEACON_EPOCH_SIGNING_KIND = 'BeaconEpoch';
const FEDERATION_SIGN_REQUEST = 'FederationSignRequest';
const FEDERATION_SIGN_RESPONSE = 'FederationSignResponse';
const PENDING_STORE_PATH = 'beacon/PENDING_EPOCH_ROUNDS';

/**
 * Deterministic epoch fields every federation validator can recompute from
 * local L1 tip + gossiped contract / sidechain digests.
 * Omits node-local wallet balance and wall-clock timestamps so independent
 * observers seal the same commitment.
 *
 * @param {object} epochPayload
 * @returns {object}
 */
function canonicalEpochForFederation (epochPayload) {
  const e = epochPayload && typeof epochPayload === 'object' ? epochPayload : {};
  const out = {
    clock: Number(e.clock) || 0,
    blockHash: e.blockHash != null ? String(e.blockHash) : null,
    height: Number(e.height) || 0
  };
  if (e.sidechain && typeof e.sidechain === 'object') {
    out.sidechain = {
      clock: Number(e.sidechain.clock) || 0,
      stateDigest: e.sidechain.stateDigest != null ? String(e.sidechain.stateDigest) : null
    };
  }
  if (e.contracts && typeof e.contracts === 'object') {
    out.contracts = {
      clock: Number(e.contracts.clock) || 0,
      stateDigest: e.contracts.stateDigest != null ? String(e.contracts.stateDigest) : null,
      kind: e.contracts.kind || 'TrackedApplicationContracts'
    };
    if (e.contracts.merkleRoot != null) {
      out.contracts.merkleRoot = String(e.contracts.merkleRoot);
    }
    if (Number.isFinite(e.contracts.acceptedCount)) {
      out.contracts.acceptedCount = Number(e.contracts.acceptedCount);
    }
  }
  return out;
}

/**
 * UTF-8 string that federation members sign for a beacon epoch.
 * Uses {@link canonicalEpochForFederation} so all validators share one digest.
 * @param {object} epochPayload
 * @returns {string}
 */
function signingStringForBeaconEpoch (epochPayload) {
  const safe = jsonSafe(canonicalEpochForFederation(epochPayload));
  return fabricCanonicalJson({
    version: 1,
    kind: BEACON_EPOCH_SIGNING_KIND,
    epoch: safe
  });
}

/**
 * SHA-256 hex digest of {@link signingStringForBeaconEpoch}.
 * @param {object} epochPayload
 * @returns {string}
 */
function epochCommitmentDigestHex (epochPayload) {
  const s = signingStringForBeaconEpoch(epochPayload);
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Verify a threshold witness over the same message buffer used when signing.
 * Missing `witness.scheme` is BIP340 Schnorr. `scheme: 'bls'` checks BLS12-381
 * bundles from {@link module:functions/bls}.
 * @param {Buffer} messageBuffer
 * @param {object} witness
 * @param {string[]} validatorPubkeys
 * @param {number} [threshold=1]
 * @param {string} [scheme] overrides `witness.scheme` when set
 * @param {Object} [opts]
 * @param {boolean} [opts.allowLegacy=true] BLS: accept legacy `v: 1` bundles (history only)
 * @returns {boolean}
 */
function verifyFederationWitnessOnMessage (messageBuffer, witness, validatorPubkeys, threshold = 1, scheme, opts = {}) {
  const resolved = bls.normalizeSignatureScheme(
    scheme != null ? scheme : (witness && witness.scheme)
  );
  if (resolved === bls.SCHEME_BLS) {
    if (!Buffer.isBuffer(messageBuffer)) return false;
    return bls.verifyFederationBlsWitness(messageBuffer, witness, validatorPubkeys, threshold, opts);
  }
  if (!witness || !witness.signatures || typeof witness.signatures !== 'object') return false;
  if (!Buffer.isBuffer(messageBuffer)) return false;
  // One count per signing key, so a repeated or respelled pubkey cannot satisfy k-of-n with one signature.
  const pubkeys = Federation.uniqueValidatorPubkeys(validatorPubkeys);
  const thr = Number(threshold);
  if (!Number.isInteger(thr) || thr < 1) return false;
  let valid = 0;
  for (const pubkey of pubkeys) {
    const sigHex = Federation.witnessSignatureFor(witness.signatures, pubkey);
    if (!sigHex || typeof sigHex !== 'string') continue;
    try {
      // BIP340 verifies over x only, so x-only validator ids verify too.
      const k = new Key({ pubkey: '02' + Federation.validatorId(pubkey) });
      const sig = Buffer.from(sigHex, 'hex');
      if (k.verifySchnorr(messageBuffer, sig)) valid++;
      if (valid >= thr) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function emptyDoc () {
  return { version: 1, rounds: {} };
}

function loadPendingDoc (fs) {
  if (!fs || typeof fs.readFile !== 'function') return emptyDoc();
  try {
    const raw = fs.readFile(PENDING_STORE_PATH);
    if (!raw) return emptyDoc();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object') return emptyDoc();
    const rounds = parsed.rounds && typeof parsed.rounds === 'object' ? parsed.rounds : {};
    return { version: 1, rounds };
  } catch (_) {
    return emptyDoc();
  }
}

/**
 * Persist pending rounds to `PENDING_STORE_PATH`; no-op without a Filesystem.
 * @private
 * @param {Object} fs Fabric Filesystem
 * @param {Object} doc `{ rounds }` keyed by commitment digest
 * @returns {Promise<void>}
 */
async function persistPendingDoc (fs, doc) {
  if (!fs || typeof fs.publish !== 'function') return;
  await fs.publish(PENDING_STORE_PATH, {
    version: 1,
    rounds: doc.rounds || {}
  });
}

/**
 * Open a pending federation signing round for one epoch.
 * @param {object} epochPayload full epoch incl. sidechain / contracts heads
 * @param {Object} [policy]
 * @param {string[]} [policy.validators] validator pubkeys (compressed or x-only hex);
 * stored normalized ({@link Federation.normalizeValidators})
 * @param {number} [policy.threshold] k (clamped to the distinct validators);
 * omitted = strict majority of the distinct validators
 * @param {string} [policy.signatureScheme] `schnorr` (default) or `bls`
 * @param {Object|null} [initialWitness] signatures already collected (`version`, `signatures`)
 * @returns {object} pending round
 */
function createRound (epochPayload, policy = {}, initialWitness = null) {
  const pol = policy && typeof policy === 'object' ? policy : {};
  const canonical = canonicalEpochForFederation(epochPayload);
  const commitmentDigest = epochCommitmentDigestHex(canonical);
  const validators = Federation.normalizeValidators(pol.validators || []);
  const threshold = Federation.resolveThreshold(pol.threshold, validators);
  const signatureScheme = bls.normalizeSignatureScheme(pol.signatureScheme);
  const round = {
    commitmentDigest,
    payload: canonical,
    validators,
    threshold,
    signatureScheme,
    witness: {
      version: 1,
      ...(signatureScheme === bls.SCHEME_BLS ? { scheme: bls.SCHEME_BLS } : {}),
      signatures: Object.assign({}, (initialWitness && initialWitness.signatures) || {})
    },
    status: 'collecting',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (roundMeetsThreshold(round)) round.status = 'ready';
  return round;
}

function messageBufferForPayload (payload) {
  return Buffer.from(signingStringForBeaconEpoch(payload), 'utf8');
}

/**
 * Whether the round's witness meets its threshold. Rounds hold new signatures,
 * so legacy BLS bundles do not count.
 * @param {object} round
 * @returns {boolean}
 */
function roundMeetsThreshold (round) {
  // Empty validator sets never meet k-of-n (fail closed — do not treat as ready).
  if (!round || !round.validators || !round.validators.length) return false;
  return verifyFederationWitnessOnMessage(
    messageBufferForPayload(round.payload),
    round.witness,
    round.validators,
    round.threshold,
    undefined,
    { allowLegacy: false }
  );
}

/**
 * Add / replace one validator signature; verify before accepting.
 * `ready` stays closed to new signatures. Callers retry durable seal via
 * `Beacon#submitFederationEpochSignature` (idempotent finalize), not here.
 * @returns {{ ok: boolean, round?: object, error?: string, sealed?: boolean }}
 */
function addSignature (round, pubkey, signatureHex) {
  if (!round || round.status === 'sealed' || round.status === 'ready') {
    return { ok: false, error: 'round not open' };
  }
  const pk = String(pubkey || '').trim();
  const scheme = bls.normalizeSignatureScheme(
    round.signatureScheme || (round.witness && round.witness.scheme)
  );
  let stored = null;
  if (scheme === bls.SCHEME_BLS) {
    if (signatureHex && typeof signatureHex === 'object') {
      stored = signatureHex;
    } else if (typeof signatureHex === 'string' && signatureHex.trim().startsWith('{')) {
      try {
        stored = JSON.parse(signatureHex);
      } catch (_) {
        stored = null;
      }
    }
    if (!pk || !stored || typeof stored !== 'object') {
      return { ok: false, error: 'pubkey and signature required' };
    }
  } else {
    const sig = String(signatureHex || '').trim();
    if (!pk || !sig) return { ok: false, error: 'pubkey and signature required' };
    stored = sig;
  }
  const member = Federation.findValidatorEntry(round.validators, pk);
  if (!member) {
    return { ok: false, error: 'pubkey not in federation validators' };
  }
  const msg = messageBufferForPayload(round.payload);
  const probe = {
    version: 1,
    ...(scheme === bls.SCHEME_BLS ? { scheme: bls.SCHEME_BLS } : {}),
    signatures: { [member]: stored }
  };
  if (!verifyFederationWitnessOnMessage(msg, probe, [member], 1, undefined, { allowLegacy: false })) {
    return {
      ok: false,
      error: scheme === bls.SCHEME_BLS ? 'invalid BLS signature' : 'invalid Schnorr signature'
    };
  }
  if (scheme === bls.SCHEME_BLS) round.witness.scheme = bls.SCHEME_BLS;
  // One entry per signing key, under the listed spelling.
  for (const k of Object.keys(round.witness.signatures)) {
    if (k !== member && Federation.validatorId(k) === Federation.validatorId(member)) {
      delete round.witness.signatures[k];
    }
  }
  round.witness.signatures[member] = stored;
  round.updatedAt = new Date().toISOString();
  const sealed = roundMeetsThreshold(round);
  if (sealed) round.status = 'ready';
  return { ok: true, round, sealed };
}

function encodeSignRequest (round) {
  return {
    type: FEDERATION_SIGN_REQUEST,
    version: 1,
    commitmentDigest: round.commitmentDigest,
    epoch: round.payload,
    validators: round.validators.slice(),
    threshold: round.threshold,
    signatureScheme: bls.normalizeSignatureScheme(round.signatureScheme),
    createdAt: round.createdAt
  };
}

function encodeSignResponse (commitmentDigest, pubkey, signatureHex) {
  const signature = signatureHex && typeof signatureHex === 'object'
    ? JSON.stringify(signatureHex)
    : String(signatureHex);
  return {
    type: FEDERATION_SIGN_RESPONSE,
    version: 1,
    commitmentDigest: String(commitmentDigest),
    pubkey: String(pubkey),
    signature
  };
}

function parseSignResponse (body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body required' };
  if (body.type && body.type !== FEDERATION_SIGN_RESPONSE) {
    return { ok: false, error: 'not a FederationSignResponse' };
  }
  const commitmentDigest = body.commitmentDigest != null ? String(body.commitmentDigest) : '';
  const pubkey = body.pubkey != null ? String(body.pubkey) : '';
  const signature = body.signature != null ? String(body.signature) : '';
  if (!commitmentDigest || !pubkey || !signature) {
    return { ok: false, error: 'commitmentDigest, pubkey, signature required' };
  }
  return { ok: true, commitmentDigest, pubkey, signature };
}

module.exports = {
  BEACON_EPOCH_SIGNING_KIND,
  FEDERATION_SIGN_REQUEST,
  FEDERATION_SIGN_RESPONSE,
  PENDING_STORE_PATH,
  canonicalEpochForFederation,
  signingStringForBeaconEpoch,
  epochCommitmentDigestHex,
  verifyFederationWitnessOnMessage,
  loadPendingDoc,
  persistPendingDoc,
  createRound,
  roundMeetsThreshold,
  addSignature,
  encodeSignRequest,
  encodeSignResponse,
  parseSignResponse,
  messageBufferForPayload
};
