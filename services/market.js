'use strict';

/**
 * @fileoverview Consumer budget agent for the Fabric document market.
 *
 * A `Market` holds a sats budget and a list of wanted documents (by id,
 * optionally Tree root + blob total). On each `tick()` it refreshes peer
 * inventories (filtered by `merkleRootHex` / `maxSats`), asks the local
 * `DocumentOfferBook` for the cheapest / fastest / most reliable blob plan,
 * and — when the plan fits `perPlanMaxSats` and the remaining budget — opens
 * one purchase session per blob (`createDocumentPurchaseSession`, one L1 HTLC
 * per seller per blob), funds it through the injected `pay` callback, confirms
 * with the injected `verify` callback, then sends `DocumentRequest`s. Delivery
 * and refund outcomes feed back into the offer book's local telemetry.
 *
 * Follows the Fabric Agent contract: `start()` / `stop()` / `tick()`, state
 * under `_state.content`, `debug` / `error` events. No wire changes: it only
 * drives existing `Peer` methods and existing message types.
 */

const crypto = require('crypto');
const Service = require('../types/service');
const DocumentOfferBook = require('../types/offerBook');
const inventoryHtlc = require('../functions/inventoryHtlc');
const { contentHashHexFromObject } = require('../functions/documentPaymentHash');
const {
  createDocumentPurchaseSession,
  isDuplicateSettlement,
  rememberSettlement,
  settlementDedupeKey
} = require('../functions/documentMarket');

/** @private */
const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Translate `proximityWeight` (0..1) into offer-book ranking weights: higher
 * proximity shifts weight from price toward measured latency + hops.
 * @param {number} proximityWeight
 * @returns {{ price: number, latency: number, peerScore: number, completeness: number }}
 */
function weightsForProximity (proximityWeight) {
  const p = Math.min(1, Math.max(0, Number(proximityWeight) || 0));
  // Keep reliability (peerScore) and completeness fixed; split the remaining 0.7.
  const latency = 0.1 + (0.5 * p);
  const price = 0.7 - latency;
  return { price, latency, peerScore: 0.2, completeness: 0.1 };
}

class Market extends Service {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.budgetSats=0] Total sats this agent may spend.
   * @param {number} [settings.perPlanMaxSats=0] Cap per document plan (0 = only the budget caps).
   * @param {number} [settings.proximityWeight=0.5] 0 = cheapest wins, 1 = nearest / fastest wins.
   * @param {number} [settings.tickMs=15000] Scheduler interval (0 = manual `tick()` only).
   * @param {number} [settings.inventoryEveryMs=30000] Minimum spacing between inventory refreshes per want.
   * @param {number} [settings.deliveryTimeoutMs=600000] Confirmed sessions without delivery fail after this (0 = never).
   * @param {string} [settings.network='regtest'] Bitcoin network for HTLC construction (mainnet refused).
   * @param {Object} [settings.book] `DocumentOfferBook` settings.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Market',
      budgetSats: 0,
      perPlanMaxSats: 0,
      proximityWeight: 0.5,
      tickMs: 15000,
      inventoryEveryMs: 30000,
      deliveryTimeoutMs: 10 * 60 * 1000,
      channelCltvDelta: 144,
      network: 'regtest',
      book: {}
    }, settings);

    this.peer = null;
    this.book = (settings.book instanceof DocumentOfferBook) ? settings.book : new DocumentOfferBook(this.settings.book || {});
    this._pay = null;
    this._verify = null;
    this._timer = null;
    this._bound = null;
    this.paidSettlements = new Set();

    this._state.content = {
      status: 'idle',
      budgetSats: Math.max(0, Math.floor(Number(this.settings.budgetSats) || 0)),
      spentSats: 0,
      reservedSats: 0,
      wants: {},
      sessions: {},
      completed: {},
      lastTick: null
    };

    return this;
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  /**
   * @param {Object} deps
   * @param {Object} deps.peer `@fabric/core` Peer (inventory, requests, delivery events).
   * @param {DocumentOfferBook} [deps.book] shared offer book (defaults to the agent's own).
   * @param {Function} [deps.pay] `async (session) => txid|null` — funds the session HTLC address.
   * @param {Function} [deps.verify] `async (session, txid) => boolean` — L1 / Hub payment proof.
   * @returns {Market}
   */
  attach (deps = {}) {
    if (deps.book instanceof DocumentOfferBook) this.book = deps.book;
    if (typeof deps.pay === 'function') this._pay = deps.pay;
    if (typeof deps.verify === 'function') this._verify = deps.verify;
    if (deps.channels && typeof deps.channels.sessionFor === 'function') {
      if (this._channels && this._channelsBound && typeof this._channels.removeListener === 'function') {
        this._channels.removeListener('htlcSettled', this._channelsBound);
      }
      this._channels = deps.channels;
      this._channelsBound = null;
      if (typeof deps.channels.on === 'function') {
        this._channelsBound = (ev) => this._onChannelHtlcSettled(ev);
        deps.channels.on('htlcSettled', this._channelsBound);
      }
    }
    if (deps.peer) this._bindPeer(deps.peer);
    return this;
  }

  /**
   * Phase 4 rail: when a Fabric payment channel (`Channel.Session`) is open
   * with the seller and holds enough balance, pay for the chunk with an
   * off-chain HTLC instead of an L1 funding transaction. The HTLC uses the
   * blob payment hash, so the seller's `DocumentContentKeyReveal` (K_i) is the
   * preimage that settles it.
   * @private
   * @param {Object} offer
   * @param {number} amountSats
   * @returns {Object|null} open `Channel.Session` able to pay `amountSats`
   */
  _channelFor (offer, amountSats) {
    if (!this._channels) return null;
    const sellerId = String(offer.sellerId || offer.sellerAddress || '');
    const channel = this._channels.sessionFor(sellerId, this._resolveSellerPubkeyHex(offer));
    if (!channel || channel.status !== 'open' || channel.balances.localSats < amountSats) return null;
    return channel;
  }

  /**
   * Offer the session's HTLC on its channel.
   * @private
   * @param {Object} session
   * @returns {{ status: ('offered'|'busy'|'unavailable'), reason: (string|undefined) }} `busy` = retry next tick (a round is mid-flight); `unavailable` = no usable channel (never confirm unpaid)
   */
  _settleOverChannel (session) {
    if (session.rail !== 'channel' || !this._channels || !session.contentHashHex || !(session.amountSats > 0)) return { status: 'unavailable', reason: 'not a channel session' };
    const channel = this._channels.sessionFor(session.sellerId, session.sellerPubkeyHex || null);
    if (!channel || channel.status !== 'open') return { status: 'unavailable', reason: 'channel not open' };
    if (channel.balances.localSats < session.amountSats) return { status: 'unavailable', reason: 'insufficient channel balance' };
    if (channel.busy) return { status: 'busy', reason: 'channel round in flight' };
    const tip = this._channels.tipHeight ? Number(this._channels.tipHeight()) : 0;
    if (!(tip > 0)) return { status: 'busy', reason: 'chain tip unknown' };
    const delta = Number(this.settings.channelCltvDelta) || 144;
    let body;
    try {
      body = channel.offerHtlc({
        amountSats: session.amountSats,
        paymentHashHex: session.contentHashHex,
        blobHashHex: session.blobHashHex || null,
        expireAfter: tip + delta
      });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      return { status: /busy|tip unknown|in-flight|in flight/i.test(msg) ? 'busy' : 'unavailable', reason: msg };
    }
    session.rail = 'channel';
    session.channelId = channel.channelId;
    session.channelHtlcId = body.htlc ? body.htlc.id : null;
    if (typeof this._channels.publish === 'function') this._channels.publish(body, channel);
    this.emit('channelHtlcOffered', { session, body });
    return { status: 'offered' };
  }

  /**
   * Channel-book settlement events (seller-fulfils). A fulfilled HTLC hands
   * the buyer `K_i`; a failed one releases the session without blaming the
   * seller for our own channel trouble.
   * @private
   * @param {Object} ev `htlcSettled` payload from `Channel.Book`
   */
  _onChannelHtlcSettled (ev) {
    if (!ev || !ev.htlcId) return;
    const session = Object.values(this._state.content.sessions).find((s) => s.rail === 'channel' && String(s.channelId) === String(ev.channelId) && String(s.channelHtlcId) === String(ev.htlcId));
    if (!session || session.status === 'complete') return;
    if (ev.outcome === 'fulfilled' && ev.preimageHex) {
      session.channelSettled = true;
      session.revealedKeyHex = String(ev.preimageHex).toLowerCase();
      // The sats left the channel whatever this session's status: always count them.
      this._accountChannelSpend(session);
      if (session.status === 'failed') {
        this._tryOpenWithKey(session);
        this.commit();
        return;
      }
      if (session.status === 'settling') this._complete(session, { keyHex: session.revealedKeyHex });
      else this._tryOpenWithKey(session);
    } else if (ev.outcome === 'failed' && session.status !== 'failed') {
      this._fail(session, `channel HTLC failed: ${ev.reason || 'unknown'}`, { penalize: false });
    }
    this.commit();
  }

  /** @private open a pending sealed blob with the preimage learned on the channel */
  _tryOpenWithKey (session) {
    if (!session.revealedKeyHex || !this.peer || typeof this.peer.openSealedBlobWithKey !== 'function') return false;
    let res = null;
    try {
      res = this.peer.openSealedBlobWithKey({ documentId: session.documentId, blobIndex: session.blobIndex, keyHex: session.revealedKeyHex, paymentHashHex: session.contentHashHex });
    } catch (_) { res = null; }
    return !!(res && res.ok);
  }

  /** @private count the channel payment once, when the HTLC is actually settled */
  _accountChannelSpend (session) {
    if (session._channelSpent) return;
    session._channelSpent = true;
    this._state.content.spentSats += session.amountSats || 0;
    this._release(session);
  }

  /** @private */
  _bindPeer (peer) {
    if (this.peer === peer) return;
    this._unbindPeer();
    this.peer = peer;
    this._bound = {
      inventory: (ev) => this._onInventoryResponse(ev),
      received: (ev) => this._onDocumentReceived(ev),
      blob: (ev) => this._onBlobOpened(ev),
      ciphertext: (ev) => this._onCiphertextReceived(ev)
    };
    peer.on('inventoryResponse', this._bound.inventory);
    peer.on('documentReceived', this._bound.received);
    peer.on('documentBlobOpened', this._bound.blob);
    peer.on('documentCiphertextReceived', this._bound.ciphertext);
  }

  /** @private */
  _unbindPeer () {
    if (!this.peer || !this._bound) return;
    this.peer.removeListener('inventoryResponse', this._bound.inventory);
    this.peer.removeListener('documentReceived', this._bound.received);
    this.peer.removeListener('documentBlobOpened', this._bound.blob);
    this.peer.removeListener('documentCiphertextReceived', this._bound.ciphertext);
    this._bound = null;
  }

  /** @private the ciphertext may land after the channel already revealed K_i */
  _onCiphertextReceived (ev) {
    if (!ev || !ev.documentId) return;
    for (const s of this._sessionsFor(ev.documentId, ev.blobIndex)) {
      if (s.revealedKeyHex) this._tryOpenWithKey(s);
    }
  }

  // ---------------------------------------------------------------------
  // Budget + wants
  // ---------------------------------------------------------------------

  get budgetSats () { return this._state.content.budgetSats; }
  get spentSats () { return this._state.content.spentSats; }
  get reservedSats () { return this._state.content.reservedSats; }
  get remainingSats () { return Math.max(0, this.budgetSats - this.spentSats - this.reservedSats); }

  /**
   * @param {number} sats
   * @returns {Market}
   */
  setBudget (sats) {
    this._state.content.budgetSats = Math.max(0, Math.floor(Number(sats) || 0));
    this.commit();
    return this;
  }

  /**
   * Register a document to acquire.
   * @param {string} documentId
   * @param {Object} [opts]
   * @param {number} [opts.blobTotal] Known blob count (else the first offer's).
   * @param {string} [opts.merkleRootHex] Tree root selector for inventory + plans.
   * @param {number} [opts.maxSats] Per-document cap (defaults to `perPlanMaxSats`).
   * @returns {Object} want record
   */
  want (documentId, opts = {}) {
    const id = String(documentId || '').trim();
    if (!id) throw new Error('documentId is required');
    const root = opts.merkleRootHex && HEX64.test(String(opts.merkleRootHex)) ? String(opts.merkleRootHex).toLowerCase() : null;
    const record = {
      documentId: id,
      merkleRootHex: root,
      blobTotal: opts.blobTotal != null ? Math.max(1, Math.round(Number(opts.blobTotal))) : null,
      maxSats: opts.maxSats != null ? Math.max(0, Math.floor(Number(opts.maxSats))) : null,
      status: 'wanted',
      created: Date.now(),
      lastInventoryAt: 0,
      sessions: [],
      lastError: null
    };
    this._state.content.wants[id] = record;
    this.commit();
    this.emit('debug', `[MARKET] want ${id}${root ? ' root=' + root.slice(0, 8) : ''}`);
    return record;
  }

  /**
   * @param {string} documentId
   * @returns {boolean}
   */
  forget (documentId) {
    const id = String(documentId || '').trim();
    const w = this._state.content.wants[id];
    if (!w) return false;
    for (const sid of w.sessions) {
      const s = this._state.content.sessions[sid];
      if (s && s.status === 'open') this._release(s);
    }
    delete this._state.content.wants[id];
    this.commit();
    return true;
  }

  /** @returns {Object[]} */
  listWants () {
    return Object.values(this._state.content.wants);
  }

  /** @returns {Object[]} */
  listSessions () {
    return Object.values(this._state.content.sessions);
  }

  /** @returns {Object} status summary (safe to expose over HTTP). */
  status () {
    const c = this._state.content;
    return {
      type: 'MarketAgentStatus',
      status: c.status,
      budgetSats: c.budgetSats,
      spentSats: c.spentSats,
      reservedSats: c.reservedSats,
      remainingSats: this.remainingSats,
      perPlanMaxSats: Math.max(0, Math.floor(Number(this.settings.perPlanMaxSats) || 0)),
      proximityWeight: Math.min(1, Math.max(0, Number(this.settings.proximityWeight) || 0)),
      wants: Object.values(c.wants).map((w) => ({
        documentId: w.documentId,
        merkleRootHex: w.merkleRootHex,
        blobTotal: w.blobTotal,
        maxSats: w.maxSats,
        status: w.status,
        sessions: w.sessions.length,
        lastError: w.lastError
      })),
      sessions: Object.values(c.sessions).map((s) => ({
        settlementId: s.settlementId,
        documentId: s.documentId,
        blobIndex: s.blobIndex != null ? s.blobIndex : null,
        seller: s.seller,
        amountSats: s.amountSats,
        status: s.status,
        txid: s.txid || null
      })),
      completed: Object.keys(c.completed).length,
      lastTick: c.lastTick
    };
  }

  // ---------------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------------

  /** @returns {Object} offer-book weights derived from `proximityWeight`. */
  weights () {
    return weightsForProximity(this.settings.proximityWeight);
  }

  /**
   * Cap for one document plan: min(perPlanMaxSats, want.maxSats, remaining budget).
   * @param {Object} want
   * @returns {number}
   */
  planCap (want) {
    const caps = [this.remainingSats];
    const perPlan = Math.floor(Number(this.settings.perPlanMaxSats) || 0);
    if (perPlan > 0) caps.push(perPlan);
    if (want && want.maxSats != null && want.maxSats > 0) caps.push(want.maxSats);
    return Math.max(0, Math.min(...caps));
  }

  /**
   * Build the blob plan for a want without spending anything.
   * @param {Object} want
   * @returns {{ ok: boolean, plan: (Map<number, Object>|undefined), costSats: (number|undefined), blobTotal: (number|undefined), error: (string|undefined) }}
   */
  planFor (want) {
    const id = want.documentId;
    const offers = this.book.listOffers(want.merkleRootHex ? { documentId: id, merkleRootHex: want.merkleRootHex } : { documentId: id });
    if (!offers.length) return { ok: false, error: 'no offers' };
    const blobTotal = want.blobTotal || Number(offers.find((o) => o.blobTotal != null && o.blobTotal > 0)?.blobTotal) || 1;
    const weights = this.weights();
    const plan = new Map();
    if (blobTotal > 1) {
      const picked = this.book.pickBlobPlan(id, blobTotal, { weights, merkleRootHex: want.merkleRootHex || undefined });
      for (const [i, o] of picked.entries()) plan.set(i, o);
      if (plan.size < blobTotal) return { ok: false, error: `plan incomplete (${plan.size}/${blobTotal})`, plan, blobTotal };
    } else {
      const best = this.book.pickBest(id, { weights, merkleRootHex: want.merkleRootHex || undefined });
      if (!best) return { ok: false, error: 'no offers' };
      plan.set(0, best);
    }
    // A plan is for one tree: every picked offer must agree on the root.
    const roots = new Set([...plan.values()].map((o) => o.merkleRootHex).filter(Boolean));
    if (roots.size > 1) return { ok: false, error: 'plan mixes merkle roots', plan, blobTotal };
    let costSats = 0;
    for (const o of plan.values()) costSats += Math.max(0, Math.floor(Number(o.rateSats) || 0));
    return { ok: true, plan, costSats, blobTotal, merkleRootHex: roots.size ? [...roots][0] : (want.merkleRootHex || null) };
  }

  // ---------------------------------------------------------------------
  // Scheduler
  // ---------------------------------------------------------------------

  /**
   * Start the agent: mark `running` and arm the periodic `tick` when `tickMs > 0`.
   * @returns {Promise<Market>}
   */
  async start () {
    this._state.content.status = 'running';
    this.emit('debug', `[MARKET] starting budget agent (${this.budgetSats} sats)`);
    if (this.settings.tickMs > 0 && !this._timer) {
      this._timer = setInterval(() => {
        this.tick().catch((e) => this.emit('error', `[MARKET] tick failed: ${e && e.message ? e.message : e}`));
      }, this.settings.tickMs);
      if (typeof this._timer.unref === 'function') this._timer.unref();
    }
    this.commit();
    return this;
  }

  /**
   * Stop the agent: clear the tick timer and detach peer / channel listeners.
   * @returns {Promise<Market>}
   */
  async stop () {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._unbindPeer();
    this._state.content.status = 'stopped';
    this.commit();
    return this;
  }

  /**
   * One scheduler pass: refresh inventories, plan, purchase within budget.
   * @returns {Promise<Object>} summary `{ planned, opened, skipped }`
   */
  async tick () {
    const summary = { planned: 0, opened: 0, skipped: 0, retried: 0 };
    this._state.content.lastTick = Date.now();
    this._sweepTimeouts();
    // Channel sessions deferred on a busy round, or holding bytes while the
    // HTLC is still open, get another try before new plans are made.
    for (const s of Object.values(this._state.content.sessions)) {
      if (s.status === 'channel_pending') { await this._settle(s); summary.retried++; } else if (s.status === 'settling') { this._complete(s, {}); summary.retried++; }
    }
    for (const want of Object.values(this._state.content.wants)) {
      if (want.status !== 'wanted') continue;
      this._refreshInventory(want);
      const planned = this.planFor(want);
      if (!planned.ok) {
        want.lastError = planned.error;
        summary.skipped++;
        continue;
      }
      summary.planned++;
      const cap = this.planCap(want);
      if (planned.costSats > cap) {
        want.lastError = `plan costs ${planned.costSats} sats > cap ${cap}`;
        summary.skipped++;
        continue;
      }
      try {
        const opened = await this.purchasePlan(want, planned);
        summary.opened += opened.length;
      } catch (e) {
        want.lastError = e && e.message ? e.message : String(e);
        this.emit('error', `[MARKET] purchase failed for ${want.documentId}: ${want.lastError}`);
      }
    }
    this.commit();
    return summary;
  }

  /** @private */
  _refreshInventory (want) {
    const peer = this.peer;
    if (!peer || !peer.connections) return;
    const now = Date.now();
    if (now - (want.lastInventoryAt || 0) < this.settings.inventoryEveryMs) return;
    want.lastInventoryAt = now;
    const opts = { offerBtc: true, maxSats: this.planCap(want) || undefined };
    const buyer = this.buyerRefundPubkeyHex();
    if (buyer) opts.buyerRefundPublicKey = buyer;
    if (want.merkleRootHex) opts.merkleRootHex = want.merkleRootHex;
    for (const address of Object.keys(peer.connections)) {
      try { peer.requestPeerInventory(address, opts); } catch (_) { /* skip dead connection */ }
    }
  }

  /** @returns {string|null} compressed buyer refund key (Peer identity). */
  buyerRefundPubkeyHex () {
    const peer = this.peer;
    const key = peer && peer.key;
    const pub = key && key.pubkey;
    if (!pub) return null;
    const hex = Buffer.isBuffer(pub) ? pub.toString('hex') : String(pub);
    return /^[0-9a-f]{66}$/i.test(hex) ? hex.toLowerCase() : null;
  }

  // ---------------------------------------------------------------------
  // Purchasing
  // ---------------------------------------------------------------------

  /**
   * Open, fund, confirm, and request every blob in a plan.
   * @param {Object} want
   * @param {{ plan: Map<number, Object>, blobTotal: number, costSats: number }} planned
   * @returns {Promise<Object[]>} opened sessions
   */
  async purchasePlan (want, planned) {
    const sessions = [];
    for (const [index, offer] of planned.plan.entries()) {
      const session = this.openSession(want, offer, index, planned.blobTotal);
      if (!session) continue;
      sessions.push(session);
    }
    if (!sessions.length) return sessions;
    want.status = 'buying';
    for (const session of sessions) {
      await this._settle(session);
    }
    return sessions;
  }

  /**
   * One purchase session for one blob (one HTLC per seller per blob).
   * @param {Object} want
   * @param {Object} offer
   * @param {number} blobIndex
   * @param {number} blobTotal
   * @returns {Object|null}
   */
  openSession (want, offer, blobIndex, blobTotal) {
    const amountSats = Math.max(0, Math.floor(Number(offer.rateSats) || 0));
    const contentHashHex = contentHashHexFromObject(offer);
    let htlc = null;
    let paymentAddress = '';
    const channel = amountSats > 0 && contentHashHex ? this._channelFor(offer, amountSats) : null;
    if (amountSats > 0 && contentHashHex && !channel) {
      const built = this._buildHtlc(offer, contentHashHex, amountSats, want.documentId);
      if (built.error) {
        want.lastError = built.error;
        this.book.recordDelivery(String(offer.sellerId || offer.sellerAddress), { ok: false, kind: 'htlc' });
        return null;
      }
      htlc = built.htlc;
      paymentAddress = built.htlc ? built.htlc.paymentAddress : '';
    }
    const session = createDocumentPurchaseSession({
      documentId: want.documentId,
      seller: offer.sellerAddress || offer.sellerId,
      contentHashHex,
      amountSats,
      paymentAddress,
      network: this.settings.network,
      blobIndex: blobTotal > 1 || offer.blobIndex != null ? blobIndex : undefined,
      blobTotal: blobTotal > 1 || offer.blobTotal != null ? blobTotal : undefined,
      blobHashHex: offer.blobHashHex,
      merkleRootHex: offer.merkleRootHex || want.merkleRootHex || undefined,
      htlc
    });
    if (isDuplicateSettlement(this.paidSettlements, session)) return null;
    for (const open of Object.values(this._state.content.sessions)) {
      if (open.status !== 'complete' && open.status !== 'failed' && open.dedupeKey === session.dedupeKey) return null;
    }
    session.sellerId = String(offer.sellerId || offer.sellerAddress || '');
    session.sellerPubkeyHex = this._resolveSellerPubkeyHex(offer) || null;
    if (channel) {
      session.rail = 'channel';
      session.channelId = channel.channelId;
    }
    session.openedAt = Date.now();
    this._state.content.sessions[session.settlementId] = session;
    this._state.content.reservedSats += amountSats;
    want.sessions.push(session.settlementId);
    this.emit('sessionOpened', session);
    return session;
  }

  /** @private */
  _buildHtlc (offer, contentHashHex, amountSats, documentId) {
    const buyerHex = this.buyerRefundPubkeyHex();
    const sellerHex = this._resolveSellerPubkeyHex(offer);
    const lock = this.peer && this.peer.settings && this.peer.settings.inventoryHtlcLocktimeHeight;
    if (!buyerHex || !sellerHex || !lock) {
      return { error: 'need buyer refund key, seller pubkey, and inventoryHtlcLocktimeHeight to build a buyer-bound HTLC' };
    }
    const ampSigner = offer.ampSignerPubkey || offer.wireSignerPubkey ||
      (offer.htlc && (offer.htlc.ampSignerPubkey || offer.htlc.sellerPublicKeyHex)) || null;
    if (ampSigner && !inventoryHtlc.pubkeysMatchXOnly(ampSigner, sellerHex)) {
      return { error: 'offer AMP signer does not match resolved seller pubkey — refusing to fund' };
    }
    try {
      const verdict = inventoryHtlc.validateInventoryHtlcOffer({
        networkName: this.settings.network,
        sellerPubkeyCompressed: sellerHex,
        buyerRefundPubkeyCompressed: buyerHex,
        paymentHash32: contentHashHex,
        refundLocktimeHeight: Number(lock),
        paymentAddress: offer.htlc && offer.htlc.paymentAddress ? String(offer.htlc.paymentAddress).trim() : undefined
      });
      if (!verdict.ok) return { error: verdict.error || 'HTLC offer validation failed' };
      const built = verdict.built;
      const hints = inventoryHtlc.buildHtlcFundingHints({
        paymentAddress: built.address,
        amountSats,
        label: String(documentId).slice(0, 32)
      });
      return {
        htlc: {
          paymentAddress: built.address,
          paymentHashHex: built.paymentHashHex,
          claimScriptHex: built.claimScript.toString('hex'),
          refundScriptHex: built.refundScript.toString('hex'),
          refundLocktimeHeight: Number(lock),
          bitcoinUri: hints.bitcoinUri,
          sellerPubkey: sellerHex,
          buyerRefundPubkey: buyerHex
        }
      };
    } catch (e) {
      return { error: `could not build local HTLC: ${e.message}` };
    }
  }

  /** @private */
  _resolveSellerPubkeyHex (offer) {
    const direct = offer.sellerPubkey || offer.ampSignerPubkey || (offer.htlc && offer.htlc.sellerPublicKeyHex);
    if (direct && /^[0-9a-f]{66}$/i.test(String(direct))) return String(direct).toLowerCase();
    const sid = String(offer.sellerId || offer.sellerAddress || '').trim();
    const peers = (this.peer && this.peer.peers) || {};
    for (const row of Object.values(peers)) {
      if (!row || typeof row !== 'object') continue;
      const pk = row.publicKey || row.id;
      if (!pk) continue;
      if (String(row.id) === sid || String(row.address) === sid || String(pk) === sid) {
        const hex = String(pk).trim().toLowerCase();
        if (/^[0-9a-f]{66}$/.test(hex)) return hex;
      }
    }
    return null;
  }

  /** @private */
  async _settle (session) {
    if (session.rail === 'channel') {
      const r = this._settleOverChannel(session);
      if (r.status === 'offered') return this.confirm(session.settlementId, null);
      if (r.status === 'busy') {
        // Defer: a channel round is in flight. The tick retries; nothing is
        // confirmed and no DocumentRequest goes out until the HTLC is offered.
        session.status = 'channel_pending';
        session.lastError = r.reason || null;
        this.emit('sessionDeferred', session);
        return session;
      }
      // Channel gone / underfunded after planning: that is our failure, not
      // the seller's — release the session without a reputation penalty.
      return this._fail(session, `channel unavailable: ${r.reason || 'unknown'}`, { penalize: false });
    }
    const needsFunding = session.amountSats > 0 && !!session.paymentAddress;
    if (needsFunding) {
      if (!this._pay) {
        session.status = 'awaiting_funding';
        this.emit('fundingRequired', session);
        return session;
      }
      let txid = null;
      try {
        txid = await this._pay(session);
      } catch (e) {
        return this._fail(session, `pay failed: ${e && e.message ? e.message : e}`);
      }
      if (!txid) return this._fail(session, 'pay returned no txid');
      if (this._verify) {
        let ok = false;
        try { ok = await this._verify(session, txid); } catch (_) { ok = false; }
        if (!ok) return this._fail(session, `payment to ${session.paymentAddress} not verified`);
      }
      session.txid = String(txid);
    }
    return this.confirm(session.settlementId, session.txid || null);
  }

  /**
   * Mark a session funded and request delivery.
   * @param {string} settlementId
   * @param {string|null} [txid]
   * @returns {Object} session
   */
  confirm (settlementId, txid = null) {
    const session = this._state.content.sessions[settlementId];
    if (!session) throw new Error(`unknown session ${settlementId}`);
    if (isDuplicateSettlement(this.paidSettlements, session)) return session;
    rememberSettlement(this.paidSettlements, session);
    if (txid) session.txid = String(txid);
    session.status = 'delivery_pending';
    session.confirmedAt = Date.now();
    const peer = this.peer;
    if (peer && peer.blobTransfers && session.merkleRootHex) {
      const index = Math.max(0, Math.floor(Number(session.blobIndex) || 0));
      let blobHashHexes = null;
      let paymentHashHexes = null;
      if (session.blobHashHex) {
        // Indexed by blobIndex and merged: earlier purchases of this tree stay pinned.
        blobHashHexes = [];
        blobHashHexes[index] = session.blobHashHex;
      }
      if (session.contentHashHex) {
        paymentHashHexes = [];
        paymentHashHexes[index] = session.contentHashHex;
      }
      try {
        peer.blobTransfers.expectTransfer({
          documentId: session.documentId,
          merkleRootHex: session.merkleRootHex,
          total: session.blobTotal,
          blobHashHexes,
          paymentHashHexes,
          merge: true
        });
      } catch (_) { /* optional */ }
    }
    const reqOpts = { maxSats: session.amountSats };
    if (session.contentHashHex) reqOpts.contentHashHex = session.contentHashHex;
    if (session.blobIndex != null) reqOpts.blobIndex = session.blobIndex;
    if (session.blobTotal != null) reqOpts.blobTotal = session.blobTotal;
    const sent = peer ? peer.requestDocument(session.documentId, session.seller, reqOpts) : false;
    if (!sent) this.emit('debug', `[MARKET] could not send DocumentRequest for ${settlementId}`);
    this.emit('sessionConfirmed', session);
    this.commit();
    return session;
  }

  /**
   * Fail a session, release its reservation, and hand the want back to the
   * scheduler (`wanted`) when no other live session is still working on it.
   * @private
   * @param {Object} session
   * @param {string} reason
   * @param {Object} [opts] `{ penalize: boolean }` — `false` when the failure is local (our channel / funding), so the seller's score is untouched
   * @returns {Object} session
   */
  _fail (session, reason, opts = {}) {
    session.status = 'failed';
    session.error = reason;
    this._release(session);
    if (opts.penalize !== false) this.book.recordDelivery(session.sellerId, { ok: false, kind: 'settlement' });
    const want = this._state.content.wants[session.documentId];
    if (want && want.status === 'buying') {
      const live = Object.values(this._state.content.sessions).some((s) => s.documentId === session.documentId && s !== session && !['complete', 'failed'].includes(s.status));
      if (!live) want.status = 'wanted';
      want.lastError = reason;
    }
    this.emit('sessionFailed', session);
    return session;
  }

  /** @private */
  _release (session) {
    if (session._released) return;
    session._released = true;
    this._state.content.reservedSats = Math.max(0, this._state.content.reservedSats - (session.amountSats || 0));
  }

  /** @private */
  _complete (session, ev = {}) {
    if (session.status === 'complete') return;
    if (session.rail === 'channel' && session.channelHtlcId && !session.channelSettled && this._channels) {
      // Seller-fulfils is the normal path (`htlcSettled`). If the seller
      // revealed K_i out of band instead, honour the deal by settling the
      // HTLC we offered — that only ever pays the counterparty. Nothing is
      // counted as spent until the settlement actually goes through.
      const keyHex = ev.keyHex || session.revealedKeyHex;
      const channel = keyHex ? this._channels.sessionFor(session.sellerId, session.sellerPubkeyHex || null) : null;
      if (channel) {
        try {
          const body = channel.fulfillHtlc(session.channelHtlcId, keyHex);
          if (typeof this._channels.publish === 'function') this._channels.publish(body, channel);
          session.channelSettled = true;
          this.emit('channelHtlcFulfilled', { session, body });
        } catch (e) {
          this.emit('warning', `[FABRIC:MARKET] channel settle failed: ${e.message}`);
        }
      }
      if (!session.channelSettled) {
        // Bytes are in hand but the HTLC is still open: keep the session
        // alive for `htlcSettled` / the next tick instead of booking a spend.
        session.status = 'settling';
        session.revealedKeyHex = keyHex || session.revealedKeyHex || null;
        this.emit('sessionSettling', session);
        return;
      }
    }
    session.status = 'complete';
    session.completedAt = Date.now();
    if (session.rail === 'channel') this._accountChannelSpend(session);
    else {
      this._release(session);
      this._state.content.spentSats += session.amountSats || 0;
    }
    const latencyMs = session.confirmedAt ? Date.now() - session.confirmedAt : null;
    this.book.recordDelivery(session.sellerId, {
      ok: true,
      latencyMs,
      bytes: ev.buffer ? ev.buffer.length : (ev.bytes || 0)
    });
    this.emit('sessionComplete', session);
  }

  // ---------------------------------------------------------------------
  // Peer events
  // ---------------------------------------------------------------------

  /** @private */
  _onInventoryResponse (ev) {
    if (!ev || !ev.message) return;
    try {
      // Peers may hand us the raw body (string / Buffer) or an already-parsed object.
      const raw = ev.message.body != null ? ev.message.body : ev.message.object;
      let payload;
      if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) payload = raw;
      else payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '{}'));
      if (!payload || !Array.isArray(payload.items)) return;
      const origin = ev.origin && typeof ev.origin === 'object' ? (ev.origin.name || ev.origin.address || ev.origin.id) : ev.origin;
      this.book.ingestInventoryResponse({
        origin: origin ? String(origin) : '',
        items: payload.items,
        signerPubkeyHex: ev.signerPubkeyHex || null,
        latencyMs: ev.latencyMs,
        hops: ev.hops
      });
    } catch (_) { /* malformed inventory bodies are ignored */ }
  }

  /** @private */
  _sessionsFor (documentId, blobIndex) {
    return Object.values(this._state.content.sessions).filter((s) => {
      if (s.documentId !== documentId) return false;
      if (s.status !== 'delivery_pending' && s.status !== 'settling') return false;
      if (blobIndex == null || s.blobIndex == null) return true;
      return Number(s.blobIndex) === Number(blobIndex);
    });
  }

  /** @private */
  _onBlobOpened (ev) {
    if (!ev || !ev.documentId) return;
    for (const s of this._sessionsFor(ev.documentId, ev.blobIndex)) this._complete(s, ev);
    this.commit();
  }

  /** @private */
  _onDocumentReceived (ev) {
    if (!ev || !ev.documentId) return;
    for (const s of this._sessionsFor(ev.documentId, null)) this._complete(s, ev);
    const want = this._state.content.wants[ev.documentId];
    if (want) {
      want.status = 'complete';
      this._state.content.completed[ev.documentId] = { at: Date.now(), merkleRootHex: ev.merkleRootHex || want.merkleRootHex || null };
    }
    this.commit();
  }

  /**
   * Expire confirmed sessions whose delivery never arrived (`deliveryTimeoutMs`);
   * the seller is marked failed in the offer book and the want returns to
   * `wanted` so the next tick can re-plan around that provider. Funds, if any,
   * stay claimable only by the buyer's HTLC refund leaf after locktime.
   * @private
   */
  _sweepTimeouts () {
    const timeout = Math.max(0, Number(this.settings.deliveryTimeoutMs) || 0);
    if (!timeout) return;
    const now = Date.now();
    for (const s of Object.values(this._state.content.sessions)) {
      if (s.status !== 'delivery_pending' || !s.confirmedAt) continue;
      if (now - s.confirmedAt < timeout) continue;
      // An open channel HTLC still moves sats if the seller fulfils late; it
      // ends through `htlcSettled` (fulfil, or fail at CLTV expiry) instead.
      if (s.rail === 'channel' && s.channelHtlcId && !s.channelSettled) continue;
      this._fail(s, 'delivery timed out');
      this.book.recordRefund(s.sellerId);
      const want = this._state.content.wants[s.documentId];
      if (want && want.status === 'buying') want.status = 'wanted';
    }
  }

  // ---------------------------------------------------------------------
  // Persistence helpers (hosts persist `export()` however they like)
  // ---------------------------------------------------------------------

  /** @returns {Object} JSON-safe snapshot including offer-book telemetry. */
  export () {
    const c = this._state.content;
    return {
      type: 'MarketAgentState',
      version: 1,
      budgetSats: c.budgetSats,
      spentSats: c.spentSats,
      wants: c.wants,
      sessions: c.sessions,
      completed: c.completed,
      paidSettlements: Array.from(this.paidSettlements),
      telemetry: this.book.exportTelemetry()
    };
  }

  /**
   * @param {Object} snapshot output of `export()`
   * @returns {Market}
   */
  import (snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return this;
    const c = this._state.content;
    if (snapshot.budgetSats != null) c.budgetSats = Math.max(0, Math.floor(Number(snapshot.budgetSats) || 0));
    if (snapshot.spentSats != null) c.spentSats = Math.max(0, Math.floor(Number(snapshot.spentSats) || 0));
    if (snapshot.wants && typeof snapshot.wants === 'object') c.wants = snapshot.wants;
    if (snapshot.sessions && typeof snapshot.sessions === 'object') c.sessions = snapshot.sessions;
    if (snapshot.completed && typeof snapshot.completed === 'object') c.completed = snapshot.completed;
    if (Array.isArray(snapshot.paidSettlements)) this.paidSettlements = new Set(snapshot.paidSettlements);
    c.reservedSats = Object.values(c.sessions)
      .filter((s) => ['open', 'awaiting_funding', 'delivery_pending', 'channel_pending', 'settling'].includes(s.status) && !s._channelSpent)
      .reduce((n, s) => n + (s.amountSats || 0), 0);
    if (snapshot.telemetry) this.book.importTelemetry(snapshot.telemetry);
    return this;
  }
}

Market.weightsForProximity = weightsForProximity;
Market.settlementDedupeKey = settlementDedupeKey;
Market.randomId = () => crypto.randomBytes(8).toString('hex');

module.exports = Market;
