'use strict';

/**
 * Wallet-associated Bitcoin transaction watch helpers.
 *
 * A Fabric Wallet is a **collection of keys** (primary + optionally many seeds).
 * New blocks / mempool txs are classified against the watch set so callers can
 * react to every known Bitcoin message type that touches those keys.
 */

const bitcoin = require('bitcoinjs-lib');
const inventoryHtlc = require('./inventoryHtlc');

/** Fabric / ZMQ Bitcoin message types we monitor. */
const BITCOIN_MESSAGE_TYPES = Object.freeze([
  'BitcoinBlock',
  'BitcoinBlockHash',
  'BitcoinTransaction',
  'BitcoinTransactionHash'
]);

/** Wallet-facing classification of a related transaction. */
const WALLET_TX_KINDS = Object.freeze([
  'coinbase',
  'receive',
  'spend',
  'htlc_funding',
  'htlc_claim',
  'htlc_refund',
  'payment',
  'unknown'
]);

function isKnownBitcoinMessageType (type) {
  return BITCOIN_MESSAGE_TYPES.includes(String(type || ''));
}

function normalizeAddress (addr) {
  return String(addr || '').trim();
}

function addressesFromScriptPubKey (spk) {
  if (!spk || typeof spk !== 'object') return [];
  const out = [];
  if (spk.address) out.push(normalizeAddress(spk.address));
  if (Array.isArray(spk.addresses)) {
    for (const a of spk.addresses) out.push(normalizeAddress(a));
  }
  return out.filter(Boolean);
}

function pushWatchAddress (addresses, htlcAddresses, addr, meta) {
  const n = normalizeAddress(addr);
  if (!n) return;
  addresses.add(n);
  if (meta && (meta.kind === 'htlc' || meta.paymentHashHex || meta.settlementId)) {
    htlcAddresses.set(n, Object.assign({}, meta, { address: n }));
  }
}

function forEachAddressMap (mapOrObj, fn) {
  if (!mapOrObj) return;
  if (mapOrObj instanceof Map) {
    for (const [addr, meta] of mapOrObj.entries()) fn(addr, meta);
  } else if (typeof mapOrObj === 'object') {
    for (const addr of Object.keys(mapOrObj)) fn(addr, mapOrObj[addr]);
  }
}

/**
 * Build a watch-set snapshot from wallet state + explicit extras.
 * @param {object} [walletLike]
 * @param {object} [extras]
 */
function buildWatchSet (walletLike = {}, extras = {}) {
  const addresses = new Set();
  const paymentHashes = new Map();
  const htlcAddresses = new Map();

  const stateAddrs = (walletLike._state && walletLike._state.addresses) || walletLike.addresses || {};
  forEachAddressMap(stateAddrs, (addr, meta) => pushWatchAddress(addresses, htlcAddresses, addr, meta));

  const watch = walletLike._watch || walletLike.watch || {};
  forEachAddressMap(watch.addresses, (addr, meta) => pushWatchAddress(addresses, htlcAddresses, addr, meta));

  if (watch.paymentHashes instanceof Map) {
    for (const [hash, meta] of watch.paymentHashes.entries()) {
      paymentHashes.set(String(hash).toLowerCase(), meta || {});
    }
  }

  if (Array.isArray(extras.addresses)) {
    for (const a of extras.addresses) pushWatchAddress(addresses, htlcAddresses, a, null);
  }
  forEachAddressMap(extras.htlcAddresses, (addr, meta) => pushWatchAddress(addresses, htlcAddresses, addr, meta));
  if (extras.paymentHashes && typeof extras.paymentHashes === 'object') {
    for (const hash of Object.keys(extras.paymentHashes)) {
      paymentHashes.set(String(hash).toLowerCase(), extras.paymentHashes[hash] || {});
    }
  }

  return { addresses, paymentHashes, htlcAddresses };
}

function collectAddressesFromVerboseTx (verboseTx) {
  const outputs = [];
  const inputs = [];
  for (const v of (verboseTx && verboseTx.vout) || []) {
    outputs.push(...addressesFromScriptPubKey(v && v.scriptPubKey));
  }
  for (const vin of (verboseTx && verboseTx.vin) || []) {
    if (!vin || vin.coinbase) continue;
    if (vin.prevout && vin.prevout.scriptPubKey) {
      inputs.push(...addressesFromScriptPubKey(vin.prevout.scriptPubKey));
    }
  }
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const outU = uniq(outputs);
  const inU = uniq(inputs);
  return { outputs: outU, inputs: inU, all: uniq([...outU, ...inU]) };
}

function isCoinbaseTx (verboseTx) {
  const vins = (verboseTx && verboseTx.vin) || [];
  return vins.length > 0 && vins.every((v) => v && v.coinbase);
}

function settlementForPaymentHash (watchSet, paymentHashHex) {
  const h = String(paymentHashHex || '').toLowerCase();
  if (!h) return null;
  const fromHash = watchSet.paymentHashes && watchSet.paymentHashes.get(h);
  if (fromHash && fromHash.settlementId) return fromHash.settlementId;
  if (watchSet.htlcAddresses) {
    for (const m of watchSet.htlcAddresses.values()) {
      if (m.paymentHashHex && String(m.paymentHashHex).toLowerCase() === h && m.settlementId) {
        return m.settlementId;
      }
    }
  }
  return null;
}

function extractClaimPreimage (verbose, hex, paymentHashHex) {
  if (!paymentHashHex) return null;
  if (hex) {
    const got = inventoryHtlc.extractPreimageFromClaimTx(hex, paymentHashHex);
    if (got.ok) return got;
  }
  for (let i = 0; i < ((verbose && verbose.vin) || []).length; i++) {
    const wit = verbose.vin[i] && (verbose.vin[i].txinwitness || verbose.vin[i].witness);
    const pre = inventoryHtlc.extractPreimageFromWitnessStack(wit, paymentHashHex);
    if (pre) {
      return { ok: true, preimageHex: pre.toString('hex'), preimage32: pre, vin: i };
    }
  }
  return null;
}

/**
 * Classify a verbose (or hex) Bitcoin transaction relative to a watch set.
 * @param {object|string} txOrHex
 * @param {object} watchSet
 */
function classifyWalletTransaction (txOrHex, watchSet) {
  const empty = {
    related: false,
    kind: 'unknown',
    txid: null,
    addresses: [],
    matchedAddresses: [],
    paymentHashHex: null,
    preimageHex: null,
    settlementId: null,
    hex: null
  };

  let verbose = null;
  let hex = null;
  if (typeof txOrHex === 'string') {
    hex = txOrHex.trim();
    try {
      const tx = bitcoin.Transaction.fromHex(hex);
      verbose = {
        txid: tx.getId(),
        hex,
        vin: tx.ins.map((inp) => ({
          coinbase: inp.hash.every((b) => b === 0) && inp.index === 0xffffffff,
          txinwitness: (inp.witness || []).map((w) => w.toString('hex'))
        })),
        vout: [],
        locktime: tx.locktime
      };
    } catch (_) {
      return empty;
    }
  } else if (txOrHex && typeof txOrHex === 'object') {
    verbose = txOrHex;
    hex = verbose.hex || null;
  } else {
    return empty;
  }

  const txid = verbose.txid || verbose.hash || null;
  const addrInfo = collectAddressesFromVerboseTx(verbose);
  const matchedAddresses = addrInfo.all.filter((a) => watchSet.addresses && watchSet.addresses.has(a));

  let kind = isCoinbaseTx(verbose) ? 'coinbase' : 'unknown';
  let paymentHashHex = null;
  let preimageHex = null;
  let settlementId = null;

  const htlcHit = matchedAddresses
    .map((a) => watchSet.htlcAddresses && watchSet.htlcAddresses.get(a))
    .find(Boolean);
  if (htlcHit) {
    paymentHashHex = htlcHit.paymentHashHex || null;
    settlementId = htlcHit.settlementId || null;
    kind = 'htlc_funding';
  }

  const hashCandidates = new Set();
  if (paymentHashHex) hashCandidates.add(String(paymentHashHex).toLowerCase());
  if (watchSet.paymentHashes) {
    for (const h of watchSet.paymentHashes.keys()) hashCandidates.add(h);
  }

  for (const h of hashCandidates) {
    const got = extractClaimPreimage(verbose, hex, h);
    if (got && got.ok) {
      kind = 'htlc_claim';
      paymentHashHex = h;
      preimageHex = got.preimageHex;
      settlementId = settlementForPaymentHash(watchSet, h) || settlementId;
      break;
    }
  }

  if (kind === 'htlc_funding' && Number(verbose.locktime) > 0 && !preimageHex) {
    kind = 'htlc_refund';
  }

  if (kind === 'unknown' || kind === 'coinbase') {
    if (matchedAddresses.length && addrInfo.outputs.some((a) => watchSet.addresses.has(a))) {
      kind = kind === 'coinbase' ? 'coinbase' : 'receive';
    } else if (matchedAddresses.length && addrInfo.inputs.some((a) => watchSet.addresses.has(a))) {
      kind = 'spend';
    } else if (matchedAddresses.length) {
      kind = 'payment';
    }
  }

  const related = matchedAddresses.length > 0 ||
    kind === 'htlc_claim' || kind === 'htlc_funding' || kind === 'htlc_refund';

  return {
    related,
    kind,
    txid,
    addresses: addrInfo.all,
    matchedAddresses,
    paymentHashHex,
    preimageHex,
    settlementId,
    hex: hex || verbose.hex || null
  };
}

function scanBlockForWalletTransactions (block, watchSet) {
  const txs = (block && (block.tx || block.transactions)) || [];
  const out = [];
  for (const tx of txs) {
    const classified = classifyWalletTransaction(tx, watchSet);
    if (classified.related) out.push(classified);
  }
  return out;
}

module.exports = {
  BITCOIN_MESSAGE_TYPES,
  WALLET_TX_KINDS,
  isKnownBitcoinMessageType,
  normalizeAddress,
  buildWatchSet,
  collectAddressesFromVerboseTx,
  isCoinbaseTx,
  classifyWalletTransaction,
  scanBlockForWalletTransactions
};
