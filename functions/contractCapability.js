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
 * @param {Key|object} [expect.issuerKey] If set, verify Schnorr against this key
 * @returns {{ cap: string, iss: string, sub: string, iat: number, exp: number, ctx?: object }|null}
 */
function verifyContractCapability (tokenString, expect = {}) {
  const contractId = String(expect.contractId || '').trim().toLowerCase();
  if (!contractId) return null;
  let payload = null;
  if (expect.issuerKey) {
    const key = expect.issuerKey && typeof expect.issuerKey.verify === 'function'
      ? expect.issuerKey
      : new Key(expect.issuerKey);
    payload = Token.verifySigned(tokenString, key);
  } else {
    // Parse without issuer check (caller may only need shape); still require sig format.
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
    } catch (_) {
      return null;
    }
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
  return payload;
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
