'use strict';

/**
 * Beacon Federation signature collection rounds + epoch signing helpers.
 *
 * When k-of-n validators are configured, epoch seals wait until a threshold
 * Schnorr witness is assembled over `signingStringForBeaconEpoch(payload)`.
 *
 * Used by Hub Beacon and any app that seals L1-tied epochs under a Federation.
 *
 * @see docs/STATECHAIN.md
 * @see docs/PROGRAM.md
 */

const crypto = require('crypto');
const Key = require('../types/key');
const fabricCanonicalJson = require('./fabricCanonicalJson');
const { jsonSafe } = fabricCanonicalJson;

const BEACON_EPOCH_SIGNING_KIND = 'BeaconEpoch';
const FEDERATION_SIGN_REQUEST = 'FederationSignRequest';
const FEDERATION_SIGN_RESPONSE = 'FederationSignResponse';
const PENDING_STORE_PATH = 'beacon/PENDING_EPOCH_ROUNDS';

/**
 * UTF-8 string that federation members sign for a beacon epoch.
 * @param {object} epochPayload
 * @returns {string}
 */
function signingStringForBeaconEpoch (epochPayload) {
  const safe = jsonSafe(epochPayload);
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
 * Verify threshold Schnorr signatures over the same message buffer used when signing.
 * @param {Buffer} messageBuffer
 * @param {object} witness
 * @param {string[]} validatorPubkeys
 * @param {number} [threshold=1]
 * @returns {boolean}
 */
function verifyFederationWitnessOnMessage (messageBuffer, witness, validatorPubkeys, threshold = 1) {
  if (!witness || !witness.signatures || typeof witness.signatures !== 'object') return false;
  if (!Buffer.isBuffer(messageBuffer)) return false;
  // Deduplicate so a repeated pubkey cannot satisfy k-of-n with one signature.
  const pubkeys = Array.from(new Set(
    (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])
      .filter((p) => typeof p === 'string' && p)
  ));
  const thr = Math.max(1, Number(threshold) || 1);
  let valid = 0;
  for (const pubkey of pubkeys) {
    const sigHex = witness.signatures[pubkey];
    if (!sigHex || typeof sigHex !== 'string') continue;
    try {
      const k = new Key({ pubkey });
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

async function persistPendingDoc (fs, doc) {
  if (!fs || typeof fs.publish !== 'function') return;
  await fs.publish(PENDING_STORE_PATH, {
    version: 1,
    rounds: doc.rounds || {}
  });
}

/**
 * @param {object} epochPayload full epoch incl. sidechain / contracts heads
 * @param {{ validators?: string[], threshold?: number }} [policy]
 * @param {{ version?: number, signatures?: object }|null} [initialWitness]
 * @returns {object} pending round
 */
function createRound (epochPayload, policy = {}, initialWitness = null) {
  const pol = policy && typeof policy === 'object' ? policy : {};
  const commitmentDigest = epochCommitmentDigestHex(epochPayload);
  const validators = (pol.validators || []).map((v) => String(v).trim()).filter(Boolean);
  const threshold = Math.max(1, Number(pol.threshold) || 1);
  return {
    commitmentDigest,
    payload: epochPayload,
    validators,
    threshold: Math.min(threshold, validators.length || threshold),
    witness: {
      version: 1,
      signatures: Object.assign({}, (initialWitness && initialWitness.signatures) || {})
    },
    status: 'collecting',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function messageBufferForPayload (payload) {
  return Buffer.from(signingStringForBeaconEpoch(payload), 'utf8');
}

/**
 * @param {object} round
 * @returns {boolean}
 */
function roundMeetsThreshold (round) {
  if (!round || !round.validators || !round.validators.length) return true;
  return verifyFederationWitnessOnMessage(
    messageBufferForPayload(round.payload),
    round.witness,
    round.validators,
    round.threshold
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
  const sig = String(signatureHex || '').trim();
  if (!pk || !sig) return { ok: false, error: 'pubkey and signature required' };
  if (!round.validators.includes(pk)) {
    return { ok: false, error: 'pubkey not in federation validators' };
  }
  const msg = messageBufferForPayload(round.payload);
  const probe = { version: 1, signatures: { [pk]: sig } };
  if (!verifyFederationWitnessOnMessage(msg, probe, [pk], 1)) {
    return { ok: false, error: 'invalid Schnorr signature' };
  }
  round.witness.signatures[pk] = sig;
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
    createdAt: round.createdAt
  };
}

function encodeSignResponse (commitmentDigest, pubkey, signatureHex) {
  return {
    type: FEDERATION_SIGN_RESPONSE,
    version: 1,
    commitmentDigest: String(commitmentDigest),
    pubkey: String(pubkey),
    signature: String(signatureHex)
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
