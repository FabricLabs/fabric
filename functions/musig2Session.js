/**
 * Interactive BIP-327 MuSig2 session machine for `P2P_MUSIG_*` opcodes.
 *
 * Directed n-of-n only. Callers recompute KeyAgg / aggnonce locally and bind
 * each contribution to the AMP signer. Secret nonces never leave this module
 * except on the session object held by {@link Peer}; {@link module:functions/musig2.sign}
 * zeros `secnonce` after use.
 *
 * @fileoverview BIP-327 MuSig2 P2P session state machine.
 * @module functions/musig2Session
 */
'use strict';

const crypto = require('crypto');
const {
  individualPk,
  keySort,
  keyAgg,
  getXonlyPk,
  nonceGen,
  nonceAgg,
  sessionContext,
  sign,
  partialSigVerify,
  partialSigAgg,
  verifyAggregatedSchnorr
} = require('./musig2');

const MUSIG_MAX_SIGNERS = 16;
const MUSIG_MAX_MSG_BYTES = 4096;
const MUSIG_PUBNONCE_BYTES = 66;
const MUSIG_PSIG_BYTES = 32;
const MUSIG_SIG_BYTES = 64;
const MUSIG_PK_BYTES = 33;

/**
 * @param {Buffer|Uint8Array|string} input
 * @returns {Buffer}
 * @private
 */
function asBuf (input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') {
    const hex = String(input).trim().replace(/^0x/i, '');
    if (hex.length % 2) throw new TypeError('odd hex length');
    if (!/^[0-9a-f]*$/i.test(hex)) throw new TypeError('expected hex');
    return Buffer.from(hex, 'hex');
  }
  throw new TypeError('expected Buffer, Uint8Array, or hex');
}

/**
 * @param {*} input
 * @param {number} len
 * @returns {Buffer|null}
 * @private
 */
function exactBuf (input, len) {
  try {
    const b = asBuf(input);
    return b.length === len ? b : null;
  } catch {
    return null;
  }
}

/**
 * Application message → 32-byte MuSig2 challenge (SHA-256 unless already 32).
 *
 * @param {Buffer|string} msg
 * @returns {Buffer}
 */
function challengeMessage (msg) {
  let raw;
  if (Buffer.isBuffer(msg) || msg instanceof Uint8Array) {
    raw = Buffer.from(msg);
  } else if (typeof msg === 'string') {
    const trimmed = msg.trim().replace(/^0x/i, '');
    if (/^[0-9a-f]*$/i.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length > 0) {
      raw = Buffer.from(trimmed, 'hex');
    } else {
      raw = Buffer.from(msg, 'utf8');
    }
  } else {
    throw new TypeError('msg required');
  }
  if (raw.length === 32) return Buffer.from(raw);
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * @param {Buffer|string} pk compressed or x-only
 * @returns {string} 64-char x-only hex
 */
function xOnlyHex (pk) {
  const b = asBuf(pk);
  if (b.length === 32) return b.toString('hex');
  if (b.length === 33) return b.subarray(1, 33).toString('hex');
  throw new TypeError('pubkey must be 32 or 33 bytes');
}

/**
 * @param {Array<Buffer|string>} pubkeys
 * @returns {Buffer} concatenated compressed keys
 */
function packPubkeys (pubkeys) {
  const keys = normalizePubkeys(pubkeys);
  return Buffer.concat(keys);
}

/**
 * @param {Buffer|string} packed
 * @returns {Buffer[]}
 */
function unpackPubkeys (packed) {
  const buf = asBuf(packed);
  if (!buf.length || buf.length % MUSIG_PK_BYTES !== 0) {
    throw new TypeError('packed pubkeys must be n×33 bytes');
  }
  const out = [];
  for (let i = 0; i < buf.length; i += MUSIG_PK_BYTES) {
    out.push(Buffer.from(buf.subarray(i, i + MUSIG_PK_BYTES)));
  }
  return out;
}

/**
 * @param {Array<Buffer|string>|Buffer|string} pubkeys
 * @returns {Buffer[]}
 * @private
 */
function normalizePubkeys (pubkeys) {
  let list;
  if (Buffer.isBuffer(pubkeys) || typeof pubkeys === 'string' || pubkeys instanceof Uint8Array) {
    list = unpackPubkeys(pubkeys);
  } else if (Array.isArray(pubkeys)) {
    list = pubkeys.map((pk) => {
      const b = asBuf(pk);
      if (b.length !== MUSIG_PK_BYTES) throw new TypeError('each pubkey must be 33 bytes');
      return Buffer.from(b);
    });
  } else {
    throw new TypeError('pubkeys required');
  }
  if (list.length < 2 || list.length > MUSIG_MAX_SIGNERS) {
    throw new TypeError(`MuSig2 needs 2–${MUSIG_MAX_SIGNERS} signers`);
  }
  return keySort(list);
}

/**
 * @param {Array<Buffer>} pubkeys
 * @param {string} signerXOnly
 * @returns {number}
 */
function signerIndex (pubkeys, signerXOnly) {
  const want = String(signerXOnly || '').toLowerCase();
  for (let i = 0; i < pubkeys.length; i++) {
    if (xOnlyHex(pubkeys[i]) === want) return i;
  }
  return -1;
}

/**
 * @param {object} body START/ACCEPT/… JSON or field map
 * @returns {object|null}
 */
function parseMusigBody (body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const sessionId = exactBuf(body.sessionId, 32);
  if (!sessionId) return null;
  const out = { sessionId };
  if (body.msg != null) {
    try {
      if (Buffer.isBuffer(body.msg) || body.msg instanceof Uint8Array) {
        out.msg = Buffer.from(body.msg);
      } else if (typeof body.msg === 'string') {
        const trimmed = body.msg.trim().replace(/^0x/i, '');
        if (/^[0-9a-f]*$/i.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length >= 2) {
          out.msg = Buffer.from(trimmed, 'hex');
        } else {
          out.msg = Buffer.from(body.msg, 'utf8');
        }
      }
    } catch {
      return null;
    }
  }
  if (body.pubkeys != null) {
    try {
      out.pubkeys = Array.isArray(body.pubkeys)
        ? normalizePubkeys(body.pubkeys)
        : unpackPubkeys(body.pubkeys);
    } catch {
      return null;
    }
  }
  if (body.pubnonce != null) {
    out.pubnonce = exactBuf(body.pubnonce, MUSIG_PUBNONCE_BYTES);
    if (!out.pubnonce) return null;
  }
  if (body.aggnonce != null) {
    out.aggnonce = exactBuf(body.aggnonce, MUSIG_PUBNONCE_BYTES);
    if (!out.aggnonce) return null;
  }
  if (body.psig != null) {
    out.psig = exactBuf(body.psig, MUSIG_PSIG_BYTES);
    if (!out.psig) return null;
  }
  if (body.signature != null) {
    out.signature = exactBuf(body.signature, MUSIG_SIG_BYTES);
    if (!out.signature) return null;
  }
  if (body.purpose != null) out.purpose = String(body.purpose);
  return out;
}

/**
 * @param {Buffer} sk
 * @returns {Buffer}
 * @private
 */
function localPk (sk) {
  return individualPk(sk);
}

/**
 * @param {object} opts
 * @param {Buffer|string} [opts.sessionId]
 * @param {Buffer|string} opts.msg
 * @param {Array<Buffer|string>|Buffer} opts.pubkeys
 * @param {Buffer} opts.sk
 * @param {string} [opts.purpose]
 * @returns {object}
 */
function createLocalSession (opts = {}) {
  const sk = asBuf(opts.sk);
  if (sk.length !== 32) throw new TypeError('sk must be 32 bytes');
  const pubkeys = normalizePubkeys(opts.pubkeys);
  const pk = localPk(sk);
  const localIndex = signerIndex(pubkeys, xOnlyHex(pk));
  if (localIndex < 0) throw new Error('local key is not a session participant');
  let rawMsg;
  if (Buffer.isBuffer(opts.msg) || opts.msg instanceof Uint8Array) {
    rawMsg = Buffer.from(opts.msg);
  } else if (typeof opts.msg === 'string') {
    rawMsg = Buffer.from(opts.msg, 'utf8');
  } else {
    throw new TypeError('msg required');
  }
  if (rawMsg.length > MUSIG_MAX_MSG_BYTES) throw new TypeError('msg too large');
  const sessionId = opts.sessionId ? exactBuf(opts.sessionId, 32) : crypto.randomBytes(32);
  if (!sessionId) throw new TypeError('sessionId must be 32 bytes');
  const challenge = challengeMessage(rawMsg);
  const aggpk = getXonlyPk(keyAgg(pubkeys));
  const { secnonce, pubnonce } = nonceGen(sk, pk, aggpk, challenge, sessionId);
  const n = pubkeys.length;
  const session = {
    sessionId,
    rawMsg,
    challenge,
    purpose: opts.purpose != null ? String(opts.purpose) : '',
    pubkeys,
    localIndex,
    initiator: opts.initiator !== false,
    initiatorIndex: opts.initiator !== false
      ? localIndex
      : (Number.isInteger(opts.initiatorIndex) ? opts.initiatorIndex : -1),
    pubnonces: new Array(n).fill(null),
    psigs: new Array(n).fill(null),
    secnonce,
    ownPubnonce: Buffer.from(pubnonce),
    aggnonce: null,
    signature: null,
    createdAt: Date.now()
  };
  session.pubnonces[localIndex] = Buffer.from(pubnonce);
  return session;
}

/**
 * Co-signer intake of `P2P_MUSIG_START`.
 *
 * @param {object} body parsed START fields
 * @param {object} opts
 * @param {Buffer} opts.sk
 * @param {string} opts.signerXOnly AMP author of START
 * @returns {{ ok: true, session: object }|{ ok: false, reason: string }}
 */
function createFromStart (body, opts = {}) {
  const parsed = parseMusigBody(body);
  if (!parsed || !parsed.sessionId || !parsed.msg || !parsed.pubkeys || !parsed.pubnonce) {
    return { ok: false, reason: 'invalid-start' };
  }
  if (parsed.msg.length > MUSIG_MAX_MSG_BYTES) return { ok: false, reason: 'msg-too-large' };
  let pubkeys;
  try {
    pubkeys = normalizePubkeys(parsed.pubkeys);
  } catch (err) {
    return { ok: false, reason: err.message || 'bad-pubkeys' };
  }
  const signerXOnly = String(opts.signerXOnly || '').toLowerCase();
  const authorIndex = signerIndex(pubkeys, signerXOnly);
  if (authorIndex < 0) return { ok: false, reason: 'signer-not-participant' };
  let sk;
  try {
    sk = asBuf(opts.sk);
  } catch {
    return { ok: false, reason: 'missing-sk' };
  }
  if (sk.length !== 32) return { ok: false, reason: 'missing-sk' };
  const localIndex = signerIndex(pubkeys, xOnlyHex(localPk(sk)));
  if (localIndex < 0) return { ok: false, reason: 'not-participant' };
  if (localIndex === authorIndex) return { ok: false, reason: 'self-start' };
  let session;
  try {
    session = createLocalSession({
      sessionId: parsed.sessionId,
      msg: parsed.msg,
      pubkeys,
      sk,
      purpose: parsed.purpose || '',
      initiator: false
    });
  } catch (err) {
    return { ok: false, reason: err.message || 'start-failed' };
  }
    session.rawMsg = Buffer.from(parsed.msg);
    session.challenge = challengeMessage(parsed.msg);
    session.initiatorIndex = authorIndex;
  const rec = recordPubnonce(session, signerXOnly, parsed.pubnonce);
  if (!rec.ok) {
    wipeSession(session);
    return rec;
  }
  return { ok: true, session };
}

/**
 * @param {object} session
 * @param {string} signerXOnly
 * @param {Buffer|string} pubnonce
 * @returns {{ ok: boolean, reason?: string }}
 */
function recordPubnonce (session, signerXOnly, pubnonce) {
  if (!session) return { ok: false, reason: 'no-session' };
  const i = signerIndex(session.pubkeys, signerXOnly);
  if (i < 0) return { ok: false, reason: 'signer-not-participant' };
  const pn = exactBuf(pubnonce, MUSIG_PUBNONCE_BYTES);
  if (!pn) return { ok: false, reason: 'bad-pubnonce' };
  const prev = session.pubnonces[i];
  if (prev && !prev.equals(pn)) return { ok: false, reason: 'pubnonce-mismatch' };
  session.pubnonces[i] = Buffer.from(pn);
  return { ok: true };
}

/**
 * @param {object} session
 * @returns {boolean}
 */
function allPubnoncesPresent (session) {
  return !!(session && session.pubnonces && session.pubnonces.every((p) => Buffer.isBuffer(p)));
}

/**
 * @param {object} session
 * @returns {Buffer|null}
 */
function computeAggNonce (session) {
  if (!allPubnoncesPresent(session)) return null;
  return nonceAgg(session.pubnonces);
}

/**
 * Recompute aggnonce; reject a claimed value that does not match.
 *
 * @param {object} session
 * @param {Buffer|string} claimed
 * @returns {{ ok: boolean, reason?: string, aggnonce?: Buffer }}
 */
function setAggNonce (session, claimed) {
  const local = computeAggNonce(session);
  if (!local) return { ok: false, reason: 'incomplete-nonces' };
  const remote = exactBuf(claimed, MUSIG_PUBNONCE_BYTES);
  if (!remote) return { ok: false, reason: 'bad-aggnonce' };
  if (!local.equals(remote)) return { ok: false, reason: 'aggnonce-mismatch' };
  session.aggnonce = Buffer.from(local);
  return { ok: true, aggnonce: session.aggnonce };
}

/**
 * @param {object} session
 * @returns {object}
 * @private
 */
function sessionCtxFor (session) {
  return sessionContext(session.aggnonce, session.pubkeys, [], [], session.challenge);
}

/**
 * Produce a partial signature. Zeros `session.secnonce`.
 *
 * @param {object} session
 * @param {Buffer} sk
 * @returns {{ ok: true, psig: Buffer }|{ ok: false, reason: string }}
 */
function createPartial (session, sk) {
  if (!session || !session.aggnonce) return { ok: false, reason: 'no-aggnonce' };
  if (!session.secnonce || !Buffer.isBuffer(session.secnonce)) {
    return { ok: false, reason: 'no-secnonce' };
  }
  try {
    const psig = sign(session.secnonce, asBuf(sk), sessionCtxFor(session));
    session.psigs[session.localIndex] = Buffer.from(psig);
    wipeSession(session);
    return { ok: true, psig };
  } catch (err) {
    wipeSession(session);
    return { ok: false, reason: err.message || 'sign-failed' };
  }
}

/**
 * @param {object} session
 * @param {string} signerXOnly
 * @param {Buffer|string} psig
 * @returns {{ ok: boolean, reason?: string }}
 */
function recordPartial (session, signerXOnly, psig) {
  if (!session || !session.aggnonce) return { ok: false, reason: 'no-aggnonce' };
  const i = signerIndex(session.pubkeys, signerXOnly);
  if (i < 0) return { ok: false, reason: 'signer-not-participant' };
  const s = exactBuf(psig, MUSIG_PSIG_BYTES);
  if (!s) return { ok: false, reason: 'bad-psig' };
  const prev = session.psigs[i];
  if (prev && !prev.equals(s)) return { ok: false, reason: 'psig-mismatch' };
  if (!session.pubnonces[i]) return { ok: false, reason: 'missing-pubnonce' };
  let ok = false;
  try {
    ok = partialSigVerify(
      s, session.pubnonces, session.pubkeys, [], [], session.challenge, i);
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, reason: 'psig-invalid' };
  session.psigs[i] = Buffer.from(s);
  return { ok: true };
}

/**
 * @param {object} session
 * @returns {boolean}
 */
function allPartialsPresent (session) {
  return !!(session && session.psigs && session.psigs.every((p) => Buffer.isBuffer(p)));
}

/**
 * @param {object} session
 * @returns {{ ok: true, signature: Buffer }|{ ok: false, reason: string }}
 */
function aggregatePartials (session) {
  if (!allPartialsPresent(session)) return { ok: false, reason: 'incomplete-psigs' };
  try {
    const signature = partialSigAgg(session.psigs, sessionCtxFor(session));
    if (!verifyAggregatedSchnorr(session.challenge, signature, session.pubkeys)) {
      wipeSession(session);
      return { ok: false, reason: 'agg-verify-failed' };
    }
    session.signature = Buffer.from(signature);
    wipeSession(session);
    return { ok: true, signature: session.signature };
  } catch (err) {
    wipeSession(session);
    return { ok: false, reason: err.message || 'agg-failed' };
  }
}

/**
 * @param {object} session
 * @param {Buffer|string} signature
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyFinalSignature (session, signature) {
  if (!session || !session.pubkeys || !session.challenge) {
    return { ok: false, reason: 'no-session' };
  }
  const sig = exactBuf(signature, MUSIG_SIG_BYTES);
  if (!sig) return { ok: false, reason: 'bad-signature' };
  if (!verifyAggregatedSchnorr(session.challenge, sig, session.pubkeys)) {
    return { ok: false, reason: 'sig-invalid' };
  }
  session.signature = Buffer.from(sig);
  wipeSession(session);
  return { ok: true };
}

/**
 * Zero secret nonce material. Safe to call more than once.
 *
 * @param {object} session
 */
function wipeSession (session) {
  if (!session) return;
  if (Buffer.isBuffer(session.secnonce)) session.secnonce.fill(0);
  session.secnonce = null;
}

/**
 * Public view (no secnonce).
 *
 * @param {object} session
 * @returns {object|null}
 */
function sessionPublicView (session) {
  if (!session) return null;
  return {
    sessionId: Buffer.from(session.sessionId).toString('hex'),
    purpose: session.purpose || '',
    n: session.pubkeys.length,
    initiator: !!session.initiator,
    pubnonceCount: session.pubnonces.filter(Boolean).length,
    psigCount: session.psigs.filter(Boolean).length,
    hasAggNonce: Buffer.isBuffer(session.aggnonce),
    signature: session.signature ? Buffer.from(session.signature).toString('hex') : null
  };
}

/**
 * START fields for {@link Message.fromFields}.
 *
 * @param {object} session
 * @returns {object}
 */
function startFields (session) {
  return {
    sessionId: session.sessionId,
    msg: session.rawMsg,
    pubkeys: packPubkeys(session.pubkeys),
    pubnonce: session.ownPubnonce,
    purpose: session.purpose || ''
  };
}

module.exports = {
  MUSIG_MAX_SIGNERS,
  MUSIG_MAX_MSG_BYTES,
  MUSIG_PUBNONCE_BYTES,
  packPubkeys,
  unpackPubkeys,
  challengeMessage,
  xOnlyHex,
  signerIndex,
  parseMusigBody,
  createLocalSession,
  createFromStart,
  recordPubnonce,
  allPubnoncesPresent,
  computeAggNonce,
  setAggNonce,
  createPartial,
  recordPartial,
  allPartialsPresent,
  aggregatePartials,
  verifyFinalSignature,
  wipeSession,
  sessionPublicView,
  startFields
};
