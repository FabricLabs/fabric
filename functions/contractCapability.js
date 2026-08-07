'use strict';

/**
 * Contract-scoped Token capabilities (read-only member vs signer).
 */

const Key = require('../types/key');
const Token = require('../types/token');

const OP_CONTRACT_READ = 'OP_CONTRACT_READ';
const OP_CONTRACT_SIGN = 'OP_CONTRACT_SIGN';

/**
 * @param {object} opts
 * @param {object|Key} opts.issuerKey Fabric Key (or settings) of issuer
 * @param {string} opts.subject Subject compressed pubkey
 * @param {string} opts.contractId Contract / namespace id
 * @param {string} [opts.capability=OP_CONTRACT_READ]
 * @param {number} [opts.expiresInSeconds]
 * @returns {string} Token.toSignedString()
 */
function issueContractCapability (opts = {}) {
  const capability = opts.capability || OP_CONTRACT_READ;
  if (capability !== OP_CONTRACT_READ && capability !== OP_CONTRACT_SIGN) {
    throw new Error(`unsupported contract capability: ${capability}`);
  }
  const contractId = String(opts.contractId || '').trim().toLowerCase();
  if (!contractId) throw new Error('contractId required');
  const subject = String(opts.subject || '').trim().toLowerCase();
  if (!subject) throw new Error('subject required');
  const issuer = opts.issuerKey && typeof opts.issuerKey.sign === 'function'
    ? opts.issuerKey
    : new Key(opts.issuerKey || {});
  const token = new Token({
    capability,
    issuer,
    subject,
    ctx: { contractId }
  });
  return token.toSignedString({
    expiresInSeconds: opts.expiresInSeconds,
    ctx: { contractId }
  });
}

/**
 * @param {string} tokenString
 * @param {object} expect
 * @param {string} expect.contractId
 * @param {string} [expect.expectedCap]
 * @param {string} [expect.subject]
 * @param {Key|object} [expect.issuerKey] Verify Schnorr against this key (auth path)
 * @param {boolean} [expect.allowUnverified] Opt-in parse-only (no sig check); result has verified:false
 * @returns {{ cap: string, iss: string, sub: string, iat: number, exp: number, ctx?: object, verified?: boolean }|null}
 */
function verifyContractCapability (tokenString, expect = {}) {
  const contractId = String(expect.contractId || '').trim().toLowerCase();
  if (!contractId) return null;
  let payload = null;
  let verified = false;
  if (expect.issuerKey) {
    const key = expect.issuerKey && typeof expect.issuerKey.verify === 'function'
      ? expect.issuerKey
      : new Key(expect.issuerKey);
    payload = Token.verifySigned(tokenString, key);
    verified = !!payload;
  } else if (expect.allowUnverified === true) {
    // Parse-only: not authorization. Callers must not treat this as a verified grant.
    if (!tokenString || typeof tokenString !== 'string') return null;
    const parts = tokenString.split('.');
    if (parts.length !== 2) return null;
    try {
      const { tryParseWireJson } = require('./wireJson');
      const payloadStr = Token.base64UrlDecode(parts[0]);
      const pr = tryParseWireJson(payloadStr);
      if (!pr.ok) return null;
      payload = pr.value;
      if (!payload || payload.exp == null || Date.now() / 1000 > payload.exp) return null;
      verified = false;
    } catch (_) {
      return null;
    }
  } else {
    return null;
  }
  if (!payload) return null;
  const ctxId = payload.ctx && payload.ctx.contractId
    ? String(payload.ctx.contractId).trim().toLowerCase()
    : '';
  if (ctxId !== contractId) return null;
  if (expect.expectedCap && payload.cap !== expect.expectedCap) return null;
  if (expect.subject) {
    const sub = String(payload.sub || '').trim().toLowerCase();
    if (sub !== String(expect.subject).trim().toLowerCase()) return null;
  }
  return Object.assign({}, payload, { verified });
}

function roleToCapability (role) {
  const r = String(role || '').toLowerCase();
  if (r === 'signer' || r === 'sign') return OP_CONTRACT_SIGN;
  return OP_CONTRACT_READ;
}

function capabilityToRole (cap) {
  if (cap === OP_CONTRACT_SIGN) return 'signer';
  if (cap === OP_CONTRACT_READ) return 'reader';
  return null;
}

module.exports = {
  OP_CONTRACT_READ,
  OP_CONTRACT_SIGN,
  issueContractCapability,
  verifyContractCapability,
  roleToCapability,
  capabilityToRole
};
