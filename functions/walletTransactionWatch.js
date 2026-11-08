'use strict';

/**
 * Wallet-associated Bitcoin transaction watch helpers.
 *
 * A Fabric Wallet is a **collection of keys** (primary + optionally many seeds).
 * New blocks / mempool txs are classified against the watch set so callers can
 * react to every known Bitcoin message type that touches those keys.
 */

const bitcoin = require('bitcoinjs-lib');
const Htlc = require('../types/htlc');

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

/**
 * The key an address is watched under. Bech32 is case-insensitive (all upper
 * or all lower case), so it is keyed in lower case; Base58 is case-sensitive
 * and keyed as written.
 * @param {string} addr
 * @returns {string}
 */
function watchKey (addr) {
  const n = normalizeAddress(addr);
  if (!/^[a-z0-9]+1[a-z0-9]+$/i.test(n)) return n;
  const lower = n.toLowerCase();
  if (n !== lower && n !== n.toUpperCase()) return n;
  try {
    bitcoin.address.fromBech32(lower);
    return lower;
  } catch (_) {
    return n;
  }
}

/** @private Networks a raw script is read for when the watch set names none. */
const OUTPUT_SCRIPT_NETWORKS = Object.freeze([
  bitcoin.networks.bitcoin,
  bitcoin.networks.testnet,
  bitcoin.networks.regtest
]);

/**
 * bitcoinjs-lib parameters for a network: a bitcoinjs network object as is,
 * or a Fabric network name (signet and testnet4 share testnet's).
 * @private
 * @param {object|string} network
 * @returns {object|null}
 */
function bitcoinNetwork (network) {
  if (network && typeof network === 'object' && typeof network.bech32 === 'string') return network;
  if (typeof network !== 'string' || !network) return null;
  if (network === 'regtest') return bitcoin.networks.regtest;
  if (network === 'mainnet' || network === 'main' || network === 'bitcoin') return bitcoin.networks.bitcoin;
  return bitcoin.networks.testnet;
}

/** @private */
function scriptNetworks (network) {
  return network ? [network] : OUTPUT_SCRIPT_NETWORKS;
}

/**
 * Every address a raw output script reads as on `network`. A raw transaction
 * names no network, and testnet and regtest render one SegWit script as two
 * addresses, so only the watch set's network is read; with none, every
 * network is (only watched strings match).
 * @private
 * @param {Buffer|Uint8Array} script
 * @param {object|null} [network]
 * @returns {string[]}
 */
function addressesFromOutputScript (script, network = null) {
  const out = [];
  for (const net of scriptNetworks(network)) {
    try {
      out.push(normalizeAddress(bitcoin.address.fromOutputScript(script, net)));
    } catch (_) {}
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * Addresses a raw input spends from, read from its witness or script: a
 * Taproot script path (leaf + control block), a P2WSH witness script, a
 * P2WPKH or P2PKH public key. A Taproot key-path spend names nothing.
 * @private
 * @param {Buffer[]} witness
 * @param {Buffer} [scriptSig]
 * @param {object|null} [network]
 * @returns {string[]}
 */
function addressesFromInput (witness, scriptSig, network = null) {
  const out = [];
  const tries = [];
  if (Array.isArray(witness) && witness.length) {
    tries.push((net) => bitcoin.payments.p2tr({ witness, network: net }).address);
    tries.push((net) => bitcoin.payments.p2wsh({ witness, network: net }).address);
    tries.push((net) => bitcoin.payments.p2wpkh({ witness, network: net }).address);
  }
  if (scriptSig && scriptSig.length) {
    tries.push((net) => bitcoin.payments.p2pkh({ input: scriptSig, network: net }).address);
  }
  for (const net of scriptNetworks(network)) {
    for (const read of tries) {
      try {
        const addr = read(net);
        if (addr) out.push(normalizeAddress(addr));
      } catch (_) {}
    }
  }
  return [...new Set(out)];
}

/** @private `txid:vout` of an input or output. */
function outpointKey (txid, vout) {
  return `${String(txid || '').toLowerCase()}:${Number(vout)}`;
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

function pushWatchAddress (watchSet, addr, meta) {
  const n = normalizeAddress(addr);
  if (!n) return;
  const key = watchKey(n);
  watchSet.addresses.add(key);
  if (!watchSet.registered.has(key)) watchSet.registered.set(key, n);
  if (meta && (meta.kind === 'htlc' || meta.paymentHashHex || meta.settlementId)) {
    watchSet.htlcAddresses.set(key, Object.assign({}, meta, { address: watchSet.registered.get(key) }));
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
 *
 * `addresses` and `htlcAddresses` are keyed by {@link watchKey};
 * `registered` maps each key back to the address as first registered.
 * `network` (the wallet's, or `extras.network`) is the only one raw scripts
 * are read for. `outpoints` (`txid:vout` → `{ address }`) are outputs the
 * wallet already saw paid to it, so a raw spend of one is recognized.
 * @param {object} [walletLike]
 * @param {object} [extras]
 */
function buildWatchSet (walletLike = {}, extras = {}) {
  const watchSet = {
    addresses: new Set(),
    paymentHashes: new Map(),
    htlcAddresses: new Map(),
    registered: new Map(),
    outpoints: new Map(),
    network: bitcoinNetwork(extras.network) || bitcoinNetwork(walletLike.network)
  };

  const stateAddrs = (walletLike._state && walletLike._state.addresses) || walletLike.addresses || {};
  forEachAddressMap(stateAddrs, (addr, meta) => pushWatchAddress(watchSet, addr, meta));

  const watch = walletLike._watch || walletLike.watch || {};
  forEachAddressMap(watch.addresses, (addr, meta) => pushWatchAddress(watchSet, addr, meta));

  if (watch.paymentHashes instanceof Map) {
    for (const [hash, meta] of watch.paymentHashes.entries()) {
      watchSet.paymentHashes.set(String(hash).toLowerCase(), meta || {});
    }
  }

  if (Array.isArray(extras.addresses)) {
    for (const a of extras.addresses) pushWatchAddress(watchSet, a, null);
  }
  forEachAddressMap(extras.htlcAddresses, (addr, meta) => pushWatchAddress(watchSet, addr, meta));
  if (extras.paymentHashes && typeof extras.paymentHashes === 'object') {
    for (const hash of Object.keys(extras.paymentHashes)) {
      watchSet.paymentHashes.set(String(hash).toLowerCase(), extras.paymentHashes[hash] || {});
    }
  }

  for (const source of [walletLike._ownedOutpoints, extras.outpoints]) {
    forEachAddressMap(source, (outpoint, meta) => {
      if (meta && meta.address) watchSet.outpoints.set(String(outpoint).toLowerCase(), meta);
    });
  }

  return watchSet;
}

/**
 * Output and input addresses of a transaction. An input's addresses come
 * from its verbose `prevout`, then from its witness or script on `network`,
 * then from a watched outpoint it spends.
 * @param {object} verboseTx
 * @param {object} [watchSet]
 */
function collectAddressesFromVerboseTx (verboseTx, watchSet = {}) {
  const outputs = [];
  const inputs = [];
  for (const v of (verboseTx && verboseTx.vout) || []) {
    outputs.push(...addressesFromScriptPubKey(v && v.scriptPubKey));
  }
  for (const vin of (verboseTx && verboseTx.vin) || []) {
    inputs.push(...inputAddresses(vin, watchSet));
  }
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const outU = uniq(outputs);
  const inU = uniq(inputs);
  return { outputs: outU, inputs: inU, all: uniq([...outU, ...inU]) };
}

/** @private Addresses one input spends from. */
function inputAddresses (vin, watchSet = {}) {
  if (!vin || vin.coinbase) return [];
  const out = [];
  if (vin.prevout && vin.prevout.scriptPubKey) out.push(...addressesFromScriptPubKey(vin.prevout.scriptPubKey));
  const witness = (vin.txinwitness || vin.witness || []).map((w) => Buffer.isBuffer(w) ? w : Buffer.from(String(w), 'hex'));
  const sigHex = vin.scriptSig && typeof vin.scriptSig === 'object' ? vin.scriptSig.hex : vin.scriptSig;
  const scriptSig = typeof sigHex === 'string' && sigHex ? Buffer.from(sigHex, 'hex') : null;
  out.push(...addressesFromInput(witness, scriptSig, watchSet.network || null));
  if (vin.txid != null && vin.vout != null && watchSet.outpoints) {
    const owned = watchSet.outpoints.get(outpointKey(vin.txid, vin.vout));
    if (owned) out.push(normalizeAddress(owned.address));
  }
  return out;
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
    const got = Htlc.extractPreimage(hex, paymentHashHex);
    if (got.ok) return got;
  }
  for (let i = 0; i < ((verbose && verbose.vin) || []).length; i++) {
    const wit = verbose.vin[i] && (verbose.vin[i].txinwitness || verbose.vin[i].witness);
    const pre = Htlc.extractPreimageFromWitness(wit, paymentHashHex);
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
    ownedOutputs: [],
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
          txid: Buffer.from(inp.hash).reverse().toString('hex'),
          vout: inp.index,
          scriptSig: { hex: Buffer.from(inp.script || []).toString('hex') },
          txinwitness: (inp.witness || []).map((w) => Buffer.from(w).toString('hex'))
        })),
        // Outputs decoded from the raw bytes: without them a raw `rawtx`
        // notification matches no watched address and a payment is missed.
        vout: tx.outs.map((out, n) => ({
          n,
          value: Number(out.value) / 1e8,
          scriptPubKey: {
            hex: Buffer.from(out.script).toString('hex'),
            addresses: addressesFromOutputScript(out.script, watchSet.network || null)
          }
        })),
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

  const watched = (a) => !!watchSet.addresses && watchSet.addresses.has(watchKey(a));
  const registered = (a) => (watchSet.registered && watchSet.registered.get(watchKey(a))) || normalizeAddress(a);
  const htlcFor = (a) => (watchSet.htlcAddresses && watchSet.htlcAddresses.get(watchKey(a))) || null;

  const txid = verbose.txid || verbose.hash || null;
  const addrInfo = collectAddressesFromVerboseTx(verbose, watchSet);
  const matchedAddresses = [...new Set(addrInfo.all.filter(watched).map(registered))];
  const ownedOutputs = [];
  for (let i = 0; i < ((verbose && verbose.vout) || []).length; i++) {
    const v = verbose.vout[i];
    const hit = addressesFromScriptPubKey(v && v.scriptPubKey).find(watched);
    if (!hit) continue;
    const value = Number(v.value);
    ownedOutputs.push({
      txid,
      vout: v.n != null ? Number(v.n) : i,
      address: registered(hit),
      valueSats: Number.isFinite(value) ? Math.round(value * 1e8) : null
    });
  }

  let kind = isCoinbaseTx(verbose) ? 'coinbase' : 'unknown';
  let paymentHashHex = null;
  let preimageHex = null;
  let settlementId = null;

  // An input spending a watched HTLC is a refund unless it reveals the
  // preimage (a claim); an output paying one is a funding.
  const htlcSpent = addrInfo.inputs.map(htlcFor).find(Boolean);
  const htlcPaid = addrInfo.outputs.map(htlcFor).find(Boolean);
  const htlcHit = htlcSpent || htlcPaid;
  if (htlcHit) {
    paymentHashHex = htlcHit.paymentHashHex || null;
    settlementId = htlcHit.settlementId || null;
    kind = htlcSpent ? 'htlc_refund' : 'htlc_funding';
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

  // A transaction spending the wallet's own coins is a spend, even when its
  // change comes back to a watched address.
  if (kind === 'unknown') {
    if (addrInfo.inputs.some(watched)) kind = 'spend';
    else if (addrInfo.outputs.some(watched)) kind = 'receive';
    else if (matchedAddresses.length) kind = 'payment';
  }

  const related = matchedAddresses.length > 0 ||
    kind === 'htlc_claim' || kind === 'htlc_funding' || kind === 'htlc_refund';

  return {
    related,
    kind,
    txid,
    addresses: addrInfo.all,
    matchedAddresses,
    ownedOutputs,
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
  watchKey,
  buildWatchSet,
  collectAddressesFromVerboseTx,
  isCoinbaseTx,
  classifyWalletTransaction,
  scanBlockForWalletTransactions
};
