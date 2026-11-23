'use strict';

/**
 * @fileoverview **Swap** — one fill of the L1/L2 liquidity market, plus the
 * market's pure helpers as statics.
 *
 * One instrument, **L1/L2**, priced as `premiumPpm` — 1 L1 sat =
 * `(1 + premiumPpm / 1e6)` L2 sats. An **ask** sells L1 for L2, a **bid** buys
 * L1 with L2; best bid is the highest premium, best ask the lowest. A take
 * settles atomically through one SHA256 payment hash shared by a P2TR HTLC on
 * L1 (`types/htlc`) and a BOLT11 invoice on L2: the party giving L1 owns the
 * preimage, funds the HTLC first, and is paid by invoice; paying the invoice
 * reveals the preimage that claims the HTLC.
 *
 * Bodies travel as `CONTRACT_MESSAGE` JSON (`LiquidityOrder`,
 * `LiquidityOrderCancel`, `LiquidityTake`, `LiquidityTakeAccept`,
 * `LiquiditySwapFunded`), each BIP340-signed by its author over the canonical
 * body without `signature`. Makers' orders are kept by `types/liquidityBook`.
 *
 * Each side of a fill runs its own `Swap`: `new → proposed → accepted →
 * prepaid? → l1Funded → l2Paid → l1Claimed`, or `refunded` / `aborted`.
 * Chain and Lightning access go through adapters (see {@link Swap.bitcoinAdapter}
 * and {@link Swap.lightningAdapter}) so the machine runs without daemons in
 * tests. See `docs/LIQUIDITY_MARKET.md`.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const bitcoin = require('bitcoinjs-lib');
const SignedBook = require('./signedBook');
const { HTLC_MINIMUM_SATS } = require('../constants');
const Htlc = require('./htlc');
const { networkForFabricName } = require('./policy');

const INSTRUMENT = 'L1/L2';
const BODY_VERSION = 1;
const SIDES = Object.freeze(['bid', 'ask']);
const PPM = 1000000;
/** Largest premium (either sign) an order may quote: ±50%. */
const MAX_PREMIUM_PPM = 500000;
/** Blocks the L2 giver needs left on the HTLC to claim after paying. */
const DEFAULT_MIN_CLAIM_BLOCKS = 6;
/** HTLC confirmations before the L2 giver pays. */
const DEFAULT_MIN_CONFIRMATIONS = 1;
/** Invoice must expire at least this long before the refund lock opens. */
const DEFAULT_INVOICE_MARGIN_SECONDS = 3600;
const DEFAULT_SECONDS_PER_BLOCK = 600;
/** Shortest expiry a swap invoice may carry. */
const MIN_INVOICE_EXPIRY_SECONDS = 60;
/**
 * Shortest refund lock an order may ask for: room for the claim, the funding
 * confirmations, one block of slack, the invoice margin, and the shortest
 * invoice, at the default block time.
 */
const MIN_REFUND_LOCK_BLOCKS = DEFAULT_MIN_CLAIM_BLOCKS + DEFAULT_MIN_CONFIRMATIONS + 1 +
  Math.ceil((DEFAULT_INVOICE_MARGIN_SECONDS + MIN_INVOICE_EXPIRY_SECONDS) / DEFAULT_SECONDS_PER_BLOCK);
/** Longest refund lock an order may ask for (about two weeks of blocks). */
const MAX_REFUND_LOCK_BLOCKS = 2016;
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
  throw new Error(`swap: ${message}`);
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

// A Map, so a remote `type` such as `toString` never reaches an inherited method.
const NORMALIZERS = new Map([
  [BODY_TYPES.ORDER, normalizeOrder],
  [BODY_TYPES.CANCEL, normalizeCancel],
  [BODY_TYPES.TAKE, normalizeTake],
  [BODY_TYPES.TAKE_ACCEPT, normalizeTakeAccept],
  [BODY_TYPES.FUNDED, normalizeFunded]
]);

const {
  toBody,
  fromBody,
  signingString,
  bodyId,
  pubkeyFromPrivate,
  signBody,
  verifyBody,
  randomNonce
} = SignedBook.codec({
  name: 'swap',
  version: BODY_VERSION,
  normalizers: NORMALIZERS,
  signerField: SIGNER_FIELD
});

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
function roles ({ side, maker, taker }) {
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
  const { makerIsL1Giver } = roles({ side, maker: true, taker: false });
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
 * giver refunds after `refundLockHeight`. A plain {@link Htlc} (claim =
 * seller leaf, refund = buyer leaf), so its claim / refund PSBT helpers spend
 * it unchanged.
 * @param {Object} opts
 * @param {string} opts.networkName
 * @param {string} opts.l2GiverPubkeyHex claim key (compressed)
 * @param {string} opts.l1GiverPubkeyHex refund key (compressed)
 * @param {string} opts.paymentHashHex SHA256(preimage)
 * @param {number} opts.refundLockHeight absolute block height
 * @param {number} [opts.amountSats]
 * @returns {{ paymentAddress: string, outputHex: string, claimScriptHex: string, refundScriptHex: string, paymentHashHex: string, refundLockHeight: number, amountSats: (number|null), amountBtc: string, bitcoinUri: string }}
 */
function buildEscrow (opts = {}) {
  const claimKey = pubkeyOf('l2GiverPubkeyHex', opts.l2GiverPubkeyHex);
  const refundKey = pubkeyOf('l1GiverPubkeyHex', opts.l1GiverPubkeyHex);
  const paymentHashHex = hexOf('paymentHashHex', opts.paymentHashHex, 32);
  const refundLockHeight = intOf('refundLockHeight', opts.refundLockHeight, 1, 499999999);
  const built = new Htlc({
    network: opts.networkName || 'regtest',
    claimPubkey: claimKey,
    refundPubkey: refundKey,
    paymentHash: paymentHashHex,
    refundLocktime: refundLockHeight
  });
  const amountSats = opts.amountSats != null ? Math.round(Number(opts.amountSats)) : null;
  const hints = built.fundingHints({
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
 * @param {Object} opts {@link buildEscrow} options plus `paymentAddress`
 * @returns {{ ok: boolean, reason: (string|null), escrow: (Object|null) }}
 */
function validateEscrow (opts = {}) {
  let escrow;
  try {
    escrow = buildEscrow(opts);
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
function validateInvoice (opts = {}) {
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
  const source = roles({ side: order.side, maker: accept, taker: take }).l1Giver;
  if (!source || !hasL1GiverTerms(source)) return null;
  const terms = {
    paymentHashHex: source.paymentHashHex,
    invoice: source.invoice,
    refundLockHeight: source.refundLockHeight
  };
  if (source.prepayInvoice) terms.prepayInvoice = source.prepayInvoice;
  return terms;
}

const STATES = Object.freeze({
  NEW: 'new',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  PREPAID: 'prepaid',
  L1_FUNDED: 'l1Funded',
  L2_PAID: 'l2Paid',
  L1_CLAIMED: 'l1Claimed',
  REFUNDED: 'refunded',
  ABORTED: 'aborted'
});

const TRANSITIONS = Object.freeze({
  new: ['proposed', 'accepted', 'aborted'],
  proposed: ['accepted', 'aborted'],
  accepted: ['prepaid', 'l1Funded', 'aborted'],
  prepaid: ['l1Funded', 'aborted'],
  l1Funded: ['l2Paid', 'l1Claimed', 'refunded'],
  l2Paid: ['l1Claimed'],
  l1Claimed: [],
  refunded: [],
  aborted: []
});

/**
 * Blocks a refund lock the taker chose may exceed the order's (propagation slack).
 * @private
 */
const LOCK_SLACK_BLOCKS = 2;

/** @private */
function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** @private */
function privBuffer (value, label) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'hex');
  if (buf.length !== 32) throw new Error(`Swap: ${label} must be a 32-byte private key`);
  return buf;
}

class Swap extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Object} settings.order signed `LiquidityOrder` body
   * @param {string} settings.role `maker` or `taker`
   * @param {Buffer|string} settings.identityKey private key that signs this side's bodies (maker: the order's `makerPubkey`)
   * @param {Buffer|string} settings.htlcKey private key for this side's HTLC leaf
   * @param {string} [settings.lightningNodeId] this side's node id (required for takers)
   * @param {Object} settings.adapters `{ bitcoin, lightning }`
   * @param {number} [settings.secondsPerBlock=600]
   * @param {number} [settings.marginSeconds=3600] invoice must expire this long before the refund lock opens
   * @param {number} [settings.minClaimBlocks=6]
   * @param {number} [settings.minConfirmations=1] HTLC confirmations before the L2 giver pays
   * @param {number} [settings.invoiceExpirySeconds=3600] upper bound on the swap invoice's expiry
   * @param {Function} [settings.now] clock in ms (tests)
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      secondsPerBlock: DEFAULT_SECONDS_PER_BLOCK,
      marginSeconds: DEFAULT_INVOICE_MARGIN_SECONDS,
      minClaimBlocks: DEFAULT_MIN_CLAIM_BLOCKS,
      minConfirmations: DEFAULT_MIN_CONFIRMATIONS,
      invoiceExpirySeconds: DEFAULT_INVOICE_EXPIRY_SECONDS,
      now: () => Date.now()
    }, settings);

    const verified = verifyBody(settings.order);
    if (!verified.ok || verified.body.type !== BODY_TYPES.ORDER) {
      throw new Error(`Swap: invalid order (${verified.reason || 'not a LiquidityOrder'})`);
    }
    if (!['maker', 'taker'].includes(settings.role)) throw new Error('Swap: role must be "maker" or "taker"');
    const adapters = settings.adapters || {};
    if (!adapters.bitcoin || !adapters.lightning) throw new Error('Swap: adapters.bitcoin and adapters.lightning are required');

    this.order = verified.body;
    this.orderId = verified.id;
    this.isMaker = settings.role === 'maker';
    this.role = roleFor({ side: this.order.side, isMaker: this.isMaker });
    this.adapters = adapters;
    this._identityKey = privBuffer(settings.identityKey, 'identityKey');
    this._htlcKey = privBuffer(settings.htlcKey, 'htlcKey');
    this.identityPubkey = pubkeyFromPrivate(this._identityKey);
    this.htlcPubkey = pubkeyFromPrivate(this._htlcKey);
    if (this.isMaker && this.identityPubkey !== this.order.makerPubkey) {
      throw new Error('Swap: maker identityKey does not match the order');
    }
    this.lightningNodeId = settings.lightningNodeId || (this.isMaker ? this.order.lightningNodeId : null);

    this._state = {
      status: STATES.NEW,
      take: null,
      takeId: null,
      accept: null,
      funded: null,
      quote: null,
      terms: null,
      escrow: null,
      preimageHex: null,
      prepayPaymentHash: null,
      fundingStartedAt: null,
      fundingTxid: null,
      fundingTxHex: null,
      claimTxid: null,
      refundTxid: null,
      history: []
    };
    this._funding = false;
  }

  static get STATES () { return STATES; }
  static get TRANSITIONS () { return TRANSITIONS; }

  /** @returns {string} current state */
  get status () { return this._state.status; }
  /** @returns {boolean} */
  get isL1Giver () { return this.role === 'l1Giver'; }
  /** @returns {Object|null} */
  get take () { return this._state.take; }
  /** @returns {string|null} */
  get takeId () { return this._state.takeId; }
  /** @returns {Object|null} */
  get accept () { return this._state.accept; }
  /** @returns {Object|null} */
  get funded () { return this._state.funded; }
  /** @returns {Object|null} amounts for this fill */
  get quote () { return this._state.quote; }
  /** @returns {Object|null} L1 giver's `{ paymentHashHex, invoice, refundLockHeight, prepayInvoice? }` */
  get terms () { return this._state.terms; }
  /** @returns {Object|null} swap HTLC (`buildEscrow`) */
  get escrow () { return this._state.escrow; }

  /** @private */
  _transition (to, detail = {}) {
    const from = this._state.status;
    if (!TRANSITIONS[from].includes(to)) throw new Error(`Swap: cannot move from ${from} to ${to}`);
    this._state.status = to;
    this._state.history.push(Object.assign({ from, to, at: this.settings.now() }, detail));
    this.emit('debug', `[LIQUIDITY:SWAP] ${this.takeId || this.orderId} ${from} → ${to}`);
    this.emit('state', { from, to, swap: this });
  }

  /** @private */
  _expect (statuses, role) {
    if (!statuses.includes(this._state.status)) {
      throw new Error(`Swap: expected state ${statuses.join(' | ')}, got ${this._state.status}`);
    }
    if (role && this.role !== role) throw new Error(`Swap: only the ${role} may do this`);
  }

  /** @private */
  _fail (message) {
    const err = new Error(`Swap: ${message}`);
    if (this.listenerCount('error') > 0) this.emit('error', err);
    return err;
  }

  /**
   * Counterparty identity key.
   * @private
   */
  get _counterpartyPubkey () {
    return this.isMaker ? (this._state.take && this._state.take.takerPubkey) : this.order.makerPubkey;
  }

  /**
   * Counterparty HTLC key.
   * @private
   */
  get _counterpartyHtlcPubkey () {
    if (this.isMaker) return this._state.take ? this._state.take.takerHtlcPubkey : null;
    return this._state.accept ? this._state.accept.makerHtlcPubkey : null;
  }

  /**
   * Counterparty Lightning node.
   * @private
   */
  get _counterpartyNodeId () {
    return this.isMaker ? (this._state.take && this._state.take.takerNodeId) : this.order.lightningNodeId;
  }

  /** @private */
  _invoiceExpirySeconds () {
    const blocks = this.order.refundLockBlocks - this.settings.minClaimBlocks - this.settings.minConfirmations - 1;
    const fit = Math.floor((blocks * this.settings.secondsPerBlock) - this.settings.marginSeconds);
    const expiry = Math.min(this.settings.invoiceExpirySeconds, fit);
    if (expiry < MIN_INVOICE_EXPIRY_SECONDS) throw this._fail('refund lock too short for a safe invoice expiry');
    return expiry;
  }

  /**
   * Preimage, invoice, and refund lock for the L1 giver.
   * @private
   */
  async _issueL1GiverTerms (label) {
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    const preimage = Htlc.randomPreimage();
    const paymentHashHex = sha256Hex(preimage);
    const invoice = await this.adapters.lightning.createInvoice({
      amountMsat: this._state.quote.l2Msat,
      label,
      description: `Fabric L1/L2 swap ${this._state.quote.amountSats} sats`,
      preimageHex: preimage.toString('hex'),
      expirySeconds: this._invoiceExpirySeconds()
    });
    if (String(invoice.paymentHash || '').toLowerCase() !== paymentHashHex) {
      throw this._fail('Lightning node did not lock the invoice to the swap preimage');
    }
    this._state.preimageHex = preimage.toString('hex');
    return {
      paymentHashHex,
      invoice: invoice.bolt11,
      refundLockHeight: tip + this.order.refundLockBlocks
    };
  }

  /**
   * Check the L1 giver's terms as the L2 giver: refund lock in range and an
   * invoice that is safe to pay later.
   * @private
   */
  async _checkL1GiverTerms (terms) {
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    const blocksLeft = terms.refundLockHeight - tip;
    if (blocksLeft > this.order.refundLockBlocks + LOCK_SLACK_BLOCKS) throw this._fail('refund lock longer than the order allows');
    await this._checkInvoice(terms, tip);
  }

  /** @private */
  async _checkInvoice (terms, tip) {
    const decoded = await this.adapters.lightning.decodeInvoice(terms.invoice);
    const v = validateInvoice({
      decoded,
      paymentHashHex: terms.paymentHashHex,
      expectedMsat: this._state.quote.l2Msat,
      payee: this._counterpartyNodeId,
      refundLockHeight: terms.refundLockHeight,
      tipHeight: tip,
      nowSeconds: Math.floor(this.settings.now() / 1000),
      secondsPerBlock: this.settings.secondsPerBlock,
      marginSeconds: this.settings.marginSeconds,
      minClaimBlocks: this.settings.minClaimBlocks
    });
    if (!v.ok) throw this._fail(v.reason);
  }

  /**
   * Taker: propose filling `amountSats` of the order.
   * @param {Object} opts
   * @param {number} opts.amountSats
   * @returns {Promise<Object>} signed `LiquidityTake` body to send to the maker
   */
  async createTake ({ amountSats }) {
    if (this.isMaker) throw new Error('Swap: only the taker creates a take');
    this._expect([STATES.NEW]);
    if (!this.lightningNodeId) throw new Error('Swap: taker needs lightningNodeId');
    this._state.quote = quote({ side: this.order.side, premiumPpm: this.order.premiumPpm, feeSats: this.order.feeSats, amountSats });
    const nonce = randomNonce();
    const fields = {
      type: BODY_TYPES.TAKE,
      orderId: this.orderId,
      side: this.order.side,
      premiumPpm: this.order.premiumPpm,
      amountSats: this._state.quote.amountSats,
      takerPubkey: this.identityPubkey,
      takerHtlcPubkey: this.htlcPubkey,
      takerNodeId: this.lightningNodeId,
      createdAt: this.settings.now(),
      nonce
    };
    if (this.isL1Giver) Object.assign(fields, await this._issueL1GiverTerms(`liquidity-swap:${this.orderId}:${nonce}`));
    const take = signBody(fields, this._identityKey);
    const v = validateTake(this.order, take, { now: this.settings.now() });
    if (!v.ok) throw this._fail(v.reason);
    this._state.take = take;
    this._state.takeId = bodyId(take);
    if (this.isL1Giver) this._state.terms = l1GiverTerms(this.order, take, null);
    this._transition(STATES.PROPOSED);
    return take;
  }

  /**
   * Maker: accept a taker's signed take.
   * @param {Object} takeBody
   * @returns {Promise<Object>} signed `LiquidityTakeAccept` body to send back
   */
  async acceptTake (takeBody) {
    if (!this.isMaker) throw new Error('Swap: only the maker accepts a take');
    this._expect([STATES.NEW]);
    const verified = verifyBody(takeBody);
    if (!verified.ok || verified.body.type !== BODY_TYPES.TAKE) throw this._fail(`invalid take (${verified.reason || 'wrong type'})`);
    const take = verified.body;
    const v = validateTake(this.order, take, { now: this.settings.now() });
    if (!v.ok) throw this._fail(v.reason);
    this._state.take = take;
    this._state.takeId = verified.id;
    this._state.quote = quote({ side: this.order.side, premiumPpm: this.order.premiumPpm, feeSats: this.order.feeSats, amountSats: take.amountSats });

    const fields = {
      type: BODY_TYPES.TAKE_ACCEPT,
      orderId: this.orderId,
      takeId: verified.id,
      makerPubkey: this.identityPubkey,
      makerHtlcPubkey: this.htlcPubkey,
      createdAt: this.settings.now()
    };
    if (this.isL1Giver) {
      Object.assign(fields, await this._issueL1GiverTerms(`liquidity-swap:${verified.id}`));
      if (this.order.prepaySats > 0) {
        const prepay = await this.adapters.lightning.createInvoice({
          amountMsat: this.order.prepaySats * 1000,
          label: `liquidity-swap-prepay:${verified.id}`,
          description: 'Fabric L1/L2 swap prepay (non-refundable)',
          expirySeconds: this._invoiceExpirySeconds()
        });
        fields.prepayInvoice = prepay.bolt11;
        this._state.prepayPaymentHash = String(prepay.paymentHash || '').toLowerCase();
      }
    } else {
      await this._checkL1GiverTerms(l1GiverTerms(this.order, take, null));
    }
    const accept = signBody(fields, this._identityKey);
    const ok = validateTakeAccept(this.order, take, accept);
    if (!ok.ok) throw this._fail(ok.reason);
    this._state.accept = accept;
    this._state.terms = l1GiverTerms(this.order, take, accept);
    this._transition(STATES.ACCEPTED);
    return accept;
  }

  /**
   * Taker: apply the maker's signed acceptance.
   * @param {Object} acceptBody
   * @returns {Promise<Swap>}
   */
  async applyAccept (acceptBody) {
    if (this.isMaker) throw new Error('Swap: only the taker applies an accept');
    this._expect([STATES.PROPOSED]);
    const verified = verifyBody(acceptBody);
    if (!verified.ok || verified.body.type !== BODY_TYPES.TAKE_ACCEPT) throw this._fail(`invalid accept (${verified.reason || 'wrong type'})`);
    const accept = verified.body;
    const v = validateTakeAccept(this.order, this._state.take, accept);
    if (!v.ok) throw this._fail(v.reason);
    this._state.accept = accept;
    const terms = l1GiverTerms(this.order, this._state.take, accept);
    if (!this.isL1Giver) {
      await this._checkL1GiverTerms(terms);
      if (terms.prepayInvoice) {
        const decoded = await this.adapters.lightning.decodeInvoice(terms.prepayInvoice);
        if (invoiceAmountMsat(decoded) !== this.order.prepaySats * 1000) throw this._fail('prepay invoice amount does not match the order');
        if (String(decoded.payee || '').toLowerCase() !== this._counterpartyNodeId) throw this._fail('prepay invoice payee is not the maker node');
      }
    }
    this._state.terms = terms;
    this._transition(STATES.ACCEPTED);
    return this;
  }

  /**
   * L2 giver: pay the maker's prepay invoice (orders with `prepaySats`).
   * @returns {Promise<Object>} payment result
   */
  async prepay () {
    this._expect([STATES.ACCEPTED], 'l2Giver');
    if (!this._state.terms.prepayInvoice) throw new Error('Swap: no prepay invoice');
    const result = await this.adapters.lightning.pay(this._state.terms.prepayInvoice);
    this._transition(STATES.PREPAID);
    return result;
  }

  /**
   * L1 giver: fund the HTLC. A maker that asked for a prepay funds only once
   * its node reports the prepay invoice paid. Funding happens at most once:
   * the escrow is recorded before the send, and once the send returns the
   * swap is `l1Funded` (refundable, no longer abortable) even if the funding
   * notice cannot be built — that error is thrown after the transition.
   * @returns {Promise<Object>} signed `LiquiditySwapFunded` body to send
   */
  async fund () {
    this._expect([STATES.ACCEPTED, STATES.PREPAID], 'l1Giver');
    if (this._funding || this._state.fundingStartedAt != null) throw this._fail('HTLC funding already started');
    this._funding = true;
    try {
      return await this._fund();
    } finally {
      this._funding = false;
    }
  }

  /** @private */
  async _fund () {
    if (this._state.prepayPaymentHash && this._state.status === STATES.ACCEPTED) {
      const paid = await this.adapters.lightning.isInvoicePaid(this._state.prepayPaymentHash);
      if (!paid) throw this._fail('prepay not received yet');
      this._transition(STATES.PREPAID);
    }
    const terms = this._state.terms;
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    if (terms.refundLockHeight - tip < this.settings.minClaimBlocks + this.settings.minConfirmations) {
      throw this._fail('refund lock too close to fund safely');
    }
    const escrow = buildEscrow({
      networkName: this.order.network,
      l2GiverPubkeyHex: this._counterpartyHtlcPubkey,
      l1GiverPubkeyHex: this.htlcPubkey,
      paymentHashHex: terms.paymentHashHex,
      refundLockHeight: terms.refundLockHeight,
      amountSats: this._state.quote.l1Sats
    });
    this._state.escrow = escrow;
    this._state.fundingStartedAt = this.settings.now();
    let sent;
    try {
      sent = await this.adapters.bitcoin.fundAddress(escrow.paymentAddress, escrow.amountSats);
    } catch (err) {
      // Adapters reject only when nothing was sent, so funding may be retried.
      this._state.fundingStartedAt = null;
      throw err;
    }
    const txid = (sent && sent.txid) || null;
    const txHex = (sent && sent.txHex) || null;
    this._state.fundingTxid = txid;
    this._state.fundingTxHex = txHex;

    let funded = null;
    let problem = null;
    try {
      let vout = sent && sent.vout;
      if (txHex) {
        const tx = bitcoin.Transaction.fromHex(txHex);
        vout = Htlc.findVout(tx, escrow.paymentAddress, networkForFabricName(this.order.network));
      }
      if (!Number.isInteger(vout) || vout < 0) throw new Error('funding transaction has no HTLC output');
      funded = signBody({
        type: BODY_TYPES.FUNDED,
        takeId: this._state.takeId,
        l1GiverPubkey: this.identityPubkey,
        txid,
        vout,
        paymentAddress: escrow.paymentAddress,
        amountSats: escrow.amountSats,
        createdAt: this.settings.now()
      }, this._identityKey);
    } catch (err) {
      problem = err;
    }
    this._state.funded = funded;
    this._transition(STATES.L1_FUNDED, { txid });
    if (problem) {
      throw this._fail(`HTLC funded but no funding notice (${problem.message}); refund after height ${terms.refundLockHeight}`);
    }
    return funded;
  }

  /**
   * L2 giver: check the L1 giver's funding notice against the chain. Returns
   * `{ ok: false, pending: true }` until the HTLC has `minConfirmations`
   * (call again later); throws when the funding is wrong.
   * @param {Object} fundedBody
   * @returns {Promise<{ ok: boolean, pending: (boolean|undefined), confirmations: number }>}
   */
  async applyFunded (fundedBody) {
    this._expect([STATES.ACCEPTED, STATES.PREPAID], 'l2Giver');
    const verified = verifyBody(fundedBody);
    if (!verified.ok || verified.body.type !== BODY_TYPES.FUNDED) throw this._fail(`invalid funding notice (${verified.reason || 'wrong type'})`);
    const funded = verified.body;
    if (funded.takeId !== this._state.takeId) throw this._fail('funding notice names another take');
    if (funded.l1GiverPubkey !== this._counterpartyPubkey) throw this._fail('funding notice is not from the counterparty');
    if (funded.amountSats !== this._state.quote.l1Sats) throw this._fail('funded amount does not match the take');
    const terms = this._state.terms;
    const check = validateEscrow({
      networkName: this.order.network,
      l2GiverPubkeyHex: this.htlcPubkey,
      l1GiverPubkeyHex: this._counterpartyHtlcPubkey,
      paymentHashHex: terms.paymentHashHex,
      refundLockHeight: terms.refundLockHeight,
      amountSats: this._state.quote.l1Sats,
      paymentAddress: funded.paymentAddress
    });
    if (!check.ok) throw this._fail(check.reason);

    const tx = await this.adapters.bitcoin.getTransaction(funded.txid);
    if (!tx || !tx.txHex) return { ok: false, pending: true, confirmations: 0 };
    const parsed = bitcoin.Transaction.fromHex(tx.txHex);
    if (parsed.getId() !== funded.txid) throw this._fail('funding transaction id mismatch');
    const vout = Htlc.findVout(parsed, check.escrow.paymentAddress, networkForFabricName(this.order.network));
    if (vout !== funded.vout) throw this._fail('funding output is not at the advertised vout');
    if (Number(parsed.outs[vout].value) < funded.amountSats) throw this._fail('HTLC output is smaller than the take');
    const confirmations = Number(tx.confirmations) || 0;
    if (confirmations < this.settings.minConfirmations) return { ok: false, pending: true, confirmations };

    await this._checkInvoice(terms, Number(await this.adapters.bitcoin.getTipHeight()));
    this._state.escrow = check.escrow;
    this._state.funded = funded;
    this._state.fundingTxid = funded.txid;
    this._state.fundingTxHex = tx.txHex;
    this._transition(STATES.L1_FUNDED, { txid: funded.txid });
    return { ok: true, confirmations };
  }

  /**
   * L2 giver: pay the swap invoice and keep the revealed preimage.
   * @returns {Promise<string>} preimage hex
   */
  async payInvoice () {
    this._expect([STATES.L1_FUNDED], 'l2Giver');
    const terms = this._state.terms;
    await this._checkInvoice(terms, Number(await this.adapters.bitcoin.getTipHeight()));
    const result = await this.adapters.lightning.pay(terms.invoice);
    const preimageHex = String((result && result.paymentPreimage) || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(preimageHex) || sha256Hex(Buffer.from(preimageHex, 'hex')) !== terms.paymentHashHex) {
      throw this._fail('payment did not reveal the swap preimage');
    }
    this._state.preimageHex = preimageHex;
    this._transition(STATES.L2_PAID);
    return preimageHex;
  }

  /**
   * L2 giver: claim the HTLC with the preimage.
   * @param {Object} [opts]
   * @param {string} [opts.destinationAddress] defaults to `bitcoin.getNewAddress()`
   * @param {number} [opts.feeSats=1000]
   * @returns {Promise<string>} claim txid
   */
  async claim (opts = {}) {
    this._expect([STATES.L2_PAID], 'l2Giver');
    const escrow = this._state.escrow;
    const destinationAddress = opts.destinationAddress || await this.adapters.bitcoin.getNewAddress();
    const bundle = Htlc.prepareClaimPsbt({
      networkName: this.order.network,
      fundedTxHex: this._state.fundingTxHex,
      paymentAddress: escrow.paymentAddress,
      claimScript: escrow.claimScriptHex,
      refundScript: escrow.refundScriptHex,
      preimage32: Buffer.from(this._state.preimageHex, 'hex'),
      destinationAddress,
      feeSats: opts.feeSats != null ? opts.feeSats : 1000
    });
    const signed = Htlc.signClaim(bundle, this._htlcKey);
    const txid = await this.adapters.bitcoin.broadcast(signed.txHex);
    this._state.claimTxid = txid || signed.txid;
    this._transition(STATES.L1_CLAIMED, { txid: this._state.claimTxid });
    return this._state.claimTxid;
  }

  /**
   * L1 giver: ask the node whether the swap invoice was paid.
   * @returns {Promise<boolean>}
   */
  async checkPaid () {
    this._expect([STATES.L1_FUNDED], 'l1Giver');
    const paid = await this.adapters.lightning.isInvoicePaid(this._state.terms.paymentHashHex);
    if (paid) this._transition(STATES.L2_PAID);
    return Boolean(paid);
  }

  /**
   * L1 giver: note the counterparty's claim transaction (it carries the
   * preimage) and finish.
   * @param {string} txHex
   * @returns {boolean} whether the transaction claims this swap's HTLC
   */
  observeClaim (txHex) {
    this._expect([STATES.L1_FUNDED, STATES.L2_PAID], 'l1Giver');
    const found = Htlc.extractPreimage(txHex, this._state.terms.paymentHashHex);
    if (!found.ok) return false;
    const txid = bitcoin.Transaction.fromHex(txHex).getId();
    this._state.claimTxid = txid;
    this._transition(STATES.L1_CLAIMED, { txid });
    return true;
  }

  /**
   * L1 giver: take the HTLC back after the refund lock when the invoice was
   * never paid.
   * @param {Object} [opts]
   * @param {string} [opts.destinationAddress]
   * @param {number} [opts.feeSats=1000]
   * @returns {Promise<string>} refund txid
   */
  async refund (opts = {}) {
    this._expect([STATES.L1_FUNDED], 'l1Giver');
    const terms = this._state.terms;
    const tip = Number(await this.adapters.bitcoin.getTipHeight());
    if (tip < terms.refundLockHeight) throw this._fail(`refund lock opens at height ${terms.refundLockHeight} (tip ${tip})`);
    const escrow = this._state.escrow;
    let fundedTxHex = this._state.fundingTxHex;
    const fundingTxid = this._state.fundingTxid || (this._state.funded && this._state.funded.txid);
    if (!fundedTxHex && fundingTxid) {
      const tx = await this.adapters.bitcoin.getTransaction(fundingTxid);
      fundedTxHex = tx && tx.txHex;
    }
    if (!fundedTxHex) throw this._fail('funding transaction not found');
    const destinationAddress = opts.destinationAddress || await this.adapters.bitcoin.getNewAddress();
    const bundle = Htlc.prepareRefundPsbt({
      networkName: this.order.network,
      fundedTxHex,
      paymentAddress: escrow.paymentAddress,
      claimScript: escrow.claimScriptHex,
      refundScript: escrow.refundScriptHex,
      refundLocktimeHeight: terms.refundLockHeight,
      destinationAddress,
      feeSats: opts.feeSats != null ? opts.feeSats : 1000
    });
    const signed = Htlc.signRefund(bundle, this._htlcKey);
    const txid = await this.adapters.bitcoin.broadcast(signed.txHex);
    this._state.refundTxid = txid || signed.txid;
    this._transition(STATES.REFUNDED, { txid: this._state.refundTxid });
    return this._state.refundTxid;
  }

  /**
   * Walk away before any L1 funds move.
   * @param {string} [reason]
   */
  abort (reason = 'aborted') {
    this._expect([STATES.NEW, STATES.PROPOSED, STATES.ACCEPTED, STATES.PREPAID]);
    if (this._funding || this._state.fundingStartedAt != null) throw this._fail('HTLC funding already started; refund after the lock instead');
    this._transition(STATES.ABORTED, { reason: String(reason) });
  }

  /**
   * JSON for persistence. The preimage is a secret until the invoice is paid;
   * it is included only with `includeSecrets` (the L1 giver needs it back
   * after a restart). Private keys are never included.
   * @param {Object} [opts]
   * @param {boolean} [opts.includeSecrets=false]
   * @returns {Object}
   */
  toJSON (opts = {}) {
    const s = this._state;
    const out = {
      type: 'Swap',
      version: 1,
      order: this.order,
      orderId: this.orderId,
      role: this.isMaker ? 'maker' : 'taker',
      settlementRole: this.role,
      lightningNodeId: this.lightningNodeId,
      status: s.status,
      take: s.take,
      takeId: s.takeId,
      accept: s.accept,
      funded: s.funded,
      quote: s.quote,
      terms: s.terms,
      escrow: s.escrow,
      prepayPaymentHash: s.prepayPaymentHash,
      fundingStartedAt: s.fundingStartedAt,
      fundingTxid: s.fundingTxid,
      fundingTxHex: s.fundingTxHex,
      claimTxid: s.claimTxid,
      refundTxid: s.refundTxid,
      history: s.history.slice()
    };
    if (opts && opts.includeSecrets) out.preimageHex = s.preimageHex;
    return out;
  }

  /**
   * Restore a swap saved with {@link Swap#toJSON}. The keys must be
   * the ones the saved take / accept were made with, or the swap could not
   * fund, claim, or refund its HTLC.
   * @param {Object} json
   * @param {Object} settings constructor settings (keys, adapters, …) without `order` / `role`
   * @returns {Swap}
   */
  static fromJSON (json, settings = {}) {
    if (!json || json.type !== 'Swap') throw new Error('Swap: not a saved swap');
    const restored = new Swap(Object.assign({}, settings, {
      order: json.order,
      role: json.role,
      lightningNodeId: settings.lightningNodeId || json.lightningNodeId
    }));
    if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, json.status)) throw new Error(`Swap: unknown state ${json.status}`);
    const savedHtlcPubkey = restored.isMaker
      ? (json.accept && json.accept.makerHtlcPubkey)
      : (json.take && json.take.takerHtlcPubkey);
    if (savedHtlcPubkey && savedHtlcPubkey !== restored.htlcPubkey) {
      throw new Error('Swap: htlcKey does not match the saved swap');
    }
    if (!restored.isMaker && json.take && json.take.takerPubkey !== restored.identityPubkey) {
      throw new Error('Swap: identityKey does not match the saved take');
    }
    Object.assign(restored._state, {
      status: json.status,
      take: json.take || null,
      takeId: json.takeId || null,
      accept: json.accept || null,
      funded: json.funded || null,
      quote: json.quote || null,
      terms: json.terms || null,
      escrow: json.escrow || null,
      preimageHex: json.preimageHex || null,
      prepayPaymentHash: json.prepayPaymentHash || null,
      fundingStartedAt: json.fundingStartedAt != null ? json.fundingStartedAt : null,
      fundingTxid: json.fundingTxid || null,
      fundingTxHex: json.fundingTxHex || null,
      claimTxid: json.claimTxid || null,
      refundTxid: json.refundTxid || null,
      history: Array.isArray(json.history) ? json.history.slice() : []
    });
    return restored;
  }

  /**
   * Lightning adapter over `services/lightning` (Core Lightning).
   * @param {Object} lightning a `Lightning` service instance
   * @returns {Object} `{ createInvoice, decodeInvoice, pay, isInvoicePaid }`
   */
  static lightningAdapter (lightning) {
    return {
      async createInvoice ({ amountMsat, label, description, preimageHex, expirySeconds }) {
        const options = {};
        if (preimageHex) options.preimage = preimageHex;
        if (expirySeconds != null) options.expiry = expirySeconds;
        return lightning.createInvoice(amountMsat, label, description, options);
      },
      async decodeInvoice (bolt11) {
        // `decodepay` is deprecated since CLN 24.11; `decode` returns the same bolt11 fields.
        try {
          const decoded = await lightning.callRpc('decode', [bolt11]);
          if (decoded && decoded.valid !== false && decoded.payment_hash) return decoded;
        } catch {}
        return lightning.decodePay(bolt11);
      },
      async pay (bolt11) {
        return lightning.pay(bolt11);
      },
      async isInvoicePaid (paymentHashHex) {
        const result = await lightning.callRpc('listinvoices', { payment_hash: paymentHashHex });
        const invoices = (result && result.invoices) || [];
        return invoices.some((inv) => inv.status === 'paid');
      }
    };
  }

  /**
   * Bitcoin adapter over `services/bitcoin` (bitcoind JSON-RPC, wallet
   * loaded). Reading the counterparty's funding transaction needs it in the
   * mempool or `txindex=1`. `fundAddress` rejects only when `sendtoaddress`
   * fails; once it returns a txid, a failed transaction lookup yields
   * `{ txid, txHex: null }` and the swap reads the transaction by txid later.
   * A timeout on `sendtoaddress` itself still leaves the outcome unknown.
   * @param {Object} service a `Bitcoin` service instance
   * @param {Object} [options]
   * @param {String} [options.wallet] named bitcoind wallet for funding and addresses (default: the node's default wallet)
   * @returns {Object} `{ getTipHeight, fundAddress, getTransaction, broadcast, getNewAddress }`
   */
  static bitcoinAdapter (service, options = {}) {
    const wallet = options && options.wallet;
    const rpc = (method, params = []) => service._makeRPCRequest(method, params);
    const walletRpc = (method, params = []) => (wallet
      ? service._makeWalletRequest(method, params, wallet)
      : rpc(method, params));
    return {
      async getTipHeight () {
        return Number(await rpc('getblockcount'));
      },
      async fundAddress (address, amountSats) {
        const txid = await walletRpc('sendtoaddress', [address, Number((amountSats / 1e8).toFixed(8))]);
        // The coins have moved: a failed lookup must not reject, or `fund`
        // would let the send be retried and pay the HTLC twice.
        let txHex = null;
        try {
          const tx = await walletRpc('gettransaction', [txid]);
          txHex = (tx && tx.hex) || null;
        } catch {}
        return { txid, txHex };
      },
      async getTransaction (txid) {
        try {
          const tx = await rpc('getrawtransaction', [txid, true]);
          return { txHex: tx.hex, confirmations: Number(tx.confirmations) || 0 };
        } catch {
          return null;
        }
      },
      async broadcast (txHex) {
        return rpc('sendrawtransaction', [txHex]);
      },
      async getNewAddress () {
        return walletRpc('getnewaddress', ['', 'bech32m']);
      }
    };
  }
}

Object.assign(Swap, {
  INSTRUMENT,
  BODY_VERSION,
  BODY_TYPES,
  SIDES,
  PPM,
  MAX_PREMIUM_PPM,
  MIN_REFUND_LOCK_BLOCKS,
  MAX_REFUND_LOCK_BLOCKS,
  DEFAULT_MIN_CLAIM_BLOCKS,
  DEFAULT_MIN_CONFIRMATIONS,
  DEFAULT_INVOICE_MARGIN_SECONDS,
  DEFAULT_SECONDS_PER_BLOCK,
  MIN_INVOICE_EXPIRY_SECONDS,
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
  roles,
  roleFor,
  quote,
  buildEscrow,
  validateEscrow,
  invoiceAmountMsat,
  validateInvoice,
  validateTake,
  validateTakeAccept,
  l1GiverTerms
});

module.exports = Swap;
module.exports.Swap = Swap;
