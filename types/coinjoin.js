'use strict';

/**
 * @fileoverview L1:L1 coinjoin market. Makers gossip signed
 * `CoinjoinOffer` bodies offering their UTXOs for a fee; a taker picks
 * several makers and builds **one** transaction in which every participant
 * receives an output of the same `amountSats` (plus change), so observers
 * cannot tell which input paid which equal output. The transaction is valid
 * only once every party has signed, so nobody is committed before anyone
 * else and there is no free option; a maker who stalls is dropped and the
 * round rebuilt. PoDLE commitments (`Coinjoin.generatePodle`, after
 * JoinMarket) stop takers from opening rounds just to learn maker UTXOs, and
 * fidelity bonds ({@link Bond}) let takers weight makers by locked capital.
 *
 * Every input and output is P2TR key-path, the transaction is version 2
 * with `nLockTime` at the chain tip, and inputs / outputs are BIP-69 sorted.
 *
 * Bodies travel as `CONTRACT_MESSAGE` JSON. Offers and cancels are public;
 * round messages (`CoinjoinFill` … `CoinjoinSig`) are sealed to the
 * counterparty with `Coinjoin.sealRoundMessage`. Each body is BIP340-signed by
 * its author over the canonical body without `signature`.
 *
 * PoDLE: `P = q·G` is a taker UTXO's (even-y) output key, `J_i` a
 * nothing-up-my-sleeve generator for index `i` (0–2), `P2 = q·J_i`, and the
 * commitment `SHA256(P2)`. The reveal names the UTXO and carries `P`, `P2`,
 * and a DLEQ proof that `log_G(P) = log_J(P2)`. Each UTXO yields only
 * `PODLE_MAX_INDEX` commitments and makers remember used ones
 * (`Coinjoin.PodleBlacklist`), so a taker who aborts rounds to learn maker
 * UTXOs burns its own coins' tries. See `docs/COINJOIN_MARKET.md`.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const bitcoin = require('bitcoinjs-lib');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const ecc = require('./ecc');
const SignedBook = require('./signedBook');
const Bond = require('./bond');
const { sortInputs, sortOutputs } = require('../functions/bip69');
const { BIP125_SEQUENCE_LOCKTIME_ONLY } = require('../functions/bip125');
const { networkForFabricName } = require('./policy');
const groupChatSeal = require('../functions/groupChatSeal');
const { pubkeyXOnly } = require('../functions/pubkey');
const { MAX_MESSAGE_SIZE } = require('../constants');

bitcoin.initEccLib(ecc);

const BODY_VERSION = 1;
const SCRIPT_TYPE = 'p2tr';
const PPM = 1000000;
/** Highest proportional maker fee an offer may ask: 5%. */
const MAX_FEE_PPM = 50000;
/** Smallest coinjoin amount. */
const MIN_COINJOIN_SATS = 10000;
/** P2TR dust limit: change below this is dropped (it goes to miners). */
const DUST_SATS = 330;
/** Most makers in one round. */
const MAX_MAKERS = 20;
/** Most inputs one maker may contribute. */
const MAX_MAKER_INPUTS = 20;
const DEFAULT_MIN_MAKERS = 2;
/** Fewest equal outputs a maker accepts as a coinjoin (taker + one maker). */
const DEFAULT_MIN_EQUAL_OUTPUTS = 2;
/**
 * Largest PSBT (base64 characters) a round message may carry: sealed, it must
 * still fit one `CONTRACT_MESSAGE` under `MAX_MESSAGE_SIZE` (32 KiB).
 */
const MAX_PSBT_CHARS = 22000;
/** Contract namespace for sealed round messages and `CONTRACT_MESSAGE` bodies. */
const SEAL_NAMESPACE = 'fabric/coinjoin/v1';
/** Body type of a sealed round message. */
const SEALED_TYPE = 'CoinjoinSealed';
const OWNERSHIP_TAG = 'fabric/coinjoin/ownership/v1';

/** Transaction weight, in weight units: overhead, P2TR key-path input, P2TR output. */
const WEIGHT_OVERHEAD = 42;
const WEIGHT_P2TR_INPUT = 230;
const WEIGHT_P2TR_OUTPUT = 172;

const BODY_TYPES = Object.freeze({
  OFFER: 'CoinjoinOffer',
  CANCEL: 'CoinjoinOfferCancel',
  FILL: 'CoinjoinFill',
  FILL_ACK: 'CoinjoinFillAck',
  AUTH: 'CoinjoinAuth',
  IOAUTH: 'CoinjoinIoAuth',
  TX: 'CoinjoinTx',
  SIG: 'CoinjoinSig'
});

/** Which field carries each body's author key. */
const SIGNER_FIELD = Object.freeze({
  [BODY_TYPES.OFFER]: 'makerPubkey',
  [BODY_TYPES.CANCEL]: 'makerPubkey',
  [BODY_TYPES.FILL]: 'takerPubkey',
  [BODY_TYPES.FILL_ACK]: 'makerPubkey',
  [BODY_TYPES.AUTH]: 'takerPubkey',
  [BODY_TYPES.IOAUTH]: 'makerPubkey',
  [BODY_TYPES.TX]: 'takerPubkey',
  [BODY_TYPES.SIG]: 'makerPubkey'
});

/** Round messages: sealed between taker and maker, never gossiped. */
const ROUND_TYPES = Object.freeze([
  BODY_TYPES.FILL,
  BODY_TYPES.FILL_ACK,
  BODY_TYPES.AUTH,
  BODY_TYPES.IOAUTH,
  BODY_TYPES.TX,
  BODY_TYPES.SIG
]);

/** @private */
function fail (message) {
  throw new Error(`coinjoin: ${message}`);
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
function stringOf (label, value, maxLength) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > maxLength) fail(`${label} must be a non-empty string of at most ${maxLength} characters`);
  return s;
}

/** @private */
function timeOf (label, value) {
  return intOf(label, value, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * P2TR scriptPubKey (`OP_1 <32 bytes>`) as lowercase hex.
 * @private
 */
function p2trScriptOf (label, value) {
  const s = hexOf(label, value, 34);
  if (!s.startsWith('5120')) fail(`${label} must be a P2TR scriptPubKey`);
  return s;
}

/** @private */
function psbtOf (value) {
  const s = stringOf('psbt', value, MAX_PSBT_CHARS);
  if (!/^[A-Za-z0-9+/]+=*$/.test(s)) fail('psbt must be base64');
  return s;
}

/** @private */
function withSignature (body, signature) {
  if (signature != null && signature !== '') body.signature = hexOf('signature', signature, 64);
  return body;
}

/** @returns {string} 32 random bytes as hex */
function randomRoundId () {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinOffer` body (keeps `signature`)
 */
function normalizeOffer (input = {}) {
  const minSats = intOf('minSats', input.minSats, MIN_COINJOIN_SATS, Number.MAX_SAFE_INTEGER);
  const maxSats = intOf('maxSats', input.maxSats, minSats, Number.MAX_SAFE_INTEGER);
  const body = {
    type: BODY_TYPES.OFFER,
    version: BODY_VERSION,
    network: stringOf('network', input.network, 32).toLowerCase(),
    scriptType: SCRIPT_TYPE,
    minSats,
    maxSats,
    feeSats: intOf('feeSats', input.feeSats || 0, 0, minSats),
    feePpm: intOf('feePpm', input.feePpm || 0, 0, MAX_FEE_PPM),
    txFeeContributionSats: intOf('txFeeContributionSats', input.txFeeContributionSats || 0, 0, minSats),
    createdAt: timeOf('createdAt', input.createdAt),
    expiresAt: intOf('expiresAt', input.expiresAt, 1, Number.MAX_SAFE_INTEGER),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    nonce: nonceOf(input.nonce)
  };
  if (input.scriptType != null && input.scriptType !== SCRIPT_TYPE) fail(`scriptType must be ${SCRIPT_TYPE}`);
  if (body.expiresAt <= body.createdAt) fail('expiresAt must be after createdAt');
  if (input.fidelityBond != null) body.fidelityBond = Bond.normalizeFidelity(input.fidelityBond);
  return withSignature(body, input.signature);
}

/**
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinOfferCancel` body
 */
function normalizeCancel (input = {}) {
  const body = {
    type: BODY_TYPES.CANCEL,
    version: BODY_VERSION,
    offerId: hexOf('offerId', input.offerId, 32),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    createdAt: timeOf('createdAt', input.createdAt)
  };
  return withSignature(body, input.signature);
}

/**
 * Taker → maker: fill `amountSats` of an offer. `takerPubkey` is a fresh key
 * for this round only (it signs the taker's bodies and receives sealed
 * replies), so makers never learn the taker's identity.
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinFill` body
 */
function normalizeFill (input = {}) {
  const body = {
    type: BODY_TYPES.FILL,
    version: BODY_VERSION,
    offerId: hexOf('offerId', input.offerId, 32),
    roundId: hexOf('roundId', input.roundId, 32),
    amountSats: intOf('amountSats', input.amountSats, MIN_COINJOIN_SATS, Number.MAX_SAFE_INTEGER),
    commitment: hexOf('commitment', input.commitment, 32),
    takerPubkey: pubkeyOf('takerPubkey', input.takerPubkey),
    createdAt: timeOf('createdAt', input.createdAt),
    nonce: nonceOf(input.nonce)
  };
  return withSignature(body, input.signature);
}

/**
 * Maker → taker: the fill is accepted; `sealPubkey` receives the rest of the
 * round.
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinFillAck` body
 */
function normalizeFillAck (input = {}) {
  const body = {
    type: BODY_TYPES.FILL_ACK,
    version: BODY_VERSION,
    offerId: hexOf('offerId', input.offerId, 32),
    roundId: hexOf('roundId', input.roundId, 32),
    fillId: hexOf('fillId', input.fillId, 32),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    sealPubkey: pubkeyOf('sealPubkey', input.sealPubkey),
    createdAt: timeOf('createdAt', input.createdAt)
  };
  return withSignature(body, input.signature);
}

/** @private */
function revealOf (input = {}) {
  return {
    txid: hexOf('reveal.txid', input.txid, 32),
    vout: intOf('reveal.vout', input.vout, 0, 0xffffffff),
    index: intOf('reveal.index', input.index, 0, 255),
    P: pubkeyOf('reveal.P', input.P),
    P2: pubkeyOf('reveal.P2', input.P2),
    e: hexOf('reveal.e', input.e, 32),
    s: hexOf('reveal.s', input.s, 32)
  };
}

/**
 * Taker → maker: open the PoDLE commitment named in the fill.
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinAuth` body
 */
function normalizeAuth (input = {}) {
  const body = {
    type: BODY_TYPES.AUTH,
    version: BODY_VERSION,
    roundId: hexOf('roundId', input.roundId, 32),
    fillId: hexOf('fillId', input.fillId, 32),
    takerPubkey: pubkeyOf('takerPubkey', input.takerPubkey),
    reveal: revealOf(input.reveal),
    createdAt: timeOf('createdAt', input.createdAt)
  };
  return withSignature(body, input.signature);
}

/** @private */
function makerInputOf (input = {}, i) {
  const row = {
    txid: hexOf(`inputs[${i}].txid`, input.txid, 32),
    vout: intOf(`inputs[${i}].vout`, input.vout, 0, 0xffffffff),
    valueSats: intOf(`inputs[${i}].valueSats`, input.valueSats, 1, Number.MAX_SAFE_INTEGER),
    scriptPubKeyHex: p2trScriptOf(`inputs[${i}].scriptPubKeyHex`, input.scriptPubKeyHex)
  };
  if (input.ownershipSig != null && input.ownershipSig !== '') {
    row.ownershipSig = hexOf(`inputs[${i}].ownershipSig`, input.ownershipSig, 64);
  }
  return row;
}

/**
 * Maker → taker: the maker's inputs and where it wants its coinjoin output
 * and change. Inputs may carry an `ownershipSig` ({@link signOwnership}).
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinIoAuth` body
 */
function normalizeIoAuth (input = {}) {
  if (!Array.isArray(input.inputs) || !input.inputs.length || input.inputs.length > MAX_MAKER_INPUTS) {
    fail(`inputs must list 1-${MAX_MAKER_INPUTS} UTXOs`);
  }
  const body = {
    type: BODY_TYPES.IOAUTH,
    version: BODY_VERSION,
    roundId: hexOf('roundId', input.roundId, 32),
    fillId: hexOf('fillId', input.fillId, 32),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    inputs: input.inputs.map(makerInputOf),
    coinjoinScriptHex: p2trScriptOf('coinjoinScriptHex', input.coinjoinScriptHex),
    changeScriptHex: p2trScriptOf('changeScriptHex', input.changeScriptHex),
    createdAt: timeOf('createdAt', input.createdAt)
  };
  if (body.coinjoinScriptHex === body.changeScriptHex) fail('coinjoin and change scripts must differ');
  const seen = new Set();
  for (const row of body.inputs) {
    const key = `${row.txid}:${row.vout}`;
    if (seen.has(key)) fail('inputs repeat a UTXO');
    seen.add(key);
  }
  return withSignature(body, input.signature);
}

/**
 * Taker → maker: the unsigned transaction.
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinTx` body
 */
function normalizeTx (input = {}) {
  const body = {
    type: BODY_TYPES.TX,
    version: BODY_VERSION,
    roundId: hexOf('roundId', input.roundId, 32),
    takerPubkey: pubkeyOf('takerPubkey', input.takerPubkey),
    psbt: psbtOf(input.psbt),
    createdAt: timeOf('createdAt', input.createdAt)
  };
  return withSignature(body, input.signature);
}

/**
 * Maker → taker: the transaction with the maker's inputs signed.
 * @param {Object} input
 * @returns {Object} normalized `CoinjoinSig` body
 */
function normalizeSig (input = {}) {
  const body = {
    type: BODY_TYPES.SIG,
    version: BODY_VERSION,
    roundId: hexOf('roundId', input.roundId, 32),
    fillId: hexOf('fillId', input.fillId, 32),
    makerPubkey: pubkeyOf('makerPubkey', input.makerPubkey),
    psbt: psbtOf(input.psbt),
    createdAt: timeOf('createdAt', input.createdAt)
  };
  return withSignature(body, input.signature);
}

// A Map, so a remote `type` such as `toString` never reaches an inherited method.
const NORMALIZERS = new Map([
  [BODY_TYPES.OFFER, normalizeOffer],
  [BODY_TYPES.CANCEL, normalizeCancel],
  [BODY_TYPES.FILL, normalizeFill],
  [BODY_TYPES.FILL_ACK, normalizeFillAck],
  [BODY_TYPES.AUTH, normalizeAuth],
  [BODY_TYPES.IOAUTH, normalizeIoAuth],
  [BODY_TYPES.TX, normalizeTx],
  [BODY_TYPES.SIG, normalizeSig]
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
  name: 'coinjoin',
  version: BODY_VERSION,
  normalizers: NORMALIZERS,
  signerField: SIGNER_FIELD
});

/** @private */
function privOf (signer) {
  const priv = Buffer.isBuffer(signer) || signer instanceof Uint8Array
    ? Buffer.from(signer)
    : Buffer.from(hexOf('private key', signer, 32), 'hex');
  if (priv.length !== 32 || !ecc.isPrivate(priv)) fail('invalid private key');
  return priv;
}

/** @returns {Buffer} a random valid private key */
function randomPrivateKey () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

/**
 * Seal a signed round message to its recipient (participant ECDH seal).
 * @param {Object} body signed round body
 * @param {string} recipientPubkey compressed or x-only
 * @returns {{ type: 'CoinjoinSealed', version: number, to: string, seal: Object }}
 */
function sealRoundMessage (body, recipientPubkey) {
  const normalized = fromBody(body);
  if (!normalized || !ROUND_TYPES.includes(normalized.type)) fail('only round messages are sealed');
  if (!normalized.signature) fail('seal a signed body');
  const to = pubkeyXOnly(recipientPubkey);
  if (!to) fail('recipient must be a public key');
  const seal = groupChatSeal.sealParticipantGroupChatBody({
    body: JSON.stringify(normalized),
    memberPubkeys: [to],
    contractId: SEAL_NAMESPACE
  });
  return { type: SEALED_TYPE, version: BODY_VERSION, to, seal };
}

/** @private */
function isSealedEnvelope (value) {
  return !!value && value.type === SEALED_TYPE && Number(value.version) === BODY_VERSION &&
    /^[0-9a-f]{64}$/.test(String(value.to || '')) && !!value.seal && typeof value.seal === 'object';
}

/**
 * Wrap a public body (offer, cancel) or a sealed round envelope as a
 * `CONTRACT_MESSAGE` body: `buildMessage('CONTRACT_MESSAGE', toContractMessage(x))`.
 * Round bodies must be sealed first.
 * @param {Object} value signed offer / cancel, or {@link sealRoundMessage} output
 * @returns {Object} `{ contract: SEAL_NAMESPACE, ...value }`
 */
function toContractMessage (value) {
  let inner;
  if (isSealedEnvelope(value)) {
    inner = { type: SEALED_TYPE, version: BODY_VERSION, to: value.to, seal: value.seal };
  } else {
    const normalized = fromBody(value);
    if (!normalized || ROUND_TYPES.includes(normalized.type)) fail('only offers, cancels, and sealed envelopes go on the wire');
    if (!normalized.signature) fail('sign the body before sending it');
    inner = normalized;
  }
  const out = Object.assign({ contract: SEAL_NAMESPACE }, inner);
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_MESSAGE_SIZE) fail('coinjoin message exceeds MAX_MESSAGE_SIZE');
  return out;
}

/**
 * Read a coinjoin `CONTRACT_MESSAGE` body (the parsed legacy JSON). Public
 * bodies are verified; sealed envelopes are returned for
 * {@link openRoundMessage} (or for relaying when `to` is not ours).
 * Unsealed round bodies and other contracts return `null`.
 * @param {Object} value
 * @returns {({ kind: 'offer'|'cancel', body: Object, id: string }|{ kind: 'sealed', envelope: Object, to: string }|null)}
 */
function fromContractMessage (value) {
  if (!value || typeof value !== 'object' || value.contract !== SEAL_NAMESPACE) return null;
  const rest = Object.assign({}, value);
  delete rest.contract;
  if (rest.type === SEALED_TYPE) {
    return isSealedEnvelope(rest) ? { kind: 'sealed', envelope: rest, to: rest.to } : null;
  }
  if (rest.type !== BODY_TYPES.OFFER && rest.type !== BODY_TYPES.CANCEL) return null;
  const verified = verifyBody(rest);
  if (!verified.ok) return null;
  return { kind: rest.type === BODY_TYPES.OFFER ? 'offer' : 'cancel', body: verified.body, id: verified.id };
}

/**
 * Open a sealed round message with the recipient's private key and verify
 * the body inside.
 * @param {Object} envelope {@link sealRoundMessage} output
 * @param {Buffer|string} privateKey
 * @returns {{ ok: boolean, reason: (string|null), body: (Object|null), id: (string|null) }}
 */
function openRoundMessage (envelope, privateKey) {
  if (!envelope || envelope.type !== SEALED_TYPE || !envelope.seal) {
    return { ok: false, reason: 'not a sealed coinjoin message', body: null, id: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(groupChatSeal.openParticipantGroupChatBody(envelope.seal, { keyOrPrivate: privOf(privateKey) }));
  } catch (err) {
    return { ok: false, reason: `cannot open: ${err.message}`, body: null, id: null };
  }
  if (!parsed || !ROUND_TYPES.includes(parsed.type)) return { ok: false, reason: 'sealed body is not a round message', body: null, id: null };
  return verifyBody(parsed);
}

/**
 * The maker's fee for a coinjoin of `amountSats`: `feeSats + ⌊amount × feePpm / 1e6⌋`.
 * @param {Object} offer
 * @param {number} amountSats
 * @returns {number}
 */
function makerFee (offer, amountSats) {
  const amount = intOf('amountSats', amountSats, 1, Number.MAX_SAFE_INTEGER);
  const ppm = BigInt(intOf('feePpm', offer.feePpm || 0, 0, MAX_FEE_PPM));
  return intOf('feeSats', offer.feeSats || 0, 0, Number.MAX_SAFE_INTEGER) +
    Number((BigInt(amount) * ppm) / BigInt(PPM));
}

/**
 * Change owed to a maker: its inputs, less the coinjoin output, plus its
 * fee, less its miner-fee contribution. Change under {@link DUST_SATS} is
 * not paid (0).
 * @param {Object} opts
 * @param {number} opts.inputSats sum of the maker's inputs
 * @param {number} opts.amountSats
 * @param {number} opts.cjfeeSats
 * @param {number} [opts.txFeeContributionSats=0]
 * @returns {number}
 */
function makerChange (opts = {}) {
  const change = Number(opts.inputSats) - Number(opts.amountSats) + Number(opts.cjfeeSats) - Number(opts.txFeeContributionSats || 0);
  if (!Number.isSafeInteger(change)) fail('change is not a safe integer');
  if (change < 0) fail('maker inputs do not cover the coinjoin amount');
  return change < DUST_SATS ? 0 : change;
}

/**
 * Virtual size of a transaction with only P2TR key-path inputs and P2TR outputs.
 * @param {number} inputs
 * @param {number} outputs
 * @returns {number}
 */
function estimateVsize (inputs, outputs) {
  return Math.ceil((WEIGHT_OVERHEAD + (WEIGHT_P2TR_INPUT * inputs) + (WEIGHT_P2TR_OUTPUT * outputs)) / 4);
}

/** @private */
function sumInputs (inputs) {
  return inputs.reduce((total, row) => total + Number(row.valueSats), 0);
}

/** @private */
function takerSideOf (taker = {}) {
  if (!Array.isArray(taker.inputs) || !taker.inputs.length) fail('taker needs inputs');
  return {
    inputs: taker.inputs.map(makerInputOf),
    coinjoinScriptHex: p2trScriptOf('taker.coinjoinScriptHex', taker.coinjoinScriptHex),
    changeScriptHex: p2trScriptOf('taker.changeScriptHex', taker.changeScriptHex)
  };
}

/** @private */
function makerSideOf (maker = {}, amountSats) {
  if (!maker.offer) fail('maker needs its offer');
  const offer = normalizeOffer(maker.offer);
  if (amountSats < offer.minSats || amountSats > offer.maxSats) fail('amount outside a maker offer');
  if (!Array.isArray(maker.inputs) || !maker.inputs.length) fail('maker needs inputs');
  const inputs = maker.inputs.map(makerInputOf);
  const cjfeeSats = makerFee(offer, amountSats);
  const changeSats = makerChange({
    inputSats: sumInputs(inputs),
    amountSats,
    cjfeeSats,
    txFeeContributionSats: offer.txFeeContributionSats
  });
  return {
    id: maker.id != null ? String(maker.id) : null,
    offer,
    inputs,
    coinjoinScriptHex: p2trScriptOf('maker.coinjoinScriptHex', maker.coinjoinScriptHex),
    changeScriptHex: p2trScriptOf('maker.changeScriptHex', maker.changeScriptHex),
    cjfeeSats,
    changeSats,
    txFeeContributionSats: offer.txFeeContributionSats
  };
}

/**
 * Outputs and fees for a round. Makers are paid exactly their offer's fee;
 * the taker pays the miner fee less the makers' contributions, and takes
 * what is left as change (dropped below dust).
 * @param {Object} opts
 * @param {number} opts.amountSats
 * @param {number} opts.feeRateSatVb
 * @param {Object} opts.taker `{ inputs, coinjoinScriptHex, changeScriptHex }`
 * @param {Object[]} opts.makers `{ id, offer, inputs, coinjoinScriptHex, changeScriptHex }`
 * @param {number} [opts.minMakers=2]
 * @returns {Object} plan `{ amountSats, inputs, outputs, minerFeeSats, vsize, feeRateSatVb, takerChangeSats, totalMakerFeesSats, makers }`
 */
function planCoinjoin (opts = {}) {
  const amountSats = intOf('amountSats', opts.amountSats, MIN_COINJOIN_SATS, Number.MAX_SAFE_INTEGER);
  const feeRate = Number(opts.feeRateSatVb);
  if (!Number.isFinite(feeRate) || feeRate <= 0 || feeRate > 10000) fail('feeRateSatVb must be in (0, 10000]');
  const minMakers = opts.minMakers != null ? Number(opts.minMakers) : DEFAULT_MIN_MAKERS;
  const taker = takerSideOf(opts.taker);
  const makers = (opts.makers || []).map((m) => makerSideOf(m, amountSats));
  if (makers.length < minMakers) fail(`need at least ${minMakers} makers`);
  if (makers.length > MAX_MAKERS) fail(`at most ${MAX_MAKERS} makers`);
  const makerKeys = new Set(makers.map((m) => m.offer.makerPubkey));
  if (makerKeys.size !== makers.length) fail('one maker appears twice');

  const inputs = taker.inputs.concat(...makers.map((m) => m.inputs));
  const seenInputs = new Set();
  for (const row of inputs) {
    const key = `${row.txid}:${row.vout}`;
    if (seenInputs.has(key)) fail(`input ${key} is offered twice`);
    seenInputs.add(key);
  }

  const outputs = [{ role: 'taker', kind: 'coinjoin', scriptHex: taker.coinjoinScriptHex, valueSats: amountSats }];
  for (const m of makers) {
    outputs.push({ role: 'maker', id: m.id, kind: 'coinjoin', scriptHex: m.coinjoinScriptHex, valueSats: amountSats });
    if (m.changeSats > 0) outputs.push({ role: 'maker', id: m.id, kind: 'change', scriptHex: m.changeScriptHex, valueSats: m.changeSats });
  }
  const totalMakerFeesSats = makers.reduce((t, m) => t + m.cjfeeSats, 0);
  const contributions = makers.reduce((t, m) => t + m.txFeeContributionSats, 0);
  const takerIn = sumInputs(taker.inputs);

  const takerChangeFor = (outputCount) => {
    const vsize = estimateVsize(inputs.length, outputCount);
    const minerFeeSats = Math.ceil(vsize * feeRate);
    const takerPays = Math.max(0, minerFeeSats - contributions);
    return { vsize, minerFeeSats, change: takerIn - amountSats - totalMakerFeesSats - takerPays };
  };
  let sized = takerChangeFor(outputs.length + 1);
  let takerChangeSats = sized.change;
  if (takerChangeSats < DUST_SATS) {
    sized = takerChangeFor(outputs.length);
    if (sized.change < 0) fail('taker inputs do not cover the amount, maker fees, and miner fee');
    takerChangeSats = 0;
  } else {
    outputs.push({ role: 'taker', kind: 'change', scriptHex: taker.changeScriptHex, valueSats: takerChangeSats });
  }

  const scripts = new Set();
  for (const out of outputs) {
    if (scripts.has(out.scriptHex)) fail('an output script is reused');
    scripts.add(out.scriptHex);
  }
  const totalOut = outputs.reduce((t, o) => t + o.valueSats, 0);
  const totalIn = sumInputs(inputs);
  return {
    amountSats,
    inputs,
    outputs,
    minerFeeSats: totalIn - totalOut,
    vsize: sized.vsize,
    feeRateSatVb: feeRate,
    takerChangeSats,
    totalMakerFeesSats,
    makers: makers.map((m) => ({
      id: m.id,
      makerPubkey: m.offer.makerPubkey,
      cjfeeSats: m.cjfeeSats,
      changeSats: m.changeSats,
      txFeeContributionSats: m.txFeeContributionSats
    }))
  };
}

/**
 * Build the unsigned coinjoin PSBT (version 2, BIP-69, `nLockTime` = tip,
 * sequence `0xfffffffe`, witness UTXOs on every input).
 * @param {Object} opts {@link planCoinjoin} options plus:
 * @param {string} [opts.networkName='regtest']
 * @param {number} opts.lockTime current tip height (anti fee sniping)
 * @returns {{ psbtBase64: string, unsignedTxid: string, plan: Object }}
 */
function buildPsbt (opts = {}) {
  const plan = planCoinjoin(opts);
  const lockTime = intOf('lockTime', opts.lockTime, 0, 499999999);
  const network = networkForFabricName(opts.networkName || 'regtest');
  const psbt = new bitcoin.Psbt({ network });
  psbt.setVersion(2);
  psbt.setLocktime(lockTime);
  for (const row of sortInputs(plan.inputs)) {
    psbt.addInput({
      hash: row.txid,
      index: row.vout,
      sequence: BIP125_SEQUENCE_LOCKTIME_ONLY,
      witnessUtxo: { script: Buffer.from(row.scriptPubKeyHex, 'hex'), value: BigInt(row.valueSats) }
    });
  }
  const outs = plan.outputs.map((o) => ({ script: Buffer.from(o.scriptHex, 'hex'), value: o.valueSats }));
  for (const out of sortOutputs(outs)) {
    psbt.addOutput({ script: out.script, value: BigInt(out.value) });
  }
  const psbtBase64 = psbt.toBase64();
  // Half the cap: signatures and wallet metadata roughly double a PSBT.
  if (psbtBase64.length > MAX_PSBT_CHARS / 2) fail('coinjoin too large for one round message; use fewer makers or inputs');
  return { psbtBase64, unsignedTxid: unsignedTxidOf(psbt), plan };
}

/** @private */
function psbtFrom (psbtBase64) {
  try {
    return bitcoin.Psbt.fromBase64(String(psbtBase64 || ''));
  } catch (err) {
    return fail(`invalid PSBT (${err.message})`);
  }
}

/** @private */
function unsignedTxidOf (psbt) {
  return psbt.data.globalMap.unsignedTx.tx.getId();
}

/**
 * The id the transaction will have (key-path spends do not change it).
 * @param {string} psbtBase64
 * @returns {string}
 */
function unsignedTxid (psbtBase64) {
  return unsignedTxidOf(psbtFrom(psbtBase64));
}

/**
 * Inputs and outputs of a PSBT as plain rows.
 * @param {string} psbtBase64
 * @returns {{ version: number, lockTime: number, inputs: Object[], outputs: Object[], unsignedTxid: string }}
 */
function describePsbt (psbtBase64) {
  const psbt = psbtFrom(psbtBase64);
  const tx = psbt.data.globalMap.unsignedTx.tx;
  const inputs = psbt.txInputs.map((input, i) => {
    const data = psbt.data.inputs[i];
    const utxo = data.witnessUtxo;
    return {
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
      sequence: input.sequence,
      valueSats: utxo ? Number(utxo.value) : null,
      scriptPubKeyHex: utxo ? Buffer.from(utxo.script).toString('hex') : null,
      sighashType: data.sighashType != null ? data.sighashType : null,
      signed: Boolean(data.tapKeySig || data.finalScriptWitness)
    };
  });
  const outputs = psbt.txOutputs.map((out) => ({
    scriptHex: Buffer.from(out.script).toString('hex'),
    valueSats: Number(out.value)
  }));
  return { version: tx.version, lockTime: tx.locktime, inputs, outputs, unsignedTxid: tx.getId() };
}

/** @private */
function isP2trScript (hex) {
  return typeof hex === 'string' && /^5120[0-9a-f]{64}$/.test(hex);
}

/**
 * Everything a maker must see before signing. It refuses unless its inputs
 * are present with the values it named, its coinjoin output pays exactly
 * `amountSats`, its change is at least what its offer earns, at least
 * `minEqualOutputs` outputs share the coinjoin amount, every input and output
 * is P2TR, and nothing else pays the maker's scripts.
 * @param {Object} opts
 * @param {string} opts.psbtBase64
 * @param {number} opts.amountSats
 * @param {Object} opts.offer the maker's offer
 * @param {Object[]} opts.inputs the maker's inputs (`CoinjoinIoAuth.inputs`)
 * @param {string} opts.coinjoinScriptHex
 * @param {string} opts.changeScriptHex
 * @param {number} [opts.minEqualOutputs=2]
 * @param {number} [opts.lockTimeMax] refuse an `nLockTime` above this height
 * @returns {{ ok: boolean, reason: (string|null), cjfeeSats: (number|null), expectedChangeSats: (number|null), inputIndexes: number[] }}
 */
function validateForMaker (opts = {}) {
  const bad = (reason) => ({ ok: false, reason, cjfeeSats: null, expectedChangeSats: null, inputIndexes: [] });
  let tx;
  try {
    tx = describePsbt(opts.psbtBase64);
  } catch (err) {
    return bad(err.message);
  }
  let amountSats;
  let cjfeeSats;
  let expectedChangeSats;
  let own;
  try {
    amountSats = intOf('amountSats', opts.amountSats, MIN_COINJOIN_SATS, Number.MAX_SAFE_INTEGER);
    const offer = normalizeOffer(opts.offer);
    if (amountSats < offer.minSats || amountSats > offer.maxSats) return bad('amount outside the offer');
    own = (opts.inputs || []).map(makerInputOf);
    if (!own.length) return bad('no maker inputs');
    cjfeeSats = makerFee(offer, amountSats);
    expectedChangeSats = makerChange({
      inputSats: sumInputs(own),
      amountSats,
      cjfeeSats,
      txFeeContributionSats: offer.txFeeContributionSats
    });
  } catch (err) {
    return bad(err.message);
  }
  const cjScript = String(opts.coinjoinScriptHex || '').toLowerCase();
  const changeScript = String(opts.changeScriptHex || '').toLowerCase();
  if (!isP2trScript(cjScript) || !isP2trScript(changeScript)) return bad('maker scripts must be P2TR');

  if (tx.version !== 2) return bad('transaction version must be 2');
  if (opts.lockTimeMax != null && tx.lockTime > Number(opts.lockTimeMax)) return bad('nLockTime is in the future');
  for (const input of tx.inputs) {
    if (!isP2trScript(input.scriptPubKeyHex)) return bad('every input must be P2TR with a witness UTXO');
    if (input.sighashType != null && input.sighashType !== 0 && input.sighashType !== 1) return bad('inputs must sign SIGHASH_DEFAULT or SIGHASH_ALL');
  }
  const inputIndexes = [];
  for (const mine of own) {
    const matches = tx.inputs.map((row, i) => [row, i]).filter(([row]) => row.txid === mine.txid && row.vout === mine.vout);
    if (matches.length !== 1) return bad(`maker input ${mine.txid}:${mine.vout} is missing`);
    const [row, i] = matches[0];
    if (row.valueSats !== mine.valueSats || row.scriptPubKeyHex !== mine.scriptPubKeyHex) return bad('maker input value or script was changed');
    inputIndexes.push(i);
  }
  for (const out of tx.outputs) {
    if (!isP2trScript(out.scriptHex)) return bad('every output must be P2TR');
  }
  const cjOuts = tx.outputs.filter((o) => o.scriptHex === cjScript);
  if (cjOuts.length !== 1 || cjOuts[0].valueSats !== amountSats) return bad('maker coinjoin output missing or wrong amount');
  const changeOuts = tx.outputs.filter((o) => o.scriptHex === changeScript);
  if (expectedChangeSats > 0) {
    if (changeOuts.length !== 1 || changeOuts[0].valueSats < expectedChangeSats) return bad('maker change missing or short');
  } else if (changeOuts.length > 1) {
    return bad('maker change script paid twice');
  }
  const equal = tx.outputs.filter((o) => o.valueSats === amountSats).length;
  const minEqual = opts.minEqualOutputs != null ? Number(opts.minEqualOutputs) : DEFAULT_MIN_EQUAL_OUTPUTS;
  if (equal < minEqual) return bad(`needs at least ${minEqual} equal outputs`);
  const totalIn = tx.inputs.reduce((t, r) => t + r.valueSats, 0);
  const totalOut = tx.outputs.reduce((t, r) => t + r.valueSats, 0);
  if (totalOut > totalIn) return bad('outputs exceed inputs');
  return { ok: true, reason: null, cjfeeSats, expectedChangeSats, inputIndexes };
}

/**
 * The taker's check of the final transaction: exactly the planned outputs
 * (each maker paid its offer, no more), every planned input, and a feerate
 * within bounds.
 * @param {Object} opts
 * @param {string} opts.psbtBase64
 * @param {Object} opts.plan {@link planCoinjoin} output
 * @param {number} [opts.minFeeRateSatVb=1]
 * @param {number} [opts.maxFeeRateSatVb=500]
 * @returns {{ ok: boolean, reason: (string|null), feeRateSatVb: (number|null) }}
 */
function validateForTaker (opts = {}) {
  const bad = (reason) => ({ ok: false, reason, feeRateSatVb: null });
  let tx;
  try {
    tx = describePsbt(opts.psbtBase64);
  } catch (err) {
    return bad(err.message);
  }
  const plan = opts.plan;
  if (!plan || !Array.isArray(plan.inputs) || !Array.isArray(plan.outputs)) return bad('plan is required');
  if (tx.inputs.length !== plan.inputs.length) return bad('input count differs from the plan');
  for (const want of plan.inputs) {
    const row = tx.inputs.find((r) => r.txid === want.txid && r.vout === want.vout);
    if (!row || row.valueSats !== want.valueSats || row.scriptPubKeyHex !== want.scriptPubKeyHex) return bad(`input ${want.txid}:${want.vout} differs from the plan`);
  }
  if (tx.outputs.length !== plan.outputs.length) return bad('output count differs from the plan');
  for (const want of plan.outputs) {
    const rows = tx.outputs.filter((o) => o.scriptHex === want.scriptHex);
    if (rows.length !== 1 || rows[0].valueSats !== want.valueSats) return bad(`${want.role} ${want.kind} output differs from the plan`);
  }
  const fee = tx.inputs.reduce((t, r) => t + r.valueSats, 0) - tx.outputs.reduce((t, r) => t + r.valueSats, 0);
  const feeRate = fee / estimateVsize(tx.inputs.length, tx.outputs.length);
  const min = opts.minFeeRateSatVb != null ? Number(opts.minFeeRateSatVb) : 1;
  const max = opts.maxFeeRateSatVb != null ? Number(opts.maxFeeRateSatVb) : 500;
  if (feeRate < min) return bad(`feerate ${feeRate.toFixed(2)} sat/vB below ${min}`);
  if (feeRate > max) return bad(`feerate ${feeRate.toFixed(2)} sat/vB above ${max}`);
  return { ok: true, reason: null, feeRateSatVb: feeRate };
}

/**
 * BIP-341 output private key for a BIP-86 key-path-only P2TR (internal key, no scripts).
 * @param {Buffer|string} internalPriv32
 * @returns {Buffer} tweaked private key
 */
function taprootOutputPrivateKey (internalPriv32) {
  let d = privOf(internalPriv32);
  const P = Buffer.from(ecc.pointFromScalar(d, true));
  if (P[0] === 0x03) d = Buffer.from(ecc.privateNegate(d));
  const tweak = Buffer.from(bitcoin.crypto.taggedHash('TapTweak', P.subarray(1)));
  const q = ecc.privateAdd(d, tweak);
  if (!q) fail('taproot tweak failed');
  return Buffer.from(q);
}

/**
 * Key-path-only P2TR for an internal private key.
 * @param {Buffer|string} internalPriv32
 * @param {string} [networkName='regtest']
 * @returns {{ internalXOnlyHex: string, outputXOnlyHex: string, scriptPubKeyHex: string, address: string }}
 */
function taprootKeyPath (internalPriv32, networkName = 'regtest') {
  const internal = Buffer.from(ecc.pointFromScalar(privOf(internalPriv32), true)).subarray(1);
  const pay = bitcoin.payments.p2tr({ internalPubkey: internal, network: networkForFabricName(networkName) });
  const script = Buffer.from(pay.output);
  return {
    internalXOnlyHex: internal.toString('hex'),
    outputXOnlyHex: script.subarray(2).toString('hex'),
    scriptPubKeyHex: script.toString('hex'),
    address: pay.address
  };
}

/** @private */
function keyPathSigner (internalPriv32) {
  const q = taprootOutputPrivateKey(internalPriv32);
  return {
    publicKey: Buffer.from(ecc.pointFromScalar(q, true)),
    signSchnorr (hash) {
      return Buffer.from(ecc.signSchnorr(Buffer.from(hash), q));
    },
    sign () {
      throw new Error('coinjoin: key-path signer is Schnorr only');
    }
  };
}

/**
 * Sign the PSBT inputs spent by the given key-path keys (SIGHASH_DEFAULT).
 * Inputs owned by other keys are left untouched.
 * @param {string} psbtBase64
 * @param {Array<Buffer|string>} internalPrivateKeys
 * @returns {{ psbtBase64: string, signed: number[] }} indexes signed
 */
function signKeyPathInputs (psbtBase64, internalPrivateKeys = []) {
  const psbt = psbtFrom(psbtBase64);
  const keys = internalPrivateKeys.map((priv) => ({ priv, info: taprootKeyPath(priv) }));
  const signed = [];
  psbt.data.inputs.forEach((input, i) => {
    if (!input.witnessUtxo || input.finalScriptWitness) return;
    const script = Buffer.from(input.witnessUtxo.script).toString('hex');
    const key = keys.find((k) => k.info.scriptPubKeyHex === script);
    if (!key) return;
    if (!input.tapInternalKey) psbt.updateInput(i, { tapInternalKey: Buffer.from(key.info.internalXOnlyHex, 'hex') });
    psbt.signInput(i, keyPathSigner(key.priv));
    signed.push(i);
  });
  return { psbtBase64: psbt.toBase64(), signed };
}

/** @private */
function keyPathSignatureValid (psbt, index, signature) {
  const tx = psbt.data.globalMap.unsignedTx.tx;
  const prevScripts = psbt.data.inputs.map((d) => d.witnessUtxo && d.witnessUtxo.script);
  const values = psbt.data.inputs.map((d) => d.witnessUtxo && d.witnessUtxo.value);
  if (prevScripts.some((s) => !s)) return false;
  const sig = Buffer.from(signature);
  if (sig.length !== 64 && sig.length !== 65) return false;
  const hashType = sig.length === 65 ? sig[64] : bitcoin.Transaction.SIGHASH_DEFAULT;
  if (hashType !== bitcoin.Transaction.SIGHASH_DEFAULT && hashType !== bitcoin.Transaction.SIGHASH_ALL) return false;
  const hash = tx.hashForWitnessV1(index, prevScripts, values, hashType);
  const outputKey = Buffer.from(prevScripts[index]).subarray(2);
  return ecc.verifySchnorr(Buffer.from(hash), outputKey, sig.subarray(0, 64));
}

/**
 * Parse a serialized witness (`varint count`, then `varint length ‖ bytes` items).
 * @private
 */
function witnessStackOf (witness) {
  const buf = Buffer.from(witness);
  let offset = 0;
  const varint = () => {
    if (offset >= buf.length) throw new Error('truncated witness');
    const first = buf[offset++];
    if (first < 0xfd) return first;
    const width = first === 0xfd ? 2 : (first === 0xfe ? 4 : 8);
    if (offset + width > buf.length) throw new Error('truncated witness');
    const n = width === 2 ? buf.readUInt16LE(offset) : (width === 4 ? buf.readUInt32LE(offset) : Number(buf.readBigUInt64LE(offset)));
    offset += width;
    return n;
  };
  const count = varint();
  const stack = [];
  for (let i = 0; i < count; i++) {
    const length = varint();
    if (offset + length > buf.length) throw new Error('truncated witness');
    stack.push(buf.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== buf.length) throw new Error('trailing witness bytes');
  return stack;
}

/** @private */
function keyPathWitnessSignature (input) {
  if (input.tapKeySig) return Buffer.from(input.tapKeySig);
  if (input.finalScriptWitness) {
    try {
      const stack = witnessStackOf(input.finalScriptWitness);
      if (stack.length === 1) return Buffer.from(stack[0]);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Copy a maker's signatures for its own inputs into the taker's PSBT. Refuses
 * a PSBT for another transaction, a missing or invalid signature on any of the
 * maker's inputs; nothing else is taken from the maker's copy.
 * @param {string} basePsbtBase64 the taker's copy
 * @param {string} makerPsbtBase64 the maker's signed copy
 * @param {Object[]} makerInputs `{ txid, vout }` rows of that maker
 * @returns {string} merged PSBT (base64)
 */
function mergeMakerSignatures (basePsbtBase64, makerPsbtBase64, makerInputs = []) {
  const base = psbtFrom(basePsbtBase64);
  const theirs = psbtFrom(makerPsbtBase64);
  if (unsignedTxidOf(base) !== unsignedTxidOf(theirs)) fail('maker signed a different transaction');
  const rows = describePsbt(basePsbtBase64).inputs;
  for (const mine of makerInputs) {
    const i = rows.findIndex((r) => r.txid === mine.txid && r.vout === Number(mine.vout));
    if (i < 0) fail(`maker input ${mine.txid}:${mine.vout} is not in the transaction`);
    const sig = keyPathWitnessSignature(theirs.data.inputs[i]);
    if (!sig) fail(`maker input ${mine.txid}:${mine.vout} is not signed`);
    if (!keyPathSignatureValid(base, i, sig)) fail(`maker signature on ${mine.txid}:${mine.vout} is invalid`);
    if (!base.data.inputs[i].finalScriptWitness) {
      base.updateInput(i, { finalScriptWitness: psbtutils.witnessStackToScriptWitness([sig]) });
    }
  }
  return base.toBase64();
}

/**
 * Finalize every input and extract the transaction.
 * @param {string} psbtBase64
 * @returns {{ txHex: string, txid: string, vsize: number, feeSats: number }}
 */
function finalize (psbtBase64) {
  const psbt = psbtFrom(psbtBase64);
  psbt.data.inputs.forEach((input, i) => {
    if (input.finalScriptWitness) return;
    const sig = keyPathWitnessSignature(input);
    if (!sig) fail(`input ${i} is not signed`);
    if (!keyPathSignatureValid(psbt, i, sig)) fail(`input ${i} has an invalid signature`);
    psbt.finalizeInput(i);
  });
  const tx = psbt.extractTransaction(true);
  const fee = psbt.data.inputs.reduce((t, d) => t + Number(d.witnessUtxo.value), 0) -
    tx.outs.reduce((t, o) => t + Number(o.value), 0);
  return { txHex: tx.toHex(), txid: tx.getId(), vsize: tx.virtualSize(), feeSats: fee };
}

/** @private */
function ownershipHash (roundId, txid, vout) {
  const v = Buffer.alloc(4);
  v.writeUInt32BE(intOf('vout', vout, 0, 0xffffffff), 0);
  return crypto.createHash('sha256')
    .update(OWNERSHIP_TAG)
    .update(Buffer.from(hexOf('roundId', roundId, 32), 'hex'))
    .update(Buffer.from(hexOf('txid', txid, 32), 'hex'))
    .update(v)
    .digest();
}

/**
 * Prove control of a key-path UTXO for one round: a BIP340 signature by the
 * output key over `SHA256(tag ‖ roundId ‖ txid ‖ vout)`.
 * @param {Object} opts
 * @param {string} opts.roundId
 * @param {string} opts.txid
 * @param {number} opts.vout
 * @param {Buffer|string} opts.internalPrivateKey
 * @returns {string} 64-byte signature hex
 */
function signOwnership (opts = {}) {
  const q = taprootOutputPrivateKey(opts.internalPrivateKey);
  return Buffer.from(ecc.signSchnorr(ownershipHash(opts.roundId, opts.txid, opts.vout), q)).toString('hex');
}

/**
 * @param {Object} opts
 * @param {string} opts.roundId
 * @param {Object} opts.input `{ txid, vout, scriptPubKeyHex, ownershipSig }`
 * @returns {boolean}
 */
function verifyOwnership (opts = {}) {
  const input = opts.input || {};
  if (!input.ownershipSig || !isP2trScript(String(input.scriptPubKeyHex || ''))) return false;
  try {
    return ecc.verifySchnorr(
      ownershipHash(opts.roundId, input.txid, input.vout),
      Buffer.from(input.scriptPubKeyHex, 'hex').subarray(2),
      Buffer.from(input.ownershipSig, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Check a fill against the offer it names.
 * @param {Object} offer normalized offer
 * @param {Object} fill normalized fill
 * @param {Object} [opts]
 * @param {number} [opts.now] ms
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function validateFill (offer, fill, opts = {}) {
  const bad = (reason) => ({ ok: false, reason });
  const now = opts.now != null ? Number(opts.now) : Date.now();
  if (!offer || !fill) return bad('missing offer or fill');
  if (fill.offerId !== bodyId(offer)) return bad('fill names another offer');
  if (offer.expiresAt <= now) return bad('offer expired');
  if (fill.amountSats < offer.minSats || fill.amountSats > offer.maxSats) return bad('fill amount outside the offer');
  if (fill.takerPubkey === offer.makerPubkey) return bad('maker cannot fill its own offer');
  return { ok: true, reason: null };
}

// PoDLE
const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

/** Distinct commitments one UTXO can produce (indices `0 … PODLE_MAX_INDEX − 1`). */
const PODLE_MAX_INDEX = 3;
/** Domain tag mixed into the DLEQ challenge. */
const PODLE_TAG = 'fabric/podle/v1';
/** Default: the commitment UTXO must be this many blocks deep. */
const PODLE_MIN_AGE_CONFS = 5;
/** Default: the commitment UTXO must be worth this percent of the coinjoin amount. */
const PODLE_MIN_VALUE_PCT = 20;
/** Default size of a maker's used-commitment memory. */
const PODLE_BLACKLIST_SIZE = 100000;

/** @private */
function sha256 (...parts) {
  const h = crypto.createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest();
}

/** @private */
function scalarFromBytes (buf) {
  return BigInt('0x' + Buffer.from(buf).toString('hex')) % N;
}

/** @private */
function scalarHex (k) {
  return k.toString(16).padStart(64, '0');
}

/** @private */
function pointHex (P) {
  return Buffer.from(P.toBytes(true)).toString('hex');
}

/** @private */
function pointOf (label, hex) {
  const s = hexOf(label, hex, 33);
  try {
    return Point.fromHex(s);
  } catch {
    return fail(`${label} is not a point on secp256k1`);
  }
}

/** @private */
function isEvenY (P) {
  return (P.toAffine().y & 1n) === 0n;
}

const generators = new Map();

/**
 * Nothing-up-my-sleeve generator `J_index`: the first `SHA256(G ‖ index ‖ counter)`
 * that is a valid x coordinate, lifted to even y. Nobody knows `log_G(J)`.
 * @param {number} index 0 … {@link PODLE_MAX_INDEX} − 1
 * @returns {Object} noble `Point`
 */
function podleGenerator (index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= PODLE_MAX_INDEX) fail(`index must be an integer in [0, ${PODLE_MAX_INDEX - 1}]`);
  if (generators.has(i)) return generators.get(i);
  const seed = Buffer.from(G.toBytes(true));
  for (let counter = 0; counter < 256; counter++) {
    const x = sha256(seed, Buffer.from([i, counter]));
    try {
      const J = Point.fromHex(Buffer.concat([Buffer.from([0x02]), x]).toString('hex'));
      generators.set(i, J);
      return J;
    } catch {}
  }
  return fail('no generator found');
}

/**
 * The commitment for a `P2` point.
 * @param {string} p2Hex compressed point
 * @returns {string} 64 hex characters
 */
function podleCommitment (p2Hex) {
  return sha256(Buffer.from(hexOf('P2', p2Hex, 33), 'hex')).toString('hex');
}

/**
 * Private key for the even-y form of a key's point (BIP340 convention), so
 * `P` matches a P2TR output key by its x coordinate alone.
 * @param {Buffer|string} priv32 the UTXO's output (tweaked) private key
 * @returns {{ k: bigint, P: Object }}
 * @private
 */
function evenKey (priv32) {
  const buf = Buffer.isBuffer(priv32) || priv32 instanceof Uint8Array
    ? Buffer.from(priv32)
    : Buffer.from(hexOf('privateKey', priv32, 32), 'hex');
  if (buf.length !== 32) fail('privateKey must be 32 bytes');
  let k = BigInt('0x' + buf.toString('hex'));
  if (k <= 0n || k >= N) fail('invalid private key');
  let P = G.multiply(k);
  if (!isEvenY(P)) {
    k = N - k;
    P = P.negate();
  }
  return { k, P };
}

/** @private */
function outpointOf (utxo = {}) {
  const txid = hexOf('txid', utxo.txid, 32);
  const vout = Number(utxo.vout);
  if (!Number.isSafeInteger(vout) || vout < 0) fail('vout must be a non-negative integer');
  return { txid, vout };
}

/** @private */
function challenge ({ Kg, Kj, P, P2, txid, vout, index }) {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(vout, 0);
  head.writeUInt8(index, 4);
  return scalarFromBytes(sha256(
    Buffer.from(PODLE_TAG),
    Buffer.from(Kg.toBytes(true)),
    Buffer.from(Kj.toBytes(true)),
    Buffer.from(P.toBytes(true)),
    Buffer.from(P2.toBytes(true)),
    Buffer.from(txid, 'hex'),
    head
  ));
}

/**
 * Taker: commit to a UTXO it owns.
 * @param {Object} opts
 * @param {Buffer|string} opts.privateKey 32-byte private key of the UTXO's P2TR output key
 * @param {Object} opts.utxo `{ txid, vout }`
 * @param {number} [opts.index=0] which of the UTXO's commitments to use
 * @returns {{ commitment: string, reveal: { txid: string, vout: number, index: number, P: string, P2: string, e: string, s: string } }}
 */
function generatePodle (opts = {}) {
  const { txid, vout } = outpointOf(opts.utxo);
  const index = opts.index == null ? 0 : Number(opts.index);
  const J = podleGenerator(index);
  const { k, P } = evenKey(opts.privateKey);
  const P2 = J.multiply(k);
  let r = 0n;
  while (r === 0n) r = scalarFromBytes(crypto.randomBytes(32));
  const Kg = G.multiply(r);
  const Kj = J.multiply(r);
  const e = challenge({ Kg, Kj, P, P2, txid, vout, index });
  const s = (r + (e * k)) % N;
  const reveal = {
    txid,
    vout,
    index,
    P: pointHex(P),
    P2: pointHex(P2),
    e: scalarHex(e),
    s: scalarHex(s)
  };
  return { commitment: podleCommitment(reveal.P2), reveal };
}

/**
 * Maker: check a reveal against the commitment it was promised.
 * @param {Object} opts
 * @param {string} opts.commitment
 * @param {Object} opts.reveal
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function verifyPodle (opts = {}) {
  const bad = (reason) => ({ ok: false, reason });
  try {
    const reveal = opts.reveal || {};
    const commitment = hexOf('commitment', opts.commitment, 32);
    const { txid, vout } = outpointOf(reveal);
    const index = Number(reveal.index);
    const J = podleGenerator(index);
    const P = pointOf('P', reveal.P);
    const P2 = pointOf('P2', reveal.P2);
    if (!isEvenY(P)) return bad('P must have even y');
    if (podleCommitment(reveal.P2) !== commitment) return bad('P2 does not match the commitment');
    const e = BigInt('0x' + hexOf('e', reveal.e, 32));
    const s = BigInt('0x' + hexOf('s', reveal.s, 32));
    if (e === 0n || e >= N || s === 0n || s >= N) return bad('proof scalars out of range');
    const Kg = G.multiply(s).subtract(P.multiply(e));
    const Kj = J.multiply(s).subtract(P2.multiply(e));
    if (Kg.equals(Point.ZERO) || Kj.equals(Point.ZERO)) return bad('degenerate proof');
    if (challenge({ Kg, Kj, P, P2, txid, vout, index }) !== e) return bad('bad DLEQ proof');
    return { ok: true, reason: null };
  } catch (err) {
    return bad(err.message);
  }
}

/**
 * Maker: check the revealed UTXO itself, as read from the chain. The output
 * must be P2TR to `P`'s x coordinate, old enough, and large enough for the
 * coinjoin it is used for.
 * @param {Object} opts
 * @param {Object} opts.reveal
 * @param {Object|null} opts.utxo `{ scriptPubKeyHex, valueSats, confirmations }` (`null` = spent / unknown)
 * @param {number} opts.amountSats coinjoin amount
 * @param {number} [opts.minAgeConfs=5]
 * @param {number} [opts.minValuePct=20]
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function checkPodleUtxo (opts = {}) {
  const bad = (reason) => ({ ok: false, reason });
  const utxo = opts.utxo;
  if (!utxo) return bad('commitment UTXO is spent or unknown');
  const reveal = opts.reveal || {};
  let xonly;
  try {
    xonly = hexOf('P', reveal.P, 33).slice(2);
  } catch (err) {
    return bad(err.message);
  }
  if (String(utxo.scriptPubKeyHex || '').toLowerCase() !== `5120${xonly}`) return bad('commitment UTXO is not a P2TR output to P');
  const minAge = opts.minAgeConfs != null ? Number(opts.minAgeConfs) : PODLE_MIN_AGE_CONFS;
  if (!(Number(utxo.confirmations) >= minAge)) return bad(`commitment UTXO needs ${minAge} confirmations`);
  const pct = opts.minValuePct != null ? Number(opts.minValuePct) : PODLE_MIN_VALUE_PCT;
  const amount = Number(opts.amountSats);
  if (!Number.isFinite(amount) || amount <= 0) return bad('amountSats is required');
  if (Number(utxo.valueSats) * 100 < amount * pct) return bad(`commitment UTXO must be worth ${pct}% of the amount`);
  return { ok: true, reason: null };
}

/**
 * Lowest commitment index the taker has not used for a UTXO.
 * @param {number[]} used indices already spent on rounds
 * @returns {number|null} `null` once the UTXO is exhausted
 */
function nextPodleIndex (used = []) {
  const taken = new Set(used.map(Number));
  for (let i = 0; i < PODLE_MAX_INDEX; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

/**
 * A maker's bounded memory of commitments already seen. A commitment is
 * used once; the oldest is forgotten first.
 */
class PodleBlacklist {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.max=100000]
   * @param {string[]} [settings.commitments] restore
   */
  constructor (settings = {}) {
    this.max = Math.max(1, Number(settings.max) || PODLE_BLACKLIST_SIZE);
    this._seen = new Set();
    for (const c of settings.commitments || []) this.add(c);
  }

  /** @returns {number} */
  get size () {
    return this._seen.size;
  }

  /**
   * @param {string} commitment
   * @returns {boolean}
   */
  has (commitment) {
    return this._seen.has(String(commitment || '').toLowerCase());
  }

  /**
   * Remember a commitment.
   * @param {string} commitment
   * @returns {boolean} false when it was already known
   */
  add (commitment) {
    const c = hexOf('commitment', commitment, 32);
    if (this._seen.has(c)) return false;
    while (this._seen.size >= this.max) this._seen.delete(this._seen.values().next().value);
    this._seen.add(c);
    return true;
  }

  /** @returns {string[]} oldest first */
  toJSON () {
    return Array.from(this._seen);
  }
}

/**
 * One coinjoin round: the state machine shared by {@link CoinjoinTakerRound}
 * and {@link CoinjoinMakerRound} (`types/coinjoinRound`). Its statics are the
 * market itself: signed bodies and sealed round messages, fees and plans,
 * PSBT build and checks, key-path signing, ownership proofs, and PoDLE.
 * @extends EventEmitter
 */
class Coinjoin extends EventEmitter {
  /**
   * @param {string} name subclass name, used in errors and debug lines
   * @param {Object} transitions `status → allowed next statuses`
   * @param {Object} settings
   * @param {Function} [settings.now] clock in ms (tests)
   * @param {Object} [settings.adapters] chain and wallet adapters
   */
  constructor (name, transitions, settings) {
    super();
    this._name = name;
    this._transitions = transitions;
    this.settings = Object.assign({ now: () => Date.now() }, settings);
    this.adapters = settings.adapters || {};
  }

  get status () { return this._state.status; }

  _transition (to, detail = {}) {
    const from = this._state.status;
    if (!this._transitions[from].includes(to)) throw new Error(`${this._name}: cannot move from ${from} to ${to}`);
    this._state.status = to;
    this._state.history.push(Object.assign({ from, to, at: this.settings.now() }, detail));
    this.emit('debug', `[COINJOIN] ${this._name} ${this._state.roundId || ''} ${from} → ${to}`);
    this.emit('state', { from, to, round: this });
  }

  _expect (statuses) {
    if (!statuses.includes(this._state.status)) {
      throw new Error(`${this._name}: expected state ${statuses.join(' | ')}, got ${this._state.status}`);
    }
  }

  _fail (message) {
    const err = new Error(`${this._name}: ${message}`);
    if (this.listenerCount('error') > 0) this.emit('error', err);
    return err;
  }
}

Object.assign(Coinjoin, {
  BODY_VERSION,
  BODY_TYPES,
  ROUND_TYPES,
  SIGNER_FIELD,
  SCRIPT_TYPE,
  PPM,
  MAX_FEE_PPM,
  MIN_COINJOIN_SATS,
  DUST_SATS,
  MAX_MAKERS,
  MAX_MAKER_INPUTS,
  DEFAULT_MIN_MAKERS,
  DEFAULT_MIN_EQUAL_OUTPUTS,
  SEAL_NAMESPACE,
  SEALED_TYPE,
  MAX_PSBT_CHARS,
  randomNonce,
  randomRoundId,
  randomPrivateKey,
  normalizeOffer,
  normalizeCancel,
  normalizeFill,
  normalizeFillAck,
  normalizeAuth,
  normalizeIoAuth,
  normalizeTx,
  normalizeSig,
  toBody,
  fromBody,
  signingString,
  bodyId,
  pubkeyFromPrivate,
  signBody,
  verifyBody,
  sealRoundMessage,
  openRoundMessage,
  toContractMessage,
  fromContractMessage,
  makerFee,
  makerChange,
  estimateVsize,
  plan: planCoinjoin,
  buildPsbt,
  unsignedTxid,
  describePsbt,
  validateForMaker,
  validateForTaker,
  taprootOutputPrivateKey,
  taprootKeyPath,
  signKeyPathInputs,
  mergeMakerSignatures,
  finalize,
  signOwnership,
  verifyOwnership,
  validateFill,
  PODLE_MAX_INDEX,
  PODLE_TAG,
  PODLE_MIN_AGE_CONFS,
  PODLE_MIN_VALUE_PCT,
  podleGenerator,
  podleCommitment,
  generatePodle,
  verifyPodle,
  checkPodleUtxo,
  nextPodleIndex,
  PodleBlacklist
});

module.exports = Coinjoin;
module.exports.Coinjoin = Coinjoin;
