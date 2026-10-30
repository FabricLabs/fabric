'use strict';

/**
 * @fileoverview Watchtower. Every Fabric node files penalty transactions for
 * its own channels and accepts the same filings from clients already
 * registered with it. A filing is per-output justice transactions, encrypted
 * under the commitment txid and indexed by the first 16 bytes of that txid.
 * Seeing the commitment decrypts the filing; a prefix that does not decrypt
 * is left alone. The store never holds a channel key.
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Service = require('../types/service');
const Witness = require('../types/witness');
const Key = require('../types/key');

const TYPE = 'WatchtowerAppointment';
const VERSION = 1;
const HINT_HEX = 32;
const MAX_PER_CLIENT = 64;
const MAX_FILINGS = 4096;
const CONTRACT_ID = crypto.createHash('sha256').update('fabric-watchtower').digest('hex');

/**
 * 32-byte private key, or null.
 * @param {Buffer|string|null} value
 * @returns {Buffer|null}
 * @private
 */
function priv32 (value) {
  if (!value) return null;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'hex');
  return buf.length === 32 ? buf : null;
}

/**
 * Encrypt justice transactions under the commitment txid.
 * @param {string} commitmentTxid
 * @param {string[]} transactions
 * @returns {{ hint: string, nonce: string, blob: string }}
 * @private
 */
function seal (commitmentTxid, transactions) {
  const txid = String(commitmentTxid || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Watchtower: commitmentTxid must be 32-byte hex');
  if (!Array.isArray(transactions) || !transactions.length || transactions.some((tx) => typeof tx !== 'string' || !tx)) {
    throw new Error('Watchtower: transactions must be raw hex');
  }
  const key = crypto.createHash('sha256').update(Buffer.from(txid, 'hex')).digest();
  const plain = Buffer.from(JSON.stringify(transactions), 'utf8');
  // Derived from the txid and the plaintext, so filing the same penalty twice
  // is one ciphertext. A different fee (different transactions) is a new nonce.
  const nonce = crypto.createHash('sha256').update(Buffer.from(txid, 'hex')).update(plain).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return {
    hint: txid.slice(0, HINT_HEX),
    nonce: nonce.toString('hex'),
    blob: enc.toString('base64')
  };
}

/**
 * Decrypt a filing with the commitment txid. Null when the hint misses or
 * the ciphertext was sealed for a different transaction (prefix collision).
 * @param {object} filing
 * @param {string} txid
 * @returns {string[]|null}
 */
function openFiling (filing, txid) {
  const id = String(txid || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id) || !filing || String(filing.hint || '').toLowerCase() !== id.slice(0, HINT_HEX)) return null;
  try {
    const key = crypto.createHash('sha256').update(Buffer.from(id, 'hex')).digest();
    const packed = Buffer.from(String(filing.blob || ''), 'base64');
    if (packed.length < 17) return null;
    const tag = packed.subarray(packed.length - 16);
    const body = packed.subarray(0, packed.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(filing.nonce || ''), 'hex'));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    const transactions = JSON.parse(plain);
    if (!Array.isArray(transactions) || !transactions.length || transactions.some((tx) => typeof tx !== 'string' || !/^[0-9a-f]+$/i.test(tx))) return null;
    return transactions;
  } catch (_) {
    return null;
  }
}

/**
 * A broadcast error that means this penalty will not confirm later: the
 * transaction is already known, or its inputs are already spent.
 * @param {Error|string} error
 * @returns {boolean}
 */
function broadcastSettled (error) {
  const msg = String(error && error.message ? error.message : error || '');
  return /already in block chain|txn-already-known|txn-already-in-mempool|already known|missingorspent|mempool-conflict|bad-txns-inputs/i.test(msg);
}

/**
 * Local store of encrypted justice filings.
 * @class Watchtower
 */
class Watchtower extends Service {
  /**
   * @param {object} [settings]
   * @param {Buffer|string} [settings.localPrivateKey] operator key; its x-only pubkey is always admitted
   * @param {string} [settings.localPubkey] x-only or compressed operator pubkey when the private key is held elsewhere
   * @param {function(string): boolean} [settings.admit] other clients this node has registered
   * @param {number} [settings.maxPerClient]
   * @param {number} [settings.maxFilings]
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      name: 'Watchtower',
      maxPerClient: MAX_PER_CLIENT,
      maxFilings: MAX_FILINGS
    }, settings);
    const priv = priv32(settings.localPrivateKey);
    this.localPubkey = priv ? Witness.xOnlyPubkeyHex(priv) : (Key.pubkeyXOnly(settings.localPubkey) || null);
    this._admit = typeof settings.admit === 'function' ? settings.admit : null;
    /** @type {Map<string, object>} `${client}|${hint}` → signed appointment */
    this._filings = new Map();
  }

  /**
   * Operator, or a client the host already registered.
   * @param {string} pubkey x-only or compressed
   * @returns {boolean}
   */
  isAdmitted (pubkey) {
    const id = Key.pubkeyXOnly(pubkey);
    if (!id) return false;
    if (this.localPubkey && id === this.localPubkey) return true;
    try {
      return !!(this._admit && this._admit(id));
    } catch (_) {
      return false;
    }
  }

  /**
   * @param {string} client x-only
   * @returns {number}
   * @private
   */
  _countClient (client) {
    let n = 0;
    const prefix = `${client}|`;
    for (const key of this._filings.keys()) if (key.startsWith(prefix)) n += 1;
    return n;
  }

  /**
   * Keep a signed appointment. The same client replacing a hint is a fee
   * update and does not consume another slot. A client this node has not
   * registered is refused (`code` `UNREGISTERED`) unless `opts.sessionPubkey`
   * is that same key — a current Passport session.
   * @param {object} appointment `WatchtowerAppointment`
   * @param {object} [opts]
   * @param {string} [opts.sessionPubkey] pubkey of the signed-in session
   * @returns {{ hint: string, client: string }}
   */
  file (appointment, opts = {}) {
    if (!appointment || appointment.type !== TYPE || Number(appointment.version) !== VERSION) {
      throw new Error('Watchtower: unexpected appointment');
    }
    if (!Witness.verifyArtifact(appointment)) throw new Error('Watchtower: appointment signature invalid');
    const client = Key.pubkeyXOnly(appointment.pubkey);
    if (!client) throw new Error('Watchtower: appointment pubkey invalid');
    const sessionOk = opts.sessionPubkey && Key.pubkeysMatch(opts.sessionPubkey, client);
    if (!sessionOk && !this.isAdmitted(client)) {
      const err = new Error('Watchtower: client is not registered');
      err.code = 'UNREGISTERED';
      throw err;
    }
    const hint = String(appointment.hint || '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hint)) throw new Error('Watchtower: hint must be 16 bytes');
    if (typeof appointment.nonce !== 'string' || !/^[0-9a-f]{24}$/i.test(appointment.nonce)) {
      throw new Error('Watchtower: nonce must be 12 bytes');
    }
    if (typeof appointment.blob !== 'string' || !appointment.blob) throw new Error('Watchtower: blob required');
    const id = `${client}|${hint}`;
    const prev = this._filings.get(id);
    if (!prev) {
      if (this._countClient(client) >= this.settings.maxPerClient) throw new Error('Watchtower: client filing cap');
      if (this._filings.size >= this.settings.maxFilings) throw new Error('Watchtower: tower filing cap');
    }
    const stored = {
      type: TYPE,
      version: VERSION,
      hint,
      nonce: String(appointment.nonce).toLowerCase(),
      blob: appointment.blob,
      pubkey: client,
      signature: String(appointment.signature).toLowerCase()
    };
    this._filings.set(id, stored);
    return { hint, client, updated: !prev || prev.blob !== stored.blob };
  }

  /**
   * Justice transactions for commitments present in `txHexes`. A hint that
   * does not decrypt is ignored.
   * @param {string[]} txHexes
   * @returns {object[]} `[{ client, hint, commitmentTxid, transactions }]`
   */
  match (txHexes) {
    const hits = [];
    const seen = new Set();
    for (const hex of txHexes || []) {
      let txid;
      try { txid = bitcoin.Transaction.fromHex(String(hex).trim()).getId(); } catch (_) { continue; }
      const hint = txid.slice(0, HINT_HEX);
      for (const filing of this._filings.values()) {
        if (filing.hint !== hint) continue;
        const key = `${filing.pubkey}|${hint}|${txid}`;
        if (seen.has(key)) continue;
        const transactions = openFiling(filing, txid);
        if (!transactions) continue;
        seen.add(key);
        hits.push({ client: filing.pubkey, hint, commitmentTxid: txid, transactions });
      }
    }
    return hits;
  }

  /**
   * Drop a filing after its justice transactions have been broadcast.
   * @param {string} client
   * @param {string} hint
   */
  drop (client, hint) {
    const id = Key.pubkeyXOnly(client);
    if (!id) return;
    this._filings.delete(`${id}|${String(hint || '').toLowerCase()}`);
  }

  /** @returns {number} */
  get size () { return this._filings.size; }

  /** @returns {object} persistence snapshot (ciphertext only) */
  export () {
    return {
      type: 'WatchtowerState',
      version: 1,
      filings: [...this._filings.values()]
    };
  }

  /**
   * Restore filings. Each row is checked again, so a restarted node keeps
   * only appointments that still verify and that it still admits.
   * @param {object} snapshot
   * @returns {number} filings kept
   */
  import (snapshot = {}) {
    const list = snapshot && Array.isArray(snapshot.filings) ? snapshot.filings : [];
    for (const row of list) {
      try { this.file(row); } catch (_) { /* drop malformed, unregistered, or over-cap rows */ }
    }
    return this._filings.size;
  }
}

/**
 * Sign a filing from this node's own channel book, or from a client.
 * @param {object} filing `{ commitmentTxid, transactions }`
 * @param {Buffer|string} privateKey
 * @returns {object} signed `WatchtowerAppointment`
 */
Watchtower.appointment = function appointment (filing, privateKey) {
  const priv = priv32(privateKey);
  if (!priv) throw new Error('Watchtower: 32-byte private key required');
  const sealed = seal(filing && filing.commitmentTxid, filing && filing.transactions);
  return Witness.signArtifact({
    type: TYPE,
    version: VERSION,
    hint: sealed.hint,
    nonce: sealed.nonce,
    blob: sealed.blob
  }, priv);
};

Watchtower.CONTRACT_ID = CONTRACT_ID;
Watchtower.TYPE = TYPE;
Watchtower.MAX_PER_CLIENT = MAX_PER_CLIENT;
Watchtower.MAX_FILINGS = MAX_FILINGS;
Watchtower.open = openFiling;
Watchtower.broadcastSettled = broadcastSettled;

module.exports = Watchtower;
