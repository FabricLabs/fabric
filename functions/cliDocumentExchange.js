'use strict';

/**
 * Headless document-exchange operations for Fabric CLI shell packs
 * (`documents` + `documents-market` in {@link module:functions/cliContracts}).
 *
 * This is the **canonical operator surface** for L1 document exchange in
 * `@fabric/core`. Blessed handlers in `types/cli.js` should stay thin adapters
 * over this module so Hub / scripts / tests can share the same flows without
 * the TUI.
 *
 * @module functions/cliDocumentExchange
 * @see docs/L1_DOCUMENT_EXCHANGE.md
 */

const fs = require('fs');
const path = require('path');
const Actor = require('../types/actor');
const {
  DocumentOfferBook,
  createDocumentPurchaseSession,
  findSession,
  isDuplicateSettlement,
  rememberSettlement,
  listRefundCandidates
} = require('./documentMarket');
const inventoryHtlc = require('./inventoryHtlc');
const { contentHashHexFromObject } = require('./documentPaymentHash');
const {
  extractPreimageFromClaimTx,
  refundLocktimeMature,
  prepareInventoryHtlcBuyerRefundPsbt,
  signAndExtractInventoryHtlcBuyerRefund
} = inventoryHtlc;
const { findCliContract } = require('./cliContracts');

const IMPORT_PATH_MAX_LEN = 4096;

/** Shell packs that implement document exchange in the Fabric CLI. */
const DOCUMENT_EXCHANGE_CLI_PACKS = Object.freeze(['documents', 'documents-market']);

/**
 * @returns {Array<object>} Catalog descriptors for document-exchange shell packs.
 */
function listDocumentExchangeCliContracts () {
  return DOCUMENT_EXCHANGE_CLI_PACKS
    .map((id) => findCliContract(id))
    .filter(Boolean);
}

/**
 * Slash-command names owned by document-exchange shell packs.
 * @returns {string[]}
 */
function listDocumentExchangeCommands () {
  const out = [];
  for (const pack of listDocumentExchangeCliContracts()) {
    for (const cmd of Object.keys(pack.commands || {})) {
      out.push(cmd);
    }
  }
  return out;
}

/**
 * Resolve an operator-supplied import path. Absolute paths are normalized as-is;
 * relative paths must stay under `process.cwd()`.
 * @param {string} filePath
 * @returns {string|null}
 */
function resolveImportFilePath (filePath) {
  if (filePath == null || typeof filePath !== 'string') return null;
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes('\0') || trimmed.length > IMPORT_PATH_MAX_LEN) return null;
  let abs;
  if (path.isAbsolute(trimmed)) {
    abs = path.normalize(trimmed);
  } else {
    // Relative: containment enforced by path.relative below.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    abs = path.resolve(process.cwd(), trimmed);
    const root = path.resolve(process.cwd());
    const rel = path.relative(root, abs);
    if (rel === '' || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
      return null;
    }
  }
  if (!abs || abs.includes('\0') || !path.isAbsolute(abs)) return null;
  return abs;
}

/**
 * Read a regular file from a previously resolved absolute path.
 * @param {string} absolutePath
 * @returns {Buffer}
 */
function readResolvedImportFile (absolutePath) {
  const p = path.normalize(String(absolutePath || ''));
  if (!p || p.includes('\0') || !path.isAbsolute(p)) {
    throw new Error('invalid import path');
  }
  // Path already validated by resolveImportFilePath.
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error('not a regular file');
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  return fs.readFileSync(p);
}

/**
 * @typedef {Object} DocumentExchangeHost
 * @property {function(): object|null} [getPeer]
 * @property {function(): object|null} [getBitcoin]
 * @property {function(): object|null} [getWallet]
 * @property {function(): object|null} [getFilesystem]
 * @property {function(): object} [getSettings]
 * @property {function(): string} [getNetworkName]
 * @property {function(string): void} [onWarning]
 */

/**
 * Structured result for CLI / headless callers.
 * @typedef {Object} ExchangeResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [message]
 * @property {object} [session]
 * @property {Array} [sessions]
 * @property {Array} [offers]
 * @property {Array} [rows]
 * @property {*} [data]
 */

class CliDocumentExchange {
  /**
   * @param {DocumentExchangeHost} [host]
   */
  constructor (host = {}) {
    this.host = host;
    this.documents = host.documents || {};
    this.offerBook = host.offerBook || new DocumentOfferBook();
    this.purchaseSessions = host.purchaseSessions || new Map();
    this.paidSettlements = host.paidSettlements || new Set();
    this.remoteInventories = host.remoteInventories || {};
  }

  _peer () {
    return typeof this.host.getPeer === 'function' ? this.host.getPeer() : null;
  }

  _bitcoin () {
    return typeof this.host.getBitcoin === 'function' ? this.host.getBitcoin() : null;
  }

  _wallet () {
    return typeof this.host.getWallet === 'function' ? this.host.getWallet() : null;
  }

  _fs () {
    return typeof this.host.getFilesystem === 'function' ? this.host.getFilesystem() : null;
  }

  _settings () {
    return typeof this.host.getSettings === 'function' ? (this.host.getSettings() || {}) : {};
  }

  _networkName () {
    if (typeof this.host.getNetworkName === 'function') return this.host.getNetworkName() || 'regtest';
    return (this._settings().network || 'regtest');
  }

  _warn (msg) {
    if (typeof this.host.onWarning === 'function') this.host.onWarning(String(msg));
  }

  _notice (msg) {
    if (typeof this.host.onNotice === 'function') this.host.onNotice(String(msg));
    else this._warn(msg);
  }

  syncDocumentToPeer (documentId, content, rateSats = null) {
    const peer = this._peer();
    if (!peer) return;
    if (!peer._state.content.documents) peer._state.content.documents = {};
    if (!peer._state.content.documentRates) peer._state.content.documentRates = {};
    const body = Buffer.isBuffer(content) ? content.toString('utf8') : String(content == null ? '' : content);
    peer._state.content.documents[documentId] = body;
    if (rateSats != null && Number.isFinite(Number(rateSats))) {
      peer._state.content.documentRates[documentId] = Number(rateSats);
    }
  }

  formatLocalInventory () {
    const peer = this._peer();
    const rates = (peer && peer._state.content.documentRates) || {};
    const ids = Object.keys(this.documents);
    if (!ids.length) return '(empty — use /import <file>)';
    return ids.map((id) => {
      const buf = this.documents[id];
      const size = Buffer.isBuffer(buf) ? buf.length : Buffer.byteLength(String(buf || ''), 'utf8');
      const rate = Object.prototype.hasOwnProperty.call(rates, id) ? rates[id] : 0;
      return `  ${id}  ${size} bytes  rate=${rate} sats`;
    }).join('\n');
  }

  buyerRefundPubkeyHex () {
    try {
      const peer = this._peer();
      if (peer && peer.key && peer.key.public && typeof peer.key.public.encodeCompressed === 'function') {
        return peer.key.public.encodeCompressed('hex');
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  buyerPrivateKey32 () {
    try {
      const peer = this._peer();
      const key = peer && peer.key;
      if (!key) return null;
      if (key.keypair && typeof key.keypair.getPrivate === 'function') {
        const buf = key.keypair.getPrivate('bytes');
        if (Buffer.isBuffer(buf) && buf.length === 32) return buf;
      }
      if (Buffer.isBuffer(key.private) && key.private.length === 32) return key.private;
      if (typeof key.private === 'string' && /^[0-9a-fA-F]{64}$/.test(key.private)) {
        return Buffer.from(key.private, 'hex');
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  async fetchRawTxHex (txid) {
    const bitcoin = this._bitcoin();
    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') return null;
    const id = String(txid || '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(id)) return null;
    try {
      const raw = await bitcoin._makeRPCRequest('getrawtransaction', [id, false]);
      return typeof raw === 'string' && raw.length > 0 ? raw : null;
    } catch (_) {
      return null;
    }
  }

  async bitcoinTipHeight () {
    const bitcoin = this._bitcoin();
    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') return null;
    try {
      const info = await bitcoin._makeRPCRequest('getblockchaininfo');
      const h = info && info.blocks;
      return Number.isFinite(Number(h)) ? Number(h) : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * @param {string} filePath
   * @returns {ExchangeResult}
   */
  importFile (filePath) {
    if (filePath == null || String(filePath).trim() === '') {
      return { ok: false, error: 'You must provide a file to import.' };
    }
    const p = resolveImportFilePath(filePath);
    if (!p) {
      return {
        ok: false,
        error: 'Invalid import path (null bytes, escape of cwd, or unbound length).'
      };
    }
    let content;
    try {
      content = readResolvedImportFile(p);
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        return { ok: false, error: `File does not exist: ${p}` };
      }
      return { ok: false, error: `Cannot read import file: ${e.message || e}` };
    }
    const actor = new Actor(content);
    this.documents[actor.id] = content;
    this.syncDocumentToPeer(actor.id, content, 0);
    return {
      ok: true,
      message: `Imported ${content.length} bytes → Document ID: ${actor.id}`,
      data: { documentId: actor.id, size: content.length, content }
    };
  }

  /**
   * @param {string} documentId
   * @param {number|string} rateSats
   * @returns {ExchangeResult}
   */
  publish (documentId, rateSats) {
    const id = String(documentId || '').trim();
    if (!id) return { ok: false, error: 'Usage: /publish <documentID> <rateSats>' };
    if (rateSats == null || rateSats === '') {
      return { ok: false, error: 'Usage: /publish <documentID> <rateSats> — rate 0 = free gossip only' };
    }
    if (!this.documents[id]) {
      return { ok: false, error: 'This file does not exist in the local library. Use /import first.' };
    }
    const rate = Number(rateSats);
    if (!Number.isFinite(rate) || rate < 0) {
      return { ok: false, error: 'rateSats must be a non-negative number' };
    }
    const peer = this._peer();
    if (!peer || typeof peer._publishDocument !== 'function') {
      return { ok: false, error: 'Peer not ready.' };
    }
    const body = this.documents[id].toString('utf8');
    const filesystem = this._fs();
    if (filesystem && typeof filesystem.touchDir === 'function') {
      filesystem.touchDir('documents');
      filesystem.publish(`${id}`, this.documents[id]);
    }
    this.syncDocumentToPeer(id, body, rate);
    peer._publishDocument(id, body, rate);
    return { ok: true, message: `Published ${id} (rate=${rate} sats) to peers.`, data: { documentId: id, rateSats: rate } };
  }

  /**
   * @param {string|null} peerRef
   * @param {object} [opts]
   * @returns {ExchangeResult}
   */
  requestInventory (peerRef, opts = {}) {
    if (!peerRef) {
      const peer = this._peer();
      const pending = peer && typeof peer.listPendingDocumentRequests === 'function'
        ? peer.listPendingDocumentRequests()
        : [];
      return {
        ok: true,
        message: `{bold}Local inventory{/bold}\n${this.formatLocalInventory()}`,
        data: { local: true, pendingCount: pending.length, pending }
      };
    }
    const peer = this._peer();
    if (!peer) return { ok: false, error: 'Peer not ready.' };
    const offerBtc = !!opts.offerBtc;
    const invOpts = offerBtc
      ? { offerBtc: true, buyerRefundPublicKey: this.buyerRefundPubkeyHex() }
      : { kind: 'documents' };
    const ok = peer.requestPeerInventory(peerRef, invOpts);
    if (!ok) {
      return {
        ok: false,
        error: `Could not request inventory from ${peerRef} (not connected?). Try /peers then /connect <addr>.`
      };
    }
    return {
      ok: true,
      message: `Inventory request sent to ${peerRef}${offerBtc ? ' (offerBtc)' : ''}. Waiting for response…`,
      data: { peerRef, offerBtc }
    };
  }

  /**
   * @param {string} [documentId]
   * @returns {ExchangeResult}
   */
  listOffers (documentId = null) {
    const offers = this.offerBook.listOffers(documentId ? { documentId } : {});
    const ranked = this.offerBook.rankOffers(offers);
    if (!ranked.length) {
      return { ok: true, message: 'No offers in book. Use /inventory <peer> [btc] first.', offers: [] };
    }
    const lines = ranked.slice(0, 40).map((o, i) => {
      const blob = o.blobIndex != null ? ` blob=${o.blobIndex}/${o.blobTotal}` : '';
      return `  #${i + 1} ${o.documentId}${blob} seller=${o.sellerAddress} price=${o.rateSats} lat=${o.latencyMs}ms score=${o.peerScore} rank=${(o.rankScore || 0).toFixed(3)}`;
    });
    return {
      ok: true,
      message: `{bold}Document offers{/bold} (${ranked.length})\n${lines.join('\n')}`,
      offers: ranked
    };
  }

  /**
   * @param {string} documentId
   * @param {object} offer
   * @param {number|null} amountArg
   * @returns {object} session or { error }
   */
  /**
   * Resolve seller compressed pubkey from offer fields or the local peer registry.
   * @param {object} offer
   * @returns {string|null} 66-char hex or null
   */
  _resolveSellerPubkeyHex (offer = {}) {
    const direct = offer.sellerPubkey || offer.sellerPublicKey || offer.publicKey || null;
    if (direct && /^[0-9a-fA-F]{66}$/.test(String(direct).trim())) {
      return String(direct).trim().toLowerCase();
    }
    const peer = this._peer();
    const sid = String(offer.sellerId || offer.sellerAddress || offer.seller || '').trim();
    if (!peer || !sid) return null;
    const peers = peer.peers || {};
    for (const row of Object.values(peers)) {
      if (!row || typeof row !== 'object') continue;
      const pk = row.publicKey || row.id;
      if (!pk) continue;
      if (String(row.id) === sid || String(row.name) === sid || String(row.address) === sid || String(pk) === sid) {
        const hex = String(pk).trim().toLowerCase();
        if (/^[0-9a-f]{66}$/.test(hex)) return hex;
      }
    }
    return null;
  }

  openBuySessionFromOffer (documentId, offer, amountArg) {
    const amountSats = amountArg != null && Number.isFinite(amountArg)
      ? amountArg
      : (Number(offer.rateSats) || 0);
    // Never fund a seller-supplied address without rebuilding a buyer-bound HTLC tree.
    let paymentAddress = null;
    let bitcoinUri = null;
    let htlc = null;
    const contentHashHex = contentHashHexFromObject(offer);
    const peer = this._peer();
    if (contentHashHex && amountSats > 0) {
      try {
        const buyerHex = this.buyerRefundPubkeyHex();
        const sellerHex = this._resolveSellerPubkeyHex(offer);
        const lock = peer && peer.settings && peer.settings.inventoryHtlcLocktimeHeight;
        if (!buyerHex || !sellerHex || !lock) {
          return {
            error: 'Cannot open paid buy: need buyer refund key, seller pubkey, and inventoryHtlcLocktimeHeight to build a buyer-bound HTLC'
          };
        }
        const ampSigner = offer.ampSignerPubkey || offer.wireSignerPubkey ||
          (offer.htlc && (offer.htlc.ampSignerPubkey || offer.htlc.sellerPublicKeyHex)) || null;
        if (ampSigner && !inventoryHtlc.pubkeysMatchXOnly(ampSigner, sellerHex)) {
          return {
            error: 'Offer AMP signer does not match resolved seller pubkey — refusing to fund'
          };
        }
        const sellerAddr = offer.htlc && offer.htlc.paymentAddress
          ? String(offer.htlc.paymentAddress).trim()
          : '';
        const verdict = inventoryHtlc.validateInventoryHtlcOffer({
          networkName: this._networkName(),
          sellerPubkeyCompressed: sellerHex,
          buyerRefundPubkeyCompressed: buyerHex,
          paymentHash32: contentHashHex,
          refundLocktimeHeight: Number(lock),
          paymentAddress: sellerAddr || undefined
        });
        if (!verdict.ok) {
          return { error: verdict.error || 'HTLC offer validation failed' };
        }
        const built = verdict.built;
        const hints = inventoryHtlc.buildHtlcFundingHints({
          paymentAddress: built.address,
          amountSats,
          label: documentId.slice(0, 32)
        });
        paymentAddress = built.address;
        bitcoinUri = hints.bitcoinUri;
        htlc = {
          paymentAddress,
          paymentHashHex: built.paymentHashHex,
          claimScriptHex: built.claimScript.toString('hex'),
          refundScriptHex: built.refundScript.toString('hex'),
          refundLocktimeHeight: Number(lock),
          bitcoinUri,
          sellerPubkey: sellerHex,
          buyerRefundPubkey: buyerHex
        };
      } catch (e) {
        return { error: `Could not build local HTLC: ${e.message}` };
      }
    }
    const session = createDocumentPurchaseSession({
      documentId,
      seller: offer.sellerAddress,
      contentHashHex,
      amountSats,
      paymentAddress: paymentAddress || '',
      bitcoinUri,
      network: this._networkName(),
      blobIndex: offer.blobIndex,
      blobTotal: offer.blobTotal,
      blobHashHex: offer.blobHashHex,
      merkleRootHex: offer.merkleRootHex,
      htlc
    });
    if (isDuplicateSettlement(this.paidSettlements, session)) {
      return { error: `Already settled ${session.dedupeKey} — refusing double-pay` };
    }
    for (const open of this.purchaseSessions.values()) {
      if (open && open.status !== 'confirmed' && open.dedupeKey === session.dedupeKey) {
        return { error: `Open session already exists for ${session.dedupeKey} (${open.settlementId})` };
      }
    }
    this.purchaseSessions.set(session.settlementId, session);
    this.registerSessionHtlcWatch(session);
    return session;
  }

  registerSessionHtlcWatch (session) {
    const wallet = this._wallet();
    if (!session || !wallet || typeof wallet.watchHtlc !== 'function') return;
    try {
      wallet.watchHtlc({
        paymentAddress: session.paymentAddress || (session.htlc && session.htlc.paymentAddress),
        paymentHashHex: session.contentHashHex || (session.htlc && session.htlc.paymentHashHex),
        settlementId: session.settlementId,
        documentId: session.documentId
      });
    } catch (e) {
      this._warn(`Wallet HTLC watch not registered: ${e.message}`);
    }
  }

  /**
   * @param {string} documentId
   * @param {string} [sellerArg='auto']
   * @param {number|null} [amountArg]
   * @returns {ExchangeResult}
   */
  buy (documentId, sellerArg = 'auto', amountArg = null) {
    const id = String(documentId || '').trim();
    if (!id) return { ok: false, error: 'Usage: /buy <documentID> [seller|auto] [amountSats]' };
    const seller = sellerArg || 'auto';
    const amount = amountArg != null ? Number(amountArg) : null;

    const sample = this.offerBook.listOffers({ documentId: id })[0];
    const blobTotal = sample && sample.blobTotal != null ? Number(sample.blobTotal) : 0;
    if (seller === 'auto' && blobTotal > 1) {
      const plan = this.offerBook.pickBlobPlan(id, blobTotal);
      if (!plan.size) {
        return { ok: false, error: `No blob plan for ${id}. Run /inventory <peer> btc then /offers.` };
      }
      const sessions = [];
      const lines = [];
      for (const [idx, offer] of plan.entries()) {
        const session = this.openBuySessionFromOffer(id, offer, amount);
        if (session.error) return { ok: false, error: session.error };
        sessions.push(session);
        lines.push(
          `  blob ${idx}/${blobTotal} settlement=${session.settlementId}` +
          ` seller=${offer.sellerAddress} hash=${session.contentHashHex || 'n/a'}`
        );
      }
      return {
        ok: true,
        sessions,
        message:
          `{bold}Buy plan{/bold} ${id} (${plan.size} blobs)\n${lines.join('\n')}\n` +
          `Pay each, then /confirm <settlementId> <txid>`
      };
    }

    let offer = null;
    if (seller === 'auto') {
      offer = this.offerBook.pickBest(id, amount != null ? { maxSats: amount } : {});
    } else {
      const offers = this.offerBook.listOffers({ documentId: id }).filter((o) => {
        return o.sellerAddress === seller || o.sellerId === seller;
      });
      offer = this.offerBook.rankOffers(offers)[0] || null;
    }
    if (!offer) {
      return { ok: false, error: `No offer for ${id}. Run /inventory <peer> btc then /offers.` };
    }
    const session = this.openBuySessionFromOffer(id, offer, amount);
    if (session.error) return { ok: false, error: session.error };
    return {
      ok: true,
      session,
      message:
        `{bold}Buy session{/bold} ${session.settlementId}\n` +
        `  doc=${id} seller=${offer.sellerAddress} amount=${session.amountSats} sats` +
        (session.blobIndex != null ? ` blob=${session.blobIndex}/${session.blobTotal}` : '') + `\n` +
        `  contentHash=${session.contentHashHex || 'n/a'} (payment commitment)\n` +
        `  blobHash=${session.blobHashHex || 'n/a'}\n` +
        `  pay=${session.paymentAddress || '(no HTLC address — fund via Hub invoice or attachInventoryHtlc)'}\n` +
        `  uri=${session.bitcoinUri || 'n/a'}\n` +
        `Next: pay, then /confirm ${session.settlementId} <txid>`
    };
  }

  /**
   * @param {string} sessionKey
   * @param {string} txid
   * @returns {Promise<ExchangeResult>}
   */
  async confirm (sessionKey, txid) {
    if (!sessionKey || !txid) {
      return { ok: false, error: 'Usage: /confirm <settlementId|documentId> <txid>' };
    }
    const session = findSession(this.purchaseSessions, sessionKey);
    if (!session) return { ok: false, error: 'Unknown purchase session. Use /buy first.' };
    const tx = String(txid).trim();
    if (!/^[0-9a-fA-F]{64}$/.test(tx)) return { ok: false, error: 'txid must be 64 hex chars' };

    const settings = this._settings();
    if (settings.hubRpcUrl) {
      try {
        const body = {
          jsonrpc: '2.0',
          id: 1,
          method: 'ConfirmInventoryHtlcPayment',
          params: { settlementId: session.settlementId, txid: tx }
        };
        const res = await fetch(String(settings.hubRpcUrl).replace(/\/$/, '') + '/services/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json();
        if (json.error) return { ok: false, error: `Hub RPC: ${JSON.stringify(json.error)}` };
        if (isDuplicateSettlement(this.paidSettlements, session)) {
          return { ok: false, error: `Already confirmed settlement for ${session.dedupeKey}` };
        }
        rememberSettlement(this.paidSettlements, session);
        session.status = 'confirmed';
        return {
          ok: true,
          session,
          message: `Hub confirmed settlement ${session.settlementId}: ${JSON.stringify(json.result || json)}`
        };
      } catch (e) {
        return { ok: false, error: `Hub confirm failed: ${e.message}` };
      }
    }

    const bitcoin = this._bitcoin();
    if (bitcoin && typeof bitcoin._makeRPCRequest === 'function' && session.paymentAddress && session.amountSats > 0) {
      try {
        const raw = await bitcoin._makeRPCRequest('getrawtransaction', [tx, true]);
        const vouts = (raw && raw.vout) || [];
        let matched = 0;
        for (const v of vouts) {
          const addrs = (v.scriptPubKey && (v.scriptPubKey.addresses || (v.scriptPubKey.address ? [v.scriptPubKey.address] : []))) || [];
          if (addrs.includes(session.paymentAddress)) {
            matched += Math.round((v.value || 0) * 1e8);
          }
        }
        if (matched < session.amountSats) {
          return {
            ok: false,
            error: `L1 payment insufficient: found ${matched} sats to ${session.paymentAddress}, need ${session.amountSats}`
          };
        }
        this._notice(`L1 verified ${matched} sats to ${session.paymentAddress} in ${tx}`);
      } catch (e) {
        this._warn(`L1 verify skipped/failed: ${e.message}`);
      }
    }

    if (isDuplicateSettlement(this.paidSettlements, session)) {
      return { ok: false, error: `Already confirmed settlement for ${session.dedupeKey}` };
    }
    rememberSettlement(this.paidSettlements, session);
    session.status = 'confirmed';
    session.txid = tx;
    const fundedHex = await this.fetchRawTxHex(tx);
    if (fundedHex) session.fundedTxHex = fundedHex;
    const peer = this._peer();
    if (session.merkleRootHex && peer && peer.blobTransfers) {
      peer.blobTransfers.expectTransfer({
        documentId: session.documentId,
        merkleRootHex: session.merkleRootHex,
        total: session.blobTotal,
        blobHashHexes: session.blobHashHex ? [session.blobHashHex] : null
      });
    }
    session.status = 'delivery_pending';
    const reqOpts = { maxSats: session.amountSats };
    if (session.contentHashHex) reqOpts.contentHashHex = session.contentHashHex;
    if (session.blobIndex != null) reqOpts.blobIndex = session.blobIndex;
    if (session.blobTotal != null) reqOpts.blobTotal = session.blobTotal;
    const ok = peer ? peer.requestDocument(session.documentId, session.seller, reqOpts) : false;
    return {
      ok: true,
      session,
      message: ok
        ? `Confirmed ${session.settlementId}; DocumentRequest sent to ${session.seller}. ` +
          `Awaiting verified ciphertext then content-key reveal (or /claimwatch after seller claim).`
        : `Confirmed locally but could not send DocumentRequest to ${session.seller}.`
    };
  }

  /**
   * @param {string} sessionKey
   * @param {string|null} [claimTxid]
   * @returns {Promise<ExchangeResult>}
   */
  async claimWatch (sessionKey, claimTxid = null) {
    if (!sessionKey) {
      return { ok: false, error: 'Usage: /claimwatch <settlementId|documentId> [claimTxid]' };
    }
    const session = findSession(this.purchaseSessions, sessionKey);
    if (!session) return { ok: false, error: 'Unknown purchase session. Use /buy first.' };
    if (session.status === 'complete') {
      return { ok: true, message: `Session ${session.settlementId} already complete.`, session };
    }
    if (session.status === 'refunded') {
      return { ok: false, error: `Session ${session.settlementId} was refunded; cannot open.` };
    }

    let claim = claimTxid ? String(claimTxid).trim() : (session.claimTxid || null);
    const settings = this._settings();
    const peer = this._peer();

    if (!claim && settings.hubRpcUrl && settings.hubAdminToken) {
      try {
        const body = {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetInventoryHtlcSellerReveal',
          params: {
            settlementId: session.settlementId,
            adminToken: settings.hubAdminToken
          }
        };
        const res = await fetch(String(settings.hubRpcUrl).replace(/\/$/, '') + '/services/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json();
        const result = json && json.result;
        if (result && result.claimTxid) claim = String(result.claimTxid);
        if (result && result.preimageHex && peer) {
          const opened = peer.openSealedDeliveryWithPreimage(session.documentId, result.preimageHex);
          if (opened.ok) {
            session.status = 'complete';
            session.claimTxid = claim || session.claimTxid;
            session.openedFrom = 'hub_reveal';
            return {
              ok: true,
              session,
              message:
                `Opened ${session.documentId} from Hub seller reveal` +
                (claim ? ` (claimTxid=${claim})` : '') + '.'
            };
          }
        }
      } catch (e) {
        this._warn(`Hub seller-reveal lookup failed: ${e.message}`);
      }
    }

    if (!claim || !/^[0-9a-fA-F]{64}$/.test(claim)) {
      return {
        ok: false,
        error:
          'Usage: /claimwatch <settlementId> <claimTxid> — provide the seller claim txid ' +
          '(or configure hubRpcUrl + hubAdminToken for GetInventoryHtlcSellerReveal).'
      };
    }

    const paymentHash = session.contentHashHex ||
      (session.htlc && session.htlc.paymentHashHex) || null;
    if (!paymentHash) {
      return { ok: false, error: 'Session has no contentHash / paymentHash to match claim preimage.' };
    }

    const txHex = await this.fetchRawTxHex(claim);
    if (!txHex) {
      return {
        ok: false,
        error: `Could not fetch claim tx ${claim} (need local bitcoind). Pass a mined/mempool claimTxid.`
      };
    }

    const extracted = extractPreimageFromClaimTx(txHex, paymentHash);
    if (!extracted.ok) {
      return { ok: false, error: `Claim watch failed: ${extracted.error || 'preimage not found'}` };
    }

    session.claimTxid = claim;
    if (!peer) return { ok: false, error: 'Peer not ready.' };
    const opened = peer.openSealedDeliveryWithPreimage(session.documentId, extracted.preimageHex);
    if (!opened.ok) {
      session.error = opened.error;
      if (opened.error && /no pending sealed delivery/i.test(opened.error)) {
        return {
          ok: false,
          error:
            `Preimage found in claim ${claim} but no pending sealed ciphertext for ${session.documentId}. ` +
            `Wait for delivery (session status=${session.status}) then retry.`
        };
      }
      session.status = 'fraud';
      return { ok: false, error: `Open with claim preimage failed: ${opened.error}` };
    }
    session.status = 'complete';
    session.openedFrom = 'claim_witness';
    return {
      ok: true,
      session,
      message:
        `Opened ${session.documentId} from claim witness ${claim} ` +
        `(vin=${extracted.vin}, session ${session.settlementId} → complete).`
    };
  }

  /**
   * @param {string} sessionKey
   * @param {string|null} [destinationAddress]
   * @param {number|null} [feeSats]
   * @returns {Promise<ExchangeResult>}
   */
  async refund (sessionKey, destinationAddress = null, feeSats = null) {
    if (!sessionKey) {
      return { ok: false, error: 'Usage: /refund <settlementId|documentId> [destinationAddress] [feeSats]' };
    }
    const session = findSession(this.purchaseSessions, sessionKey);
    if (!session) return { ok: false, error: 'Unknown purchase session. Use /buy first.' };
    if (session.status === 'complete') {
      return { ok: false, error: `Session ${session.settlementId} already complete — refund refused.` };
    }
    if (session.status === 'refunded') {
      return {
        ok: true,
        message: `Session ${session.settlementId} already refunded (${session.refundTxid || 'n/a'}).`,
        session
      };
    }

    const htlc = session.htlc || {};
    const paymentAddress = session.paymentAddress || htlc.paymentAddress;
    const claimScriptHex = htlc.claimScriptHex;
    const refundScriptHex = htlc.refundScriptHex;
    const peer = this._peer();
    const refundLocktimeHeight = htlc.refundLocktimeHeight != null
      ? Number(htlc.refundLocktimeHeight)
      : Number(peer && peer.settings && peer.settings.inventoryHtlcLocktimeHeight);
    if (!paymentAddress || !claimScriptHex || !refundScriptHex || !Number.isFinite(refundLocktimeHeight)) {
      return {
        ok: false,
        error:
          'Session HTLC incomplete (need paymentAddress, claimScriptHex, refundScriptHex, refundLocktimeHeight). ' +
          'Re-buy via /inventory <peer> btc so the offer carries full HTLC scripts.'
      };
    }

    const tip = await this.bitcoinTipHeight();
    if (tip == null) {
      return { ok: false, error: 'Need local bitcoind for tip height (getblockchaininfo).' };
    }
    if (!refundLocktimeMature(tip, refundLocktimeHeight)) {
      return {
        ok: false,
        error: `Refund locktime not mature: tip=${tip}, need >= ${refundLocktimeHeight}.`
      };
    }

    let fundedTxHex = session.fundedTxHex || null;
    if (!fundedTxHex && session.txid) {
      fundedTxHex = await this.fetchRawTxHex(session.txid);
      if (fundedTxHex) session.fundedTxHex = fundedTxHex;
    }
    if (!fundedTxHex) {
      return {
        ok: false,
        error: 'Missing fundedTxHex — /confirm <id> <fundingTxid> with bitcoind, or set session.fundedTxHex.'
      };
    }

    const priv = this.buyerPrivateKey32();
    if (!priv) return { ok: false, error: 'Buyer private key unavailable on this node.' };

    let dest = destinationAddress ? String(destinationAddress).trim() : null;
    const bitcoin = this._bitcoin();
    if (!dest) {
      try {
        if (bitcoin && typeof bitcoin.getUnusedAddress === 'function') {
          dest = await bitcoin.getUnusedAddress();
        }
      } catch (_) { /* ignore */ }
    }
    if (!dest) {
      return { ok: false, error: 'Usage: /refund <settlementId> <destinationAddress> [feeSats]' };
    }

    const fee = feeSats != null ? Number(feeSats) : 1000;
    if (!Number.isFinite(fee) || fee < 1) {
      return { ok: false, error: 'feeSats must be a positive number' };
    }

    let signed;
    try {
      const bundle = prepareInventoryHtlcBuyerRefundPsbt({
        networkName: session.network || this._networkName(),
        fundedTxHex,
        paymentAddress,
        claimScript: claimScriptHex,
        refundScript: refundScriptHex,
        refundLocktimeHeight,
        destinationAddress: dest,
        feeSats: fee
      });
      signed = signAndExtractInventoryHtlcBuyerRefund(bundle, priv);
    } catch (e) {
      return { ok: false, error: `Refund PSBT failed: ${e.message}` };
    }

    try {
      const broadcast = await bitcoin._makeRPCRequest('sendrawtransaction', [signed.txHex]);
      session.status = 'refunded';
      session.refundTxid = broadcast || signed.txid;
      session.error = session.error || 'refunded after locktime';
      return {
        ok: true,
        session,
        message: `Refund broadcast for ${session.settlementId}: txid=${session.refundTxid} → ${dest}`
      };
    } catch (e) {
      session.refundTxHex = signed.txHex;
      return {
        ok: false,
        error:
          `Refund signed (txid=${signed.txid}) but broadcast failed: ${e.message}. ` +
          `Hex stored on session.refundTxHex.`
      };
    }
  }

  /**
   * @param {string} [filter='outstanding']
   * @returns {Promise<ExchangeResult>}
   */
  async listRefunds (filter = 'outstanding') {
    const f = filter ? String(filter).toLowerCase() : 'outstanding';
    const allowed = new Set(['outstanding', 'mature', 'failed', 'pending', 'refunded', 'all']);
    if (!allowed.has(f)) {
      return { ok: false, error: 'Usage: /refunds [outstanding|mature|failed|pending|refunded|all]' };
    }
    const tip = await this.bitcoinTipHeight();
    const rows = listRefundCandidates(this.purchaseSessions, tip, { filter: f });
    if (!rows.length) {
      return {
        ok: true,
        rows: [],
        message:
          `No ${f} refunds.` +
          (tip != null ? ` (tip=${tip})` : ' (bitcoind tip unavailable)') +
          `\nOpen a paid session with /buy, or try /refunds all.`
      };
    }
    const lines = rows.map((r) => {
      const lock = r.refundLocktimeHeight != null ? String(r.refundLocktimeHeight) : '?';
      const tipStr = r.tipHeight != null ? String(r.tipHeight) : '?';
      const wait = r.bucket === 'pending' && r.blocksRemaining
        ? ` wait=${r.blocksRemaining}blk`
        : '';
      const err = r.error ? ` err=${r.error}` : '';
      const ref = r.refundTxid ? ` refundTx=${r.refundTxid.slice(0, 12)}…` : '';
      return (
        `  [${r.bucket}] ${r.settlementId}  doc=${r.documentId}  status=${r.status}` +
        `  amount=${r.amountSats}  lock=${lock} tip=${tipStr}${wait}${ref}${err}`
      );
    });
    return {
      ok: true,
      rows,
      message:
        `{bold}Refunds{/bold} (${f}, ${rows.length}` +
        (tip != null ? `, tip=${tip}` : '') +
        `)\n${lines.join('\n')}\n` +
        `Mature rows: /refund <settlementId> [addr] [feeSats]`
    };
  }
}

module.exports = {
  CliDocumentExchange,
  DocumentOfferBook,
  createDocumentPurchaseSession,
  findSession,
  isDuplicateSettlement,
  rememberSettlement,
  listRefundCandidates,
  DOCUMENT_EXCHANGE_CLI_PACKS,
  listDocumentExchangeCliContracts,
  listDocumentExchangeCommands
};
