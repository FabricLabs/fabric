'use strict';

/**
 * @fileoverview L1/L2 liquidity swap market: pure helpers. One instrument,
 * **L1/L2**, priced as `premiumPpm` — 1 L1 sat = `(1 + premiumPpm / 1e6)` L2
 * sats. An **ask** sells L1 for L2, a **bid** buys L1 with L2; best bid is the
 * highest premium, best ask the lowest. A take settles atomically through one
 * SHA256 payment hash shared by a P2TR HTLC on L1
 * (`functions/inventoryHtlc`) and a BOLT11 invoice on L2: the party giving L1
 * owns the preimage, funds the HTLC first, and is paid by invoice; paying the
 * invoice reveals the preimage that claims the HTLC.
 *
 * Bodies travel as `CONTRACT_MESSAGE` JSON (`LiquidityOrder`,
 * `LiquidityOrderCancel`, `LiquidityTake`, `LiquidityTakeAccept`,
 * `LiquiditySwapFunded`), each BIP340-signed by its author over the canonical
 * body without `signature`. See `docs/LIQUIDITY_MARKET.md`.
 */

const crypto = require('crypto');
const ecc = require('../types/ecc');
const { stableStringify, jsonSafe } = require('./fabricCanonicalJson');
const { HTLC_MINIMUM_SATS } = require('../constants');
const inventoryHtlc = require('./inventoryHtlc');

const INSTRUMENT = 'L1/L2';
const BODY_VERSION = 1;
const SIDES = Object.freeze(['bid', 'ask']);
const PPM = 1000000;
/** Largest premium (either sign) an order may quote: ±50%. */
const MAX_PREMIUM_PPM = 500000;
/** Shortest refund lock an order may ask for. */
const MIN_REFUND_LOCK_BLOCKS = 12;
/** Longest refund lock an order may ask for (about two weeks of blocks). */
const MAX_REFUND_LOCK_BLOCKS = 2016;
/** Blocks the L2 giver needs left on the HTLC to claim after paying. */
const DEFAULT_MIN_CLAIM_BLOCKS = 6;
/** Invoice must expire at least this long before the refund lock opens. */
const DEFAULT_INVOICE_MARGIN_SECONDS = 3600;
const DEFAULT_SECONDS_PER_BLOCK = 600;
/** BOLT11 default expiry when the invoice names none. */
const DEFAULT_INVOICE_EXPIRY_SECONDS = 3600;

const BODY_TYPES = Object.freeze({
  ORDER: 'LiquidityOrder',
  CANCEL: 'LiquidityOrderCancel',
  TAKE: 'LiquidityTake',
  TAKE_ACCEPT: 'LiquidityTakeAccept',
  FUNDED: 'LiquiditySwapFunded'
});

/** Which field carries each body's author key. */
const SIGNER_FIELD = Object.freeze({
  [BODY_TYPES.ORDER]: 'makerPubkey',
  [BODY_TYPES.CANCEL]: 'makerPubkey',
  [BODY_TYPES.TAKE]: 'takerPubkey',
  [BODY_TYPES.TAKE_ACCEPT]: 'makerPubkey',
  [BODY_TYPES.FUNDED]: 'l1GiverPubkey'
});

/** @private */
function fail (message) {
  throw new Error(`liquiditySwap: ${message}`);
}

/** @private */
function hexOf (label, value, bytes) {
  const s = String(value == null ? '' : value).trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(s) || s.length !== bytes * 2) fail(`${label} must be ${bytes * 2} hex characters`);
  return s;
}

/** @private */
function pubkeyOf (label, value) {
  const s = hexOf(label, value, 33);
  if (!s.startsWith('02') && !s.startsWith('03')) fail(`${label} must be a compressed public key`);
  return s;
}

/** @private */
function intOf (label, value, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${label} must be an integer in [${min}, ${max}]`);
  return n;
}

/** @private */
function nonceOf (value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(s)) fail('nonce must be 16-64 hex characters');
  return s;
}

/** @private */
function sideOf (value) {
  const s = String(value || '').trim().toLowerCase();
  if (!SIDES.includes(s)) fail('side must be "bid" or "ask"');
  return s;
}

/** @private */
function stringOf (label, value, maxLength) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > maxLength) fail(`${label} must be a non-empty string of at most ${maxLength} characters`);
  return s;
}

/** @private */
function signatureOf (value) {
  if (value == null || value === '') return undefined;
  return hexOf('signature', value, 64);
}

/** @private */
function withSignature (body, signature) {
  const sig = signatureOf(signature);
  if (sig) body.signature = sig;
  return body;
}

/** @returns {string} 16 random bytes as hex */
function randomNonce () {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * @param {Object} input
 * @returns {Object} normalized `LiquidityOrder` body (keeps `signature`)
 */
function normalizeOrder (input = {}) {
  const minSats = intOf('minSats', input.minSats, HTLC_MINIMUM_SATS, Number.MAX_SAFE_INTEGER);
  const maxSats = intOf('maxSats', input.maxSats, minSats, Number.MAX_SAFE_INTEGER);
  const body = {
    type: BODY_TYPES.ORDER,
    version: BODY_VERSION,
    instrument: INSTRUMENT,
    side: sideOf(input.side),
    premiumPpm: intOf('premiumPpm', input.premiumPpm, -MAX_PREMIUM_PPM, MAX_PREMIUM_PPM),
    feeSats: intOf('feeSats', input.feeSats || 0, 0, maxSats),
    minSats,
    maxSats,
    prepaySats: intOf('prepaySats', input.prepaySats || 0, 0, minSats),
    refundLockBlocks: intOf('refundLockBlocks', input.refundLockBlocks, MIN_REFUND_LOCK_BLOCKS, MAX_REFUND_LOCK_BLOCKS),
    createdAt: intOf('createdAt', input.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: intOf('expiresAt', input.expiresAt, 1, Number.MAX_SAFE_INTEGER),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    lightningNodeId: pubkeyOf('lightningNodeId', input.lightningNodeId),
    network: stringOf('network', input.network, 32).toLowerCase(),
    nonce: nonceOf(input.nonce)
  };
  if (input.instrument != null && input.instrument !== INSTRUMENT) fail(`instrument must be ${INSTRUMENT}`);
  if (body.expiresAt <= body.createdAt) fail('expiresAt must be after createdAt');
  return withSignature(body, input.signature);
}

/**
 * @param {Object} input
 * @returns {Object} normalized `LiquidityOrderCancel` body
 */
function normalizeCancel (input = {}) {
  const body = {
    type: BODY_TYPES.CANCEL,
    version: BODY_VERSION,
    orderId: hexOf('orderId', input.orderId, 32),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    createdAt: intOf('createdAt', input.createdAt, 0, Number.MAX_SAFE_INTEGER)
  };
  return withSignature(body, input.signature);
}

/**
 * Settlement terms supplied by the L1 giver (the preimage owner): the payment
 * hash, its invoice, the absolute refund lock, and an optional prepay invoice.
 * @private
 */
function l1GiverTermsOf (input, { prepay }) {
  const terms = {
    paymentHashHex: hexOf('paymentHashHex', input.paymentHashHex, 32),
    invoice: stringOf('invoice', input.invoice, 4096),
    refundLockHeight: intOf('refundLockHeight', input.refundLockHeight, 1, 499999999)
  };
  if (prepay && input.prepayInvoice != null && input.prepayInvoice !== '') {
    terms.prepayInvoice = stringOf('prepayInvoice', input.prepayInvoice, 4096);
  }
  return terms;
}

/** @private */
function hasL1GiverTerms (input) {
  return input.paymentHashHex != null || input.invoice != null || input.refundLockHeight != null;
}

/**
 * A taker's request to fill part of an order. When the taker gives L1 (a
 * take on a bid) it carries the L1 giver's terms.
 * @param {Object} input
 * @returns {Object} normalized `LiquidityTake` body
 */
function normalizeTake (input = {}) {
  const body = {
    type: BODY_TYPES.TAKE,
    version: BODY_VERSION,
    orderId: hexOf('orderId', input.orderId, 32),
    side: sideOf(input.side),
    premiumPpm: intOf('premiumPpm', input.premiumPpm, -MAX_PREMIUM_PPM, MAX_PREMIUM_PPM),
    amountSats: intOf('amountSats', input.amountSats, HTLC_MINIMUM_SATS, Number.MAX_SAFE_INTEGER),
    takerPubkey: pubkeyOf('takerPubkey', input.takerPubkey),
    takerHtlcPubkey: pubkeyOf('takerHtlcPubkey', input.takerHtlcPubkey),
    takerNodeId: pubkeyOf('takerNodeId', input.takerNodeId),
    createdAt: intOf('createdAt', input.createdAt, 0, Number.MAX_SAFE_INTEGER),
    nonce: nonceOf(input.nonce)
  };
  if (hasL1GiverTerms(input)) Object.assign(body, l1GiverTermsOf(input, { prepay: false }));
  return withSignature(body, input.signature);
}

/**
 * The maker's acceptance of a take. When the maker gives L1 (a take on an
 * ask) it carries the L1 giver's terms and, for orders with `prepaySats`, a
 * prepay invoice the taker pays before the maker funds.
 * @param {Object} input
 * @returns {Object} normalized `LiquidityTakeAccept` body
 */
function normalizeTakeAccept (input = {}) {
  const body = {
    type: BODY_TYPES.TAKE_ACCEPT,
    version: BODY_VERSION,
    orderId: hexOf('orderId', input.orderId, 32),
    takeId: hexOf('takeId', input.takeId, 32),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    makerHtlcPubkey: pubkeyOf('makerHtlcPubkey', input.makerHtlcPubkey),
    createdAt: intOf('createdAt', input.createdAt, 0, Number.MAX_SAFE_INTEGER)
  };
  if (hasL1GiverTerms(input)) Object.assign(body, l1GiverTermsOf(input, { prepay: true }));
  return withSignature(body, input.signature);
}

/**
 * The L1 giver's notice that the HTLC is funded.
 * @param {Object} input
 * @returns {Object} normalized `LiquiditySwapFunded` body
 */
function normalizeFunded (input = {}) {
  const body = {
    type: BODY_TYPES.FUNDED,
    version: BODY_VERSION,
    takeId: hexOf('takeId', input.takeId, 32),
    l1GiverPubkey: pubkeyOf('l1GiverPubkey', input.l1GiverPubkey),
    txid: hexOf('txid', input.txid, 32),
    vout: intOf('vout', input.vout, 0, 100000),
    paymentAddress: stringOf('paymentAddress', input.paymentAddress, 128),
    amountSats: intOf('amountSats', input.amountSats, HTLC_MINIMUM_SATS, Number.MAX_SAFE_INTEGER),
    createdAt: intOf('createdAt', input.createdAt, 0, Number.MAX_SAFE_INTEGER)
  };
  return withSignature(body, input.signature);
}

const NORMALIZERS = Object.freeze({
  [BODY_TYPES.ORDER]: normalizeOrder,
  [BODY_TYPES.CANCEL]: normalizeCancel,
  [BODY_TYPES.TAKE]: normalizeTake,
  [BODY_TYPES.TAKE_ACCEPT]: normalizeTakeAccept,
  [BODY_TYPES.FUNDED]: normalizeFunded
});

/**
 * Build a normalized body of the given type (unsigned unless `fields.signature`).
 * @param {string} type one of {@link BODY_TYPES}
 * @param {Object} fields
 * @returns {Object}
 */
function toBody (type, fields = {}) {
  const normalize = NORMALIZERS[type];
  if (!normalize) fail(`unknown body type ${type}`);
  return normalize(fields);
}

/**
 * Rehydrate a `CONTRACT_MESSAGE` body; `null` for other types or malformed bodies.
 * @param {Object} body
 * @returns {Object|null}
 */
function fromBody (body) {
  if (!body || typeof body !== 'object' || !NORMALIZERS[body.type]) return null;
  if (body.version != null && Number(body.version) !== BODY_VERSION) return null;
  try {
    return NORMALIZERS[body.type](body);
  } catch {
    return null;
  }
}

/**
 * Canonical signing bytes: the body without `signature`.
 * @param {Object} body
 * @returns {string}
 */
function signingString (body) {
  const copy = Object.assign({}, body);
  delete copy.signature;
  return stableStringify(jsonSafe(copy));
}

/**
 * Stable id of a body: SHA-256 hex of {@link signingString}. Orders, takes,
 * and accepts are referenced by it.
 * @param {Object} body
 * @returns {string}
 */
function bodyId (body) {
  return crypto.createHash('sha256').update(signingString(body)).digest('hex');
}

/** @private */
function privOf (signer) {
  const priv = Buffer.isBuffer(signer) || signer instanceof Uint8Array
    ? Buffer.from(signer)
    : Buffer.from(hexOf('private key', signer, 32), 'hex');
  if (priv.length !== 32 || !ecc.isPrivate(priv)) fail('invalid private key');
  return priv;
}

/**
 * Compressed public key for a 32-byte private key.
 * @param {Buffer|string} priv32
 * @returns {string} 66 hex characters
 */
function pubkeyFromPrivate (priv32) {
  return Buffer.from(ecc.pointFromScalar(privOf(priv32), true)).toString('hex');
}

/**
 * Normalize and BIP340-sign a body. The signer must own the body's author key
 * ({@link SIGNER_FIELD}).
 * @param {Object} body
 * @param {Buffer|string} priv32
 * @returns {Object} normalized body with `signature`
 */
function signBody (body, priv32) {
  const unsigned = toBody(body.type, Object.assign({}, body, { signature: undefined }));
  const priv = privOf(priv32);
  const field = SIGNER_FIELD[unsigned.type];
  if (pubkeyFromPrivate(priv) !== unsigned[field]) fail(`signing key does not match ${field}`);
  const hash = crypto.createHash('sha256').update(signingString(unsigned)).digest();
  const sig = Buffer.from(ecc.signSchnorr(hash, priv)).toString('hex');
  return Object.assign(unsigned, { signature: sig });
}

/**
 * Check a body's shape and its author's BIP340 signature.
 * @param {Object} body
 * @returns {{ ok: boolean, reason: (string|null), body: (Object|null), id: (string|null) }}
 */
function verifyBody (body) {
  const normalized = fromBody(body);
  if (!normalized) return { ok: false, reason: 'malformed body', body: null, id: null };
  if (!normalized.signature) return { ok: false, reason: 'unsigned body', body: normalized, id: null };
  const field = SIGNER_FIELD[normalized.type];
  const xonly = Buffer.from(normalized[field], 'hex').subarray(1);
  const hash = crypto.createHash('sha256').update(signingString(normalized)).digest();
  let ok = false;
  try {
    ok = ecc.verifySchnorr(hash, xonly, Buffer.from(normalized.signature, 'hex'));
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, reason: 'bad signature', body: normalized, id: null };
  return { ok: true, reason: null, body: normalized, id: bodyId(normalized) };
}

/**
 * Settlement roles. The L1 giver owns the preimage and funds the HTLC; the
 * L2 giver pays the invoice and claims. An ask's maker sells L1; a bid's
 * maker buys it.
 * @param {Object} opts
 * @param {string} opts.side order side
 * @param {*} opts.maker maker identifier (pubkey, record, …)
 * @param {*} opts.taker taker identifier
 * @returns {{ l1Giver: *, l2Giver: *, preimageOwner: *, makerIsL1Giver: boolean }}
 */
function swapRoles ({ side, maker, taker }) {
  const makerIsL1Giver = sideOf(side) === 'ask';
  const l1Giver = makerIsL1Giver ? maker : taker;
  return {
    l1Giver,
    l2Giver: makerIsL1Giver ? taker : maker,
    preimageOwner: l1Giver,
    makerIsL1Giver
  };
}

/**
 * @param {Object} opts
 * @param {string} opts.side order side
 * @param {boolean} opts.isMaker
 * @returns {'l1Giver'|'l2Giver'}
 */
function roleFor ({ side, isMaker }) {
  const { makerIsL1Giver } = swapRoles({ side, maker: true, taker: false });
  return (makerIsL1Giver === Boolean(isMaker)) ? 'l1Giver' : 'l2Giver';
}

/**
 * Amounts for filling `amountSats` of L1 against an order. The L1 giver
 * funds the HTLC with `l1Sats`; the L2 giver pays an invoice of `l2Msat`:
 * `amountSats × (1 + premiumPpm / 1e6)` sats, plus the maker's `feeSats`
 * when the taker pays L2 (asks) or minus it when the maker does (bids), so
 * the fee always reaches the maker.
 * @param {Object} opts
 * @param {string} opts.side
 * @param {number} opts.premiumPpm
 * @param {number} [opts.feeSats=0]
 * @param {number} opts.amountSats L1 sats
 * @returns {{ side: string, amountSats: number, l1Sats: number, l2Msat: number, l2Sats: number, premiumPpm: number, feeSats: number, feeMsat: number }}
 */
function quote (opts = {}) {
  const side = sideOf(opts.side);
  const premiumPpm = intOf('premiumPpm', opts.premiumPpm, -MAX_PREMIUM_PPM, MAX_PREMIUM_PPM);
  const amountSats = intOf('amountSats', opts.amountSats, 1, Number.MAX_SAFE_INTEGER);
  const feeSats = intOf('feeSats', opts.feeSats || 0, 0, Number.MAX_SAFE_INTEGER);
  const ppm = BigInt(PPM);
  const atPremium = ((BigInt(amountSats) * 1000n * (ppm + BigInt(premiumPpm))) + (ppm / 2n)) / ppm;
  const feeMsat = BigInt(feeSats) * 1000n * (side === 'ask' ? 1n : -1n);
  const l2 = atPremium + feeMsat;
  if (l2 <= 0n) fail('fee exceeds the L2 amount');
  if (l2 > BigInt(Number.MAX_SAFE_INTEGER)) fail('amount too large');
  const l2Msat = Number(l2);
  return {
    side,
    amountSats,
    l1Sats: amountSats,
    l2Msat,
    l2Sats: Math.ceil(l2Msat / 1000),
    premiumPpm,
    feeSats,
    feeMsat: Number(feeMsat)
  };
}

/**
 * Taproot HTLC for a swap: the L2 giver claims with the preimage, the L1
 * giver refunds after `refundLockHeight`. Same script tree as
 * `inventoryHtlc.buildInventoryHtlcP2tr` (claim = seller leaf, refund =
 * buyer leaf), so its claim / refund PSBT helpers spend it unchanged.
 * @param {Object} opts
 * @param {string} opts.networkName
 * @param {string} opts.l2GiverPubkeyHex claim key (compressed)
 * @param {string} opts.l1GiverPubkeyHex refund key (compressed)
 * @param {string} opts.paymentHashHex SHA256(preimage)
 * @param {number} opts.refundLockHeight absolute block height
 * @param {number} [opts.amountSats]
 * @returns {{ paymentAddress: string, outputHex: string, claimScriptHex: string, refundScriptHex: string, paymentHashHex: string, refundLockHeight: number, amountSats: (number|null), amountBtc: string, bitcoinUri: string }}
 */
function buildSwapEscrow (opts = {}) {
  const claimKey = pubkeyOf('l2GiverPubkeyHex', opts.l2GiverPubkeyHex);
  const refundKey = pubkeyOf('l1GiverPubkeyHex', opts.l1GiverPubkeyHex);
  const paymentHashHex = hexOf('paymentHashHex', opts.paymentHashHex, 32);
  const refundLockHeight = intOf('refundLockHeight', opts.refundLockHeight, 1, 499999999);
  const built = inventoryHtlc.buildInventoryHtlcP2tr({
    networkName: opts.networkName || 'regtest',
    sellerPubkeyCompressed: Buffer.from(claimKey, 'hex'),
    buyerRefundPubkeyCompressed: Buffer.from(refundKey, 'hex'),
    paymentHash32: Buffer.from(paymentHashHex, 'hex'),
    refundLocktimeHeight: refundLockHeight
  });
  const amountSats = opts.amountSats != null ? Math.round(Number(opts.amountSats)) : null;
  const hints = inventoryHtlc.buildHtlcFundingHints({
    paymentAddress: built.address,
    amountSats: amountSats || 0,
    label: 'liquidity-swap'
  });
  return {
    paymentAddress: built.address,
    outputHex: built.output.toString('hex'),
    claimScriptHex: built.claimScript.toString('hex'),
    refundScriptHex: built.refundScript.toString('hex'),
    paymentHashHex,
    refundLockHeight,
    amountSats,
    amountBtc: hints.amountBtc,
    bitcoinUri: hints.bitcoinUri
  };
}

/**
 * Rebuild the swap HTLC and compare with an advertised address. Never fund
 * or pay against an address that does not match.
 * @param {Object} opts {@link buildSwapEscrow} options plus `paymentAddress`
 * @returns {{ ok: boolean, reason: (string|null), escrow: (Object|null) }}
 */
function validateSwapEscrow (opts = {}) {
  let escrow;
  try {
    escrow = buildSwapEscrow(opts);
  } catch (err) {
    return { ok: false, reason: err.message, escrow: null };
  }
  const offered = opts.paymentAddress != null ? String(opts.paymentAddress).trim() : '';
  if (offered && offered !== escrow.paymentAddress) {
    return { ok: false, reason: 'paymentAddress does not match the swap HTLC', escrow };
  }
  return { ok: true, reason: null, escrow };
}

/**
 * Millisatoshi amount from a decoded invoice (`amount_msat` as a number,
 * numeric string, or legacy `"123msat"` string).
 * @param {Object} decoded
 * @returns {number|null}
 */
function invoiceAmountMsat (decoded = {}) {
  const raw = decoded.amount_msat != null ? decoded.amount_msat : decoded.amountMsat;
  if (raw == null) return null;
  const n = Number(String(raw).replace(/msat$/, ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Check a decoded BOLT11 invoice (Core Lightning `decodepay`) before paying
 * it for a swap: it must lock to the swap's payment hash, ask exactly the
 * quoted amount, come from the expected node, and expire — plus a margin —
 * before the HTLC's refund lock opens, with at least `minClaimBlocks` left
 * for the claim.
 * @param {Object} opts
 * @param {Object} opts.decoded `decodepay` output
 * @param {string} opts.paymentHashHex
 * @param {number} opts.expectedMsat
 * @param {string} [opts.payee] expected node id
 * @param {number} opts.refundLockHeight
 * @param {number} opts.tipHeight
 * @param {number} [opts.nowSeconds]
 * @param {number} [opts.secondsPerBlock=600]
 * @param {number} [opts.marginSeconds=3600]
 * @param {number} [opts.minClaimBlocks=6]
 * @returns {{ ok: boolean, reason: (string|null), expiresAt: (number|null) }}
 */
function validateSwapInvoice (opts = {}) {
  const decoded = opts.decoded || {};
  const bad = (reason, expiresAt = null) => ({ ok: false, reason, expiresAt });
  const hash = String(decoded.payment_hash || decoded.paymentHash || '').toLowerCase();
  if (!hash || hash !== String(opts.paymentHashHex || '').toLowerCase()) return bad('invoice payment hash does not match the swap');
  const amount = invoiceAmountMsat(decoded);
  if (amount == null || amount !== Number(opts.expectedMsat)) return bad('invoice amount does not match the quote');
  if (opts.payee && String(decoded.payee || '').toLowerCase() !== String(opts.payee).toLowerCase()) {
    return bad('invoice payee is not the counterparty node');
  }
  const createdAt = Number(decoded.created_at != null ? decoded.created_at : decoded.createdAt);
  const expiry = Number(decoded.expiry != null ? decoded.expiry : DEFAULT_INVOICE_EXPIRY_SECONDS);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiry)) return bad('invoice has no creation time');
  const expiresAt = createdAt + expiry;
  const now = opts.nowSeconds != null ? Number(opts.nowSeconds) : Math.floor(Date.now() / 1000);
  if (expiresAt <= now) return bad('invoice expired', expiresAt);
  const blocksLeft = Number(opts.refundLockHeight) - Number(opts.tipHeight);
  const minClaimBlocks = opts.minClaimBlocks != null ? Number(opts.minClaimBlocks) : DEFAULT_MIN_CLAIM_BLOCKS;
  if (!Number.isFinite(blocksLeft) || blocksLeft < minClaimBlocks) return bad('refund lock too close to claim safely', expiresAt);
  const secondsPerBlock = opts.secondsPerBlock != null ? Number(opts.secondsPerBlock) : DEFAULT_SECONDS_PER_BLOCK;
  const margin = opts.marginSeconds != null ? Number(opts.marginSeconds) : DEFAULT_INVOICE_MARGIN_SECONDS;
  if (expiresAt + margin > now + (blocksLeft * secondsPerBlock)) {
    return bad('invoice outlives the refund lock', expiresAt);
  }
  return { ok: true, reason: null, expiresAt };
}

/**
 * Check a take against the order it fills.
 * @param {Object} order normalized order
 * @param {Object} take normalized take
 * @param {Object} [opts]
 * @param {number} [opts.now] ms
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function validateTake (order, take, opts = {}) {
  const bad = (reason) => ({ ok: false, reason });
  const now = opts.now != null ? Number(opts.now) : Date.now();
  if (!order || !take) return bad('missing order or take');
  if (take.orderId !== bodyId(order)) return bad('take names another order');
  if (take.side !== order.side) return bad('take side does not match the order');
  if (take.premiumPpm !== order.premiumPpm) return bad('take premium does not match the order');
  if (order.expiresAt <= now) return bad('order expired');
  if (take.amountSats < order.minSats || take.amountSats > order.maxSats) return bad('take amount outside the order limits');
  if (take.takerPubkey === order.makerPubkey) return bad('maker cannot take its own order');
  const takerGivesL1 = roleFor({ side: order.side, isMaker: false }) === 'l1Giver';
  if (takerGivesL1 !== hasL1GiverTerms(take)) {
    return bad(takerGivesL1 ? 'taker gives L1 and must send the payment terms' : 'only the L1 giver sends payment terms');
  }
  return { ok: true, reason: null };
}

/**
 * Check an acceptance against its order and take.
 * @param {Object} order
 * @param {Object} take
 * @param {Object} accept
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function validateTakeAccept (order, take, accept) {
  const bad = (reason) => ({ ok: false, reason });
  if (!order || !take || !accept) return bad('missing order, take, or accept');
  if (accept.orderId !== bodyId(order) || accept.takeId !== bodyId(take)) return bad('accept names another order or take');
  if (accept.makerPubkey !== order.makerPubkey) return bad('accept is not from the maker');
  const makerGivesL1 = roleFor({ side: order.side, isMaker: true }) === 'l1Giver';
  if (makerGivesL1 !== hasL1GiverTerms(accept)) {
    return bad(makerGivesL1 ? 'maker gives L1 and must send the payment terms' : 'only the L1 giver sends payment terms');
  }
  if (makerGivesL1 && order.prepaySats > 0 && !accept.prepayInvoice) return bad('order requires a prepay invoice');
  return { ok: true, reason: null };
}

/**
 * The L1 giver's terms for a take, from whichever body carries them.
 * @param {Object} order
 * @param {Object} take
 * @param {Object} [accept]
 * @returns {Object|null} `{ paymentHashHex, invoice, refundLockHeight, prepayInvoice? }`
 */
function l1GiverTerms (order, take, accept) {
  const source = swapRoles({ side: order.side, maker: accept, taker: take }).l1Giver;
  if (!source || !hasL1GiverTerms(source)) return null;
  const terms = {
    paymentHashHex: source.paymentHashHex,
    invoice: source.invoice,
    refundLockHeight: source.refundLockHeight
  };
  if (source.prepayInvoice) terms.prepayInvoice = source.prepayInvoice;
  return terms;
}

module.exports = {
  INSTRUMENT,
  BODY_VERSION,
  BODY_TYPES,
  SIDES,
  PPM,
  MAX_PREMIUM_PPM,
  MIN_REFUND_LOCK_BLOCKS,
  MAX_REFUND_LOCK_BLOCKS,
  DEFAULT_MIN_CLAIM_BLOCKS,
  DEFAULT_INVOICE_MARGIN_SECONDS,
  DEFAULT_SECONDS_PER_BLOCK,
  SIGNER_FIELD,
  randomNonce,
  normalizeOrder,
  normalizeCancel,
  normalizeTake,
  normalizeTakeAccept,
  normalizeFunded,
  toBody,
  fromBody,
  signingString,
  bodyId,
  pubkeyFromPrivate,
  signBody,
  verifyBody,
  swapRoles,
  roleFor,
  quote,
  buildSwapEscrow,
  validateSwapEscrow,
  invoiceAmountMsat,
  validateSwapInvoice,
  validateTake,
  validateTakeAccept,
  l1GiverTerms
};
