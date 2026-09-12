'use strict';

/**
 * Explicit-amount federation reserve ledger (F0 — no blinded amounts).
 *
 * Sidechain content lives under `/federationReserve`. Conservation:
 *   outstandingSats + pendingBurnsSats <= vaultConfirmedSats
 * (operators supply vaultConfirmedSats from L1; credits require matured deposits).
 *
 * @fileoverview Federation reserve ledger for peg-in / peg-out.
 * @module functions/federationReserveLedger
 */

const RESERVE_KEY = 'federationReserve';
const DUST_SATS = 546;

/**
 * @typedef {object} FederationReserveDeposit
 * @property {string} txid
 * @property {number} vout
 * @property {number} amountSats
 * @property {number} confirmations
 * @property {string} [creditedAt]
 */

/**
 * @typedef {object} FederationReserveWithdrawal
 * @property {string} requestId
 * @property {number} amountSats
 * @property {string} destinationAddress
 * @property {string} [burnedAt]
 * @property {string} [status]
 */

/**
 * @typedef {object} FederationReserveState
 * @property {number} outstandingSats
 * @property {number} creditedSats
 * @property {number} burnedSats
 * @property {number} pendingBurnsSats
 * @property {number} vaultConfirmedSats
 * @property {FederationReserveDeposit[]} deposits
 * @property {FederationReserveWithdrawal[]} withdrawals
 */

/** @returns {FederationReserveState} */
function emptyReserve () {
  return {
    outstandingSats: 0,
    creditedSats: 0,
    burnedSats: 0,
    pendingBurnsSats: 0,
    vaultConfirmedSats: 0,
    deposits: [],
    withdrawals: []
  };
}

/**
 * @param {object} content Sidechain content object
 * @returns {FederationReserveState}
 */
function readReserve (content) {
  const raw = content && typeof content === 'object' ? content[RESERVE_KEY] : null;
  if (!raw || typeof raw !== 'object') return emptyReserve();
  return {
    outstandingSats: Math.max(0, Math.round(Number(raw.outstandingSats) || 0)),
    creditedSats: Math.max(0, Math.round(Number(raw.creditedSats) || 0)),
    burnedSats: Math.max(0, Math.round(Number(raw.burnedSats) || 0)),
    pendingBurnsSats: Math.max(0, Math.round(Number(raw.pendingBurnsSats) || 0)),
    vaultConfirmedSats: Math.max(0, Math.round(Number(raw.vaultConfirmedSats) || 0)),
    deposits: Array.isArray(raw.deposits) ? raw.deposits.slice() : [],
    withdrawals: Array.isArray(raw.withdrawals) ? raw.withdrawals.slice() : []
  };
}

/**
 * @param {FederationReserveState} reserve
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function assertConservation (reserve) {
  const r = reserve && typeof reserve === 'object' ? reserve : emptyReserve();
  const outstanding = Math.max(0, Math.round(Number(r.outstandingSats) || 0));
  const pending = Math.max(0, Math.round(Number(r.pendingBurnsSats) || 0));
  const vault = Math.max(0, Math.round(Number(r.vaultConfirmedSats) || 0));
  if (outstanding + pending > vault) {
    return {
      ok: false,
      error: `conservation violated: outstanding(${outstanding})+pendingBurns(${pending}) > vaultConfirmed(${vault})`
    };
  }
  return { ok: true };
}

/**
 * Deposit outpoint key.
 * @param {string} txid
 * @param {number} vout
 * @returns {string}
 */
function depositKey (txid, vout) {
  return `${String(txid || '').trim().toLowerCase()}:${Number(vout)}`;
}

/**
 * Credit peg-in after L1 maturity.
 * @param {object} content
 * @param {object} proof
 * @param {string} proof.txid
 * @param {number} proof.vout
 * @param {number} proof.amountSats
 * @param {number} proof.confirmations
 * @param {Object} [opts]
 * @param {number} [opts.depositMaturityBlocks=144]
 * @param {number} opts.vaultConfirmedSats Verified L1 vault total (required — never invent from proof)
 * @returns {{ ok: true, content: object, reserve: FederationReserveState }|{ ok: false, error: string }}
 */
function applyPegInCredit (content, proof = {}, opts = {}) {
  const maturity = Math.max(1, Number(opts.depositMaturityBlocks) || 144);
  const txid = String(proof.txid || '').trim().toLowerCase();
  const vout = Number(proof.vout);
  const amountSats = Math.round(Number(proof.amountSats));
  const confirmations = Math.round(Number(proof.confirmations));

  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return { ok: false, error: 'txid required (64-hex)' };
  }
  if (!Number.isInteger(vout) || vout < 0) {
    return { ok: false, error: 'vout required (non-negative integer)' };
  }
  if (!Number.isInteger(amountSats) || amountSats < DUST_SATS) {
    return { ok: false, error: `amountSats required (integer >= ${DUST_SATS})` };
  }
  if (!Number.isInteger(confirmations) || confirmations < maturity) {
    return {
      ok: false,
      error: `deposit not mature (need >= ${maturity} confirmations, have ${confirmations})`
    };
  }

  const nextContent = Object.assign({}, content && typeof content === 'object' ? content : {});
  const reserve = readReserve(nextContent);
  const key = depositKey(txid, vout);
  if (reserve.deposits.some((d) => depositKey(d.txid, d.vout) === key)) {
    return { ok: false, error: 'deposit already credited' };
  }

  if (opts.vaultConfirmedSats != null) {
    const v = Math.round(Number(opts.vaultConfirmedSats));
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: 'vaultConfirmedSats invalid' };
    }
    reserve.vaultConfirmedSats = v;
  } else {
    return {
      ok: false,
      error: 'vaultConfirmedSats required (verified L1 vault total; do not invent from deposit proof)'
    };
  }

  reserve.deposits.push({
    txid,
    vout,
    amountSats,
    confirmations,
    creditedAt: opts.creditedAt || new Date().toISOString()
  });
  reserve.creditedSats += amountSats;
  reserve.outstandingSats += amountSats;

  const cons = assertConservation(reserve);
  if (!cons.ok) return cons;

  nextContent[RESERVE_KEY] = reserve;
  return { ok: true, content: nextContent, reserve };
}

/**
 * Burn peg-out claims before L1 vault payout (binds to withdrawal requestId).
 * @param {object} content
 * @param {object} withdrawal
 * @param {string} withdrawal.requestId
 * @param {number} withdrawal.amountSats
 * @param {string} withdrawal.destinationAddress
 * @param {Object} [opts]
 * @param {number} [opts.vaultConfirmedSats]
 * @returns {{ ok: true, content: object, reserve: FederationReserveState }|{ ok: false, error: string }}
 */
function applyPegOutBurn (content, withdrawal = {}, opts = {}) {
  const requestId = String(withdrawal.requestId || '').trim().toLowerCase();
  const amountSats = Math.round(Number(withdrawal.amountSats));
  const destinationAddress = String(withdrawal.destinationAddress || '').trim();

  if (!/^[0-9a-f]{64}$/.test(requestId)) {
    return { ok: false, error: 'requestId required (64-hex)' };
  }
  if (!Number.isInteger(amountSats) || amountSats < DUST_SATS) {
    return { ok: false, error: `amountSats required (integer >= ${DUST_SATS})` };
  }
  if (!destinationAddress) {
    return { ok: false, error: 'destinationAddress required' };
  }

  const nextContent = Object.assign({}, content && typeof content === 'object' ? content : {});
  const reserve = readReserve(nextContent);

  if (reserve.withdrawals.some((w) => String(w.requestId || '').toLowerCase() === requestId)) {
    return { ok: false, error: 'withdrawal already burned' };
  }
  if (amountSats > reserve.outstandingSats) {
    return { ok: false, error: 'burn exceeds outstandingSats' };
  }

  if (opts.vaultConfirmedSats != null) {
    const v = Math.round(Number(opts.vaultConfirmedSats));
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: 'vaultConfirmedSats invalid' };
    }
    reserve.vaultConfirmedSats = v;
  }

  reserve.outstandingSats -= amountSats;
  reserve.pendingBurnsSats += amountSats;
  reserve.burnedSats += amountSats;
  reserve.withdrawals.push({
    requestId,
    amountSats,
    destinationAddress,
    burnedAt: opts.burnedAt || new Date().toISOString(),
    status: 'pending'
  });

  const cons = assertConservation(reserve);
  if (!cons.ok) return cons;

  nextContent[RESERVE_KEY] = reserve;
  return { ok: true, content: nextContent, reserve };
}

/**
 * After L1 vault payout confirms, settle a pending burn: drop pendingBurns and
 * vaultConfirmed by the same amountSats (request-scoped).
 * @param {object} content
 * @param {string} requestId
 * @param {Object} [opts]
 * @param {number} [opts.vaultConfirmedSats] optional verified vault total after payout
 * @returns {{ ok: true, content: object, reserve: FederationReserveState }|{ ok: false, error: string }}
 */
function settlePegOutPayout (content, requestId, opts = {}) {
  const id = String(requestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) {
    return { ok: false, error: 'requestId required (64-hex)' };
  }
  const nextContent = Object.assign({}, content && typeof content === 'object' ? content : {});
  const reserve = readReserve(nextContent);
  const row = reserve.withdrawals.find((w) => String(w.requestId || '').toLowerCase() === id);
  if (!row) return { ok: false, error: 'withdrawal not found' };
  if (String(row.status || '') === 'settled') {
    return { ok: false, error: 'withdrawal already settled' };
  }
  const amountSats = Math.round(Number(row.amountSats));
  if (!Number.isInteger(amountSats) || amountSats < DUST_SATS) {
    return { ok: false, error: 'withdrawal amountSats invalid' };
  }
  if (amountSats > reserve.pendingBurnsSats) {
    return { ok: false, error: 'settle exceeds pendingBurnsSats' };
  }

  if (opts.vaultConfirmedSats != null) {
    const v = Math.round(Number(opts.vaultConfirmedSats));
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: 'vaultConfirmedSats invalid' };
    }
    reserve.vaultConfirmedSats = v;
  } else {
    reserve.vaultConfirmedSats = Math.max(0, reserve.vaultConfirmedSats - amountSats);
  }

  reserve.pendingBurnsSats -= amountSats;
  row.status = 'settled';
  row.settledAt = opts.settledAt || new Date().toISOString();

  const cons = assertConservation(reserve);
  if (!cons.ok) return cons;

  nextContent[RESERVE_KEY] = reserve;
  return { ok: true, content: nextContent, reserve };
}

/**
 * RFC6902 replace/add patch that writes the full reserve object (typed path only).
 * @param {FederationReserveState} reserve
 * @returns {object[]}
 */
function patchesForReserve (reserve) {
  return [{
    op: 'add',
    path: `/${RESERVE_KEY}`,
    value: reserve
  }];
}

/**
 * Schema-check a full /federationReserve object (array elements included).
 * @param {object} value
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function validateReserveObjectSchema (value) {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'federationReserve value must be object' };
  }
  for (const key of ['outstandingSats', 'creditedSats', 'burnedSats', 'pendingBurnsSats', 'vaultConfirmedSats']) {
    const n = Number(value[key]);
    if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) {
      return { ok: false, error: `${key} must be a non-negative integer` };
    }
  }
  if (!Array.isArray(value.deposits) || !Array.isArray(value.withdrawals)) {
    return { ok: false, error: 'deposits and withdrawals must be arrays' };
  }
  for (const d of value.deposits) {
    if (!d || typeof d !== 'object') return { ok: false, error: 'invalid deposit row' };
    if (!/^[0-9a-f]{64}$/i.test(String(d.txid || ''))) {
      return { ok: false, error: 'deposit.txid must be 64-hex' };
    }
    if (!Number.isInteger(Number(d.vout)) || Number(d.vout) < 0) {
      return { ok: false, error: 'deposit.vout invalid' };
    }
    if (!Number.isInteger(Number(d.amountSats)) || Number(d.amountSats) < DUST_SATS) {
      return { ok: false, error: 'deposit.amountSats invalid' };
    }
  }
  for (const w of value.withdrawals) {
    if (!w || typeof w !== 'object') return { ok: false, error: 'invalid withdrawal row' };
    if (!/^[0-9a-f]{64}$/i.test(String(w.requestId || ''))) {
      return { ok: false, error: 'withdrawal.requestId must be 64-hex' };
    }
    if (!Number.isInteger(Number(w.amountSats)) || Number(w.amountSats) < DUST_SATS) {
      return { ok: false, error: 'withdrawal.amountSats invalid' };
    }
    if (!String(w.destinationAddress || '').trim()) {
      return { ok: false, error: 'withdrawal.destinationAddress required' };
    }
  }
  return { ok: true };
}

/**
 * Reject raw RFC6902 that mutates reserve fields without going through ledger helpers.
 * Call before applyPatchesToState when patches touch /federationReserve*.
 * Full-object replace/add must pass schema + conservation (provenance still requires
 * helper-generated patches in production — see docs/PEG_OPERATIONS.md).
 * @param {object[]} patches
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function validateLedgerPatch (patches) {
  if (!Array.isArray(patches) || !patches.length) {
    return { ok: false, error: 'patches must be a non-empty array' };
  }
  for (const p of patches) {
    if (!p || typeof p !== 'object') {
      return { ok: false, error: 'invalid patch op' };
    }
    const path = String(p.path || '');
    if (!path.startsWith(`/${RESERVE_KEY}`)) continue;
    // Only allow full-object replace/add of /federationReserve (not nested invent).
    if (path !== `/${RESERVE_KEY}`) {
      return {
        ok: false,
        error: 'federationReserve nested patches forbidden; use peg ledger helpers'
      };
    }
    if (p.op !== 'add' && p.op !== 'replace') {
      return { ok: false, error: `federationReserve op ${p.op} forbidden` };
    }
    const schema = validateReserveObjectSchema(p.value);
    if (!schema.ok) return schema;
    const cons = assertConservation({
      outstandingSats: p.value.outstandingSats,
      pendingBurnsSats: p.value.pendingBurnsSats,
      vaultConfirmedSats: p.value.vaultConfirmedSats
    });
    if (!cons.ok) return cons;
  }
  return { ok: true };
}

/**
 * Default path policy denying free-form balance invent outside typed reserve writes.
 * @returns {object}
 */
function defaultFederationSidechainPolicy () {
  return {
    maxOps: 64,
    maxPathDepth: 8,
    allowedPathPrefixes: [
      '/federationReserve',
      '/namespaces',
      '/program',
      '/members',
      '/clock'
    ],
    deniedPathPrefixes: [
      '/balances',
      '/reserves',
      '/claims',
      '/lbtc',
      '/mint'
    ],
    allowEmptyPolicy: false
  };
}

module.exports = {
  RESERVE_KEY,
  DUST_SATS,
  emptyReserve,
  readReserve,
  assertConservation,
  applyPegInCredit,
  applyPegOutBurn,
  settlePegOutPayout,
  patchesForReserve,
  validateLedgerPatch,
  validateReserveObjectSchema,
  defaultFederationSidechainPolicy,
  depositKey
};
