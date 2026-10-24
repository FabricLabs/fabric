'use strict';

/**
 * @fileoverview Locally held order book for the L1/L2 liquidity swap market
 * (`functions/liquiditySwap`). Makers gossip signed `LiquidityOrder` bodies;
 * each node verifies and keeps its own book — there is no central matcher.
 * A taker walks the book by price-time priority with {@link LiquidityBook#fill}
 * and settles each fill with its maker (`types/liquiditySwap`). The mid
 * premium and spread from {@link LiquidityBook#index} are the market's priced
 * view of which layer's liquidity is scarcer: a positive mid means L1 sats
 * trade above L2 sats.
 */

const swap = require('../functions/liquiditySwap');

/**
 * Orders held before the oldest is evicted.
 * @private
 */
const MAX_ORDERS = 10000;
/**
 * Cancels remembered so a replayed order stays dead.
 * @private
 */
const MAX_CANCELLED = 10000;
/**
 * Cancels one key may hold for orders this book has not seen. Anyone can
 * sign those, so they are capped per signer and evicted first.
 * @private
 */
const MAX_PENDING_CANCELS_PER_MAKER = 100;

/** @private */
function cancelKey (orderId, makerPubkey) {
  return `${orderId}:${makerPubkey}`;
}

class LiquidityBook {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest'] only orders for this network are held
   * @param {number} [settings.maxOrders=10000]
   * @param {number} [settings.maxCancelled=10000]
   * @param {number} [settings.maxPendingCancelsPerMaker=100] cancels per key for orders not held
   * @param {Function} [settings.now] clock in ms (tests)
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      network: 'regtest',
      maxOrders: MAX_ORDERS,
      maxCancelled: MAX_CANCELLED,
      maxPendingCancelsPerMaker: MAX_PENDING_CANCELS_PER_MAKER,
      now: () => Date.now()
    }, settings);
    this.settings.network = String(this.settings.network).toLowerCase();
    // order id → `{ id, order, seq }`
    this._orders = new Map();
    // `orderId:makerPubkey` → the cancelled order's `expiresAt`, or null while it is not held
    this._cancelled = new Map();
    // maker → keys of its cancels for orders not held
    this._pendingCancels = new Map();
    this._seq = 0;
  }

  /** @returns {number} orders held */
  get size () {
    return this._orders.size;
  }

  /**
   * Verify and hold a signed `LiquidityOrder` body.
   * @param {Object} body
   * @returns {{ ok: boolean, id: (string|null), reason: (string|null), duplicate: (boolean|undefined) }}
   */
  ingestOrder (body) {
    if (!body || body.type !== swap.BODY_TYPES.ORDER) return { ok: false, id: null, reason: 'not a LiquidityOrder' };
    const v = swap.verifyBody(body);
    if (!v.ok) return { ok: false, id: null, reason: v.reason };
    const order = v.body;
    if (order.network !== this.settings.network) return { ok: false, id: v.id, reason: 'wrong network' };
    if (order.expiresAt <= this.settings.now()) return { ok: false, id: v.id, reason: 'order expired' };
    const cancelled = cancelKey(v.id, order.makerPubkey);
    if (this._cancelled.has(cancelled)) {
      this._confirmCancel(cancelled, order.expiresAt);
      return { ok: false, id: v.id, reason: 'order cancelled' };
    }
    if (this._orders.has(v.id)) return { ok: false, id: v.id, reason: 'duplicate order', duplicate: true };
    this.prune();
    while (this._orders.size >= this.settings.maxOrders) {
      this._orders.delete(this._orders.keys().next().value);
    }
    this._orders.set(v.id, { id: v.id, order, seq: ++this._seq });
    return { ok: true, id: v.id, reason: null };
  }

  /**
   * Apply a signed `LiquidityOrderCancel` from the order's maker. A cancel
   * for an order not held yet is remembered with its signer, so the order
   * cannot arrive later from that maker; another key's cancel never blocks it.
   * @param {Object} body
   * @returns {{ ok: boolean, id: (string|null), reason: (string|null) }}
   */
  cancel (body) {
    if (!body || body.type !== swap.BODY_TYPES.CANCEL) return { ok: false, id: null, reason: 'not a LiquidityOrderCancel' };
    const v = swap.verifyBody(body);
    if (!v.ok) return { ok: false, id: null, reason: v.reason };
    const { orderId, makerPubkey } = v.body;
    const held = this._orders.get(orderId);
    if (held && held.order.makerPubkey !== makerPubkey) return { ok: false, id: orderId, reason: 'cancel is not from the maker' };
    this._orders.delete(orderId);
    this._rememberCancelled(orderId, makerPubkey, held ? held.order.expiresAt : null);
    return { ok: true, id: orderId, reason: null };
  }

  /** @private */
  _rememberCancelled (orderId, makerPubkey, expiresAt) {
    const key = cancelKey(orderId, makerPubkey);
    if (this._cancelled.has(key)) {
      if (expiresAt != null) this._confirmCancel(key, expiresAt);
      return;
    }
    if (expiresAt == null) {
      const pending = this._pendingCancels.get(makerPubkey);
      if (pending && pending.size >= this.settings.maxPendingCancelsPerMaker) {
        this._forgetCancel(pending.values().next().value);
      }
    }
    if (this._cancelled.size >= this.settings.maxCancelled) this._evictCancel();
    this._cancelled.set(key, expiresAt);
    if (expiresAt == null) {
      if (!this._pendingCancels.has(makerPubkey)) this._pendingCancels.set(makerPubkey, new Set());
      this._pendingCancels.get(makerPubkey).add(key);
    }
  }

  /**
   * The cancelled order is known now: keep the cancel until it expires.
   * @private
   */
  _confirmCancel (key, expiresAt) {
    this._cancelled.set(key, expiresAt);
    this._dropPending(key);
  }

  /** @private */
  _forgetCancel (key) {
    this._cancelled.delete(key);
    this._dropPending(key);
  }

  /** @private */
  _dropPending (key) {
    const maker = key.slice(key.indexOf(':') + 1);
    const pending = this._pendingCancels.get(maker);
    if (pending && pending.delete(key) && !pending.size) this._pendingCancels.delete(maker);
  }

  /**
   * Make room for one cancel: drop cancels whose order expired, else the
   * oldest cancel for an order never held, else the oldest cancel.
   * @private
   */
  _evictCancel () {
    const now = this.settings.now();
    for (const [key, expiresAt] of this._cancelled) {
      if (expiresAt != null && expiresAt <= now) this._cancelled.delete(key);
    }
    if (this._cancelled.size < this.settings.maxCancelled) return;
    for (const [key, expiresAt] of this._cancelled) {
      if (expiresAt == null) return this._forgetCancel(key);
    }
    this._cancelled.delete(this._cancelled.keys().next().value);
  }

  /**
   * Drop expired orders.
   * @returns {number} orders removed
   */
  prune () {
    const now = this.settings.now();
    let n = 0;
    for (const [id, row] of this._orders) {
      if (row.order.expiresAt <= now) {
        this._orders.delete(id);
        n++;
      }
    }
    return n;
  }

  /**
   * Drop every order from one maker (disconnect, fraud, failed settlement).
   * @param {string} makerPubkey
   * @returns {number} orders removed
   */
  forgetMaker (makerPubkey) {
    const key = String(makerPubkey || '').toLowerCase();
    let n = 0;
    for (const [id, row] of this._orders) {
      if (row.order.makerPubkey === key) {
        this._orders.delete(id);
        n++;
      }
    }
    return n;
  }

  /**
   * @param {string} id
   * @returns {Object|null} the order body
   */
  get (id) {
    const row = this._orders.get(String(id || ''));
    return row ? Object.assign({}, row.order) : null;
  }

  /**
   * Live orders, best first within each side (bids by highest premium, asks
   * by lowest; ties by arrival).
   * @param {Object} [filter]
   * @param {string} [filter.side]
   * @param {string} [filter.makerPubkey]
   * @returns {Object[]} `{ id, ...order }`
   */
  listOrders (filter = {}) {
    const now = this.settings.now();
    const rows = [];
    for (const row of this._orders.values()) {
      if (row.order.expiresAt <= now) continue;
      if (filter.side && row.order.side !== filter.side) continue;
      if (filter.makerPubkey && row.order.makerPubkey !== String(filter.makerPubkey).toLowerCase()) continue;
      rows.push(row);
    }
    rows.sort((a, b) => {
      if (a.order.side !== b.order.side) return a.order.side === 'bid' ? -1 : 1;
      const byPrice = a.order.side === 'bid'
        ? b.order.premiumPpm - a.order.premiumPpm
        : a.order.premiumPpm - b.order.premiumPpm;
      return byPrice || (a.seq - b.seq);
    });
    return rows.map((row) => Object.assign({ id: row.id }, row.order));
  }

  /** @returns {Object|null} highest-premium live bid */
  bestBid () {
    return this.listOrders({ side: 'bid' })[0] || null;
  }

  /** @returns {Object|null} lowest-premium live ask */
  bestAsk () {
    return this.listOrders({ side: 'ask' })[0] || null;
  }

  /**
   * Price levels for one side, best first.
   * @param {string} side `bid` or `ask`
   * @returns {Object[]} `{ premiumPpm, sats, orders }` (`sats` sums `maxSats`)
   */
  depth (side) {
    const levels = [];
    for (const order of this.listOrders({ side })) {
      const last = levels[levels.length - 1];
      if (last && last.premiumPpm === order.premiumPpm) {
        last.sats += order.maxSats;
        last.orders++;
      } else {
        levels.push({ premiumPpm: order.premiumPpm, sats: order.maxSats, orders: 1 });
      }
    }
    return levels;
  }

  /**
   * The market's view of L1 vs. L2 liquidity.
   * @returns {{ instrument: string, network: string, bestBidPpm: (number|null), bestAskPpm: (number|null), midPpm: (number|null), spreadPpm: (number|null), bidSats: number, askSats: number, crossed: boolean }}
   */
  index () {
    const bid = this.bestBid();
    const ask = this.bestAsk();
    const sum = (side) => this.listOrders({ side }).reduce((total, o) => total + o.maxSats, 0);
    const both = bid && ask;
    return {
      instrument: swap.INSTRUMENT,
      network: this.settings.network,
      bestBidPpm: bid ? bid.premiumPpm : null,
      bestAskPpm: ask ? ask.premiumPpm : null,
      midPpm: both ? (bid.premiumPpm + ask.premiumPpm) / 2 : null,
      spreadPpm: both ? ask.premiumPpm - bid.premiumPpm : null,
      bidSats: sum('bid'),
      askSats: sum('ask'),
      crossed: Boolean(both && bid.premiumPpm >= ask.premiumPpm)
    };
  }

  /**
   * Walk one side of the book for `amountSats` of L1, best price first, then
   * earliest order. Each fill respects the order's `minSats` / `maxSats`; an
   * order whose minimum exceeds what is left, or whose fee leaves nothing to
   * pay on L2 for that amount, is skipped. Nothing is reserved — the taker
   * settles each fill with its maker.
   * @param {string} side the side being taken: `ask` buys L1, `bid` sells it
   * @param {number} amountSats
   * @param {Object} [opts]
   * @param {string[]} [opts.excludeMakers]
   * @param {number} [opts.limitPpm] worst premium accepted (max for asks, min for bids)
   * @returns {{ fills: Object[], filledSats: number, remainingSats: number, averagePpm: (number|null), l2Msat: number }}
   */
  fill (side, amountSats, opts = {}) {
    const want = Math.floor(Number(amountSats));
    if (!swap.SIDES.includes(side)) throw new Error('liquidityBook: side must be "bid" or "ask"');
    if (!Number.isSafeInteger(want) || want <= 0) throw new Error('liquidityBook: amountSats must be a positive integer');
    const exclude = new Set((opts.excludeMakers || []).map((k) => String(k).toLowerCase()));
    const limit = opts.limitPpm != null ? Number(opts.limitPpm) : null;
    const fills = [];
    let remaining = want;
    let weighted = 0;
    let l2Msat = 0;
    for (const order of this.listOrders({ side })) {
      if (remaining <= 0) break;
      if (exclude.has(order.makerPubkey)) continue;
      if (limit != null && (side === 'ask' ? order.premiumPpm > limit : order.premiumPpm < limit)) break;
      const chunk = Math.min(remaining, order.maxSats);
      if (chunk < order.minSats) continue;
      let q;
      try {
        q = swap.quote({ side, premiumPpm: order.premiumPpm, feeSats: order.feeSats, amountSats: chunk });
      } catch {
        continue;
      }
      fills.push({ orderId: order.id, order, amountSats: chunk, quote: q });
      remaining -= chunk;
      weighted += chunk * order.premiumPpm;
      l2Msat += q.l2Msat;
    }
    const filled = want - remaining;
    return {
      fills,
      filledSats: filled,
      remainingSats: remaining,
      averagePpm: filled > 0 ? weighted / filled : null,
      l2Msat
    };
  }
}

module.exports = LiquidityBook;
module.exports.LiquidityBook = LiquidityBook;
module.exports.MAX_ORDERS = MAX_ORDERS;
module.exports.MAX_CANCELLED = MAX_CANCELLED;
module.exports.MAX_PENDING_CANCELS_PER_MAKER = MAX_PENDING_CANCELS_PER_MAKER;
