'use strict';

/**
 * Observe L1 Bitcoin payments to a Contract spend address (P2TR / any script).
 *
 * Does not broadcast or mutate chain state — returns a structured observation
 * so callers can fold balances into tip content under signer policy.
 *
 * @module functions/contractPaymentObserve
 * @see docs/ARC.md
 */

const bitcoin = require('bitcoinjs-lib');
const { networkForFabricName } = require('./contractTaproot');

/**
 * @param {string|object|Buffer} txInput raw hex, Transaction, or decoded RPC-like tx
 * @returns {{ tx: bitcoin.Transaction, txid: string }|{ ok: false, code: string, error: string }}
 */
function parseBitcoinTransaction (txInput) {
  if (txInput == null) {
    return { ok: false, code: 'MISSING_TX', error: 'transaction required' };
  }
  try {
    if (typeof txInput === 'string') {
      const hex = txInput.trim().replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 20) {
        return { ok: false, code: 'INVALID_TX', error: 'transaction hex invalid' };
      }
      const tx = bitcoin.Transaction.fromHex(hex);
      return { ok: true, tx, txid: tx.getId() };
    }
    if (txInput && typeof txInput.toHex === 'function' && typeof txInput.getId === 'function') {
      return { ok: true, tx: txInput, txid: txInput.getId() };
    }
    if (txInput && typeof txInput === 'object' && txInput.hex) {
      const tx = bitcoin.Transaction.fromHex(String(txInput.hex).trim());
      return { ok: true, tx, txid: tx.getId() };
    }
    return { ok: false, code: 'INVALID_TX', error: 'unsupported transaction shape' };
  } catch (e) {
    return {
      ok: false,
      code: 'INVALID_TX',
      error: e && e.message ? e.message : 'failed to parse transaction'
    };
  }
}

/**
 * @param {string} address
 * @param {string} [networkName]
 * @returns {{ ok: true, script: Buffer, network: object }|{ ok: false, code: string, error: string }}
 */
function outputScriptForAddress (address, networkName) {
  const addr = String(address || '').trim();
  if (!addr) {
    return { ok: false, code: 'INVALID_ADDRESS', error: 'address required' };
  }
  try {
    const network = networkForFabricName(networkName || 'regtest');
    const script = Buffer.from(bitcoin.address.toOutputScript(addr, network));
    return { ok: true, script, network };
  } catch (e) {
    return {
      ok: false,
      code: 'INVALID_ADDRESS',
      error: e && e.message ? e.message : 'invalid address for network'
    };
  }
}

/**
 * Observe whether `tx` pays `address` at least `amountSats` (when set).
 *
 * @param {object} opts
 * @param {string|object} opts.tx transaction hex or Transaction
 * @param {string} opts.address contract spend address
 * @param {string} [opts.network='regtest']
 * @param {number} [opts.amountSats] minimum matched sats (optional)
 * @returns {object}
 */
function observePaymentToAddress (opts = {}) {
  const parsed = parseBitcoinTransaction(opts.tx);
  if (!parsed.ok) return parsed;

  const netName = opts.network || opts.networkName || 'regtest';
  const dest = outputScriptForAddress(opts.address, netName);
  if (!dest.ok) return dest;

  const wantMin = opts.amountSats != null ? Math.round(Number(opts.amountSats)) : null;
  if (wantMin != null && (!Number.isFinite(wantMin) || wantMin <= 0)) {
    return { ok: false, code: 'INVALID_AMOUNT', error: 'amountSats must be a positive integer when set' };
  }

  const matches = [];
  let matchedSats = 0;
  for (let i = 0; i < parsed.tx.outs.length; i++) {
    const out = parsed.tx.outs[i];
    const sc = Buffer.isBuffer(out.script) ? out.script : Buffer.from(out.script);
    if (!sc.equals(dest.script)) continue;
    const sats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
    if (!Number.isFinite(sats) || sats <= 0) continue;
    matches.push({ vout: i, amountSats: sats });
    matchedSats += sats;
  }

  if (!matches.length) {
    return {
      ok: false,
      code: 'NO_MATCH',
      error: 'transaction does not pay the contract address',
      txid: parsed.txid,
      address: String(opts.address).trim(),
      network: netName,
      matchedSats: 0,
      vouts: []
    };
  }

  if (wantMin != null && matchedSats < wantMin) {
    return {
      ok: false,
      code: 'UNDERPAID',
      error: `matched ${matchedSats} sats but required at least ${wantMin}`,
      txid: parsed.txid,
      address: String(opts.address).trim(),
      network: netName,
      matchedSats,
      amountSatsRequired: wantMin,
      vouts: matches
    };
  }

  return {
    ok: true,
    code: 'PAID',
    txid: parsed.txid,
    address: String(opts.address).trim(),
    network: netName,
    matchedSats,
    amountSatsRequired: wantMin,
    vouts: matches
  };
}

/**
 * Fold a successful observation into tip content balances (immutable clone).
 * @param {object} tip
 * @param {object} observation from {@link observePaymentToAddress}
 * @returns {object} tip
 */
function applyPaymentObservationToTip (tip = {}, observation = {}) {
  if (!observation || observation.ok !== true) {
    throw new Error('applyPaymentObservationToTip: observation must be successful');
  }
  const prev = tip && typeof tip === 'object' ? tip : {};
  const content = Object.assign({}, prev.content && typeof prev.content === 'object' ? prev.content : {});
  const balances = Object.assign({}, content.balances && typeof content.balances === 'object' ? content.balances : {});
  const addr = observation.address;
  const prevSats = Number(balances[addr] && balances[addr].sats) || 0;
  balances[addr] = {
    sats: prevSats + Number(observation.matchedSats || 0),
    lastTxid: observation.txid,
    lastObservedAt: new Date().toISOString()
  };
  content.balances = balances;
  const payments = Array.isArray(content.payments) ? content.payments.slice() : [];
  payments.push({
    txid: observation.txid,
    address: addr,
    amountSats: observation.matchedSats,
    vouts: observation.vouts
  });
  content.payments = payments;
  return Object.assign({}, prev, { content });
}

module.exports = {
  parseBitcoinTransaction,
  outputScriptForAddress,
  observePaymentToAddress,
  applyPaymentObservationToTip
};
