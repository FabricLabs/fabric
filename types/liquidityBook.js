'use strict';

/**
 * @fileoverview Locally held order book for the L1/L2 liquidity swap market
 * (bodies and codec: `types/swap`). Makers gossip signed `LiquidityOrder` bodies;
 * each node verifies and keeps its own book — there is no central matcher.
 * A taker walks the book by price-time priority with {@link LiquidityBook#fill}
 * and settles each fill with its maker (a {@link Swap}). The mid
 * premium and spread from {@link LiquidityBook#index} are the market's priced
 * view of which layer's liquidity is scarcer: a positive mid means L1 sats
 * trade above L2 sats.
 */

const Swap = require('./swap');
const OrderBook = require('./orderBook');

/**
 * Orders held before the oldest is evicted.
 * @private
 */
const MAX_ORDERS = 10000;

class LiquidityBook extends OrderBook {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest'] only orders for this network are held
   * @param {number} [settings.maxOrders=10000]
   * @param {number} [settings.maxCancelled=10000]
   * @param {number} [settings.maxPendingCancelsPerMaker=100] cancels per key for orders not held
   * @param {Function} [settings.now] clock in ms (tests)
   */
  constructor (settings = {}) {
    super(Object.assign({ maxOrders: MAX_ORDERS }, settings), {
      codec: Swap,
      entryType: Swap.BODY_TYPES.ORDER,
      cancelType: Swap.BODY_TYPES.CANCEL,
      field: 'order',
      idField: 'orderId',
      noun: 'order',
      capacitySetting: 'maxOrders'
    });
  }

  /**
   * {@link OrderBook#list} lists bids, then asks, best first within each side
   * (bids by highest premium, asks by lowest; ties by arrival).
   * `filter.side` keeps one side.
   * @protected
   */
  _matches (order, filter) {
    return !filter.side || order.side === filter.side;
  }

  /** @protected */
  _compare (a, b) {
    if (a.order.side !== b.order.side) return a.order.side === 'bid' ? -1 : 1;
    const byPrice = a.order.side === 'bid'
      ? b.order.premiumPpm - a.order.premiumPpm
      : a.order.premiumPpm - b.order.premiumPpm;
    return byPrice || (a.seq - b.seq);
  }

  /** @returns {Object|null} highest-premium live bid */
  bestBid () {
    return this.list({ side: 'bid' })[0] || null;
  }

  /** @returns {Object|null} lowest-premium live ask */
  bestAsk () {
    return this.list({ side: 'ask' })[0] || null;
  }

  /**
   * Price levels for one side, best first.
   * @param {string} side `bid` or `ask`
   * @returns {Object[]} `{ premiumPpm, sats, orders }` (`sats` sums `maxSats`)
   */
  depth (side) {
    const levels = [];
    for (const order of this.list({ side })) {
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
    const sum = (side) => this.list({ side }).reduce((total, o) => total + o.maxSats, 0);
    const both = bid && ask;
    return {
      instrument: Swap.INSTRUMENT,
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
    if (!Swap.SIDES.includes(side)) throw new Error('liquidityBook: side must be "bid" or "ask"');
    if (!Number.isSafeInteger(want) || want <= 0) throw new Error('liquidityBook: amountSats must be a positive integer');
    const exclude = new Set((opts.excludeMakers || []).map((k) => String(k).toLowerCase()));
    const limit = opts.limitPpm != null ? Number(opts.limitPpm) : null;
    const fills = [];
    let remaining = want;
    let weighted = 0;
    let l2Msat = 0;
    for (const order of this.list({ side })) {
      if (remaining <= 0) break;
      if (exclude.has(order.makerPubkey)) continue;
      if (limit != null && (side === 'ask' ? order.premiumPpm > limit : order.premiumPpm < limit)) break;
      const chunk = Math.min(remaining, order.maxSats);
      if (chunk < order.minSats) continue;
      let q;
      try {
        q = Swap.quote({ side, premiumPpm: order.premiumPpm, feeSats: order.feeSats, amountSats: chunk });
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
