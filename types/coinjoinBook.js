'use strict';

/**
 * @fileoverview Locally held offer book for the L1:L1 coinjoin market
 * ({@link Coinjoin}). Makers gossip signed `CoinjoinOffer` bodies; each
 * node verifies and keeps its own book. A taker draws makers at random with
 * {@link CoinjoinBook#choose}: fee is a hard limit, not a ranking (always
 * taking the cheapest makers would let one cheap Sybil fill every round), and
 * the draw is weighted by fidelity bond value so identities backed by locked
 * coins are picked more often. Bonds are checked on chain with
 * {@link CoinjoinBook#refreshBonds}; a bond outpoint claimed by two makers
 * counts for neither.
 */

const crypto = require('crypto');
const Coinjoin = require('./coinjoin');
const OrderBook = require('./orderBook');

/**
 * Offers held before the oldest is evicted.
 * @private
 */
const MAX_OFFERS = 10000;
/**
 * Live offers one maker may hold (e.g. one per amount band).
 * @private
 */
const MAX_OFFERS_PER_MAKER = 10;
/**
 * Selection weight of an unbonded maker, as a share of the mean bond value.
 * @private
 */
const NO_BOND_SHARE = 0.1;

/** @private */
function defaultRandom () {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

class CoinjoinBook extends OrderBook {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest'] only offers for this network are held
   * @param {number} [settings.maxOffers=10000]
   * @param {number} [settings.maxOffersPerMaker=10]
   * @param {number} [settings.maxCancelled=10000]
   * @param {number} [settings.maxPendingCancelsPerMaker=100]
   * @param {number} [settings.noBondShare=0.1] unbonded weight as a share of the mean bond value
   * @param {Function} [settings.now] clock in ms (tests)
   */
  constructor (settings = {}) {
    super(Object.assign({
      maxOffers: MAX_OFFERS,
      maxOffersPerMaker: MAX_OFFERS_PER_MAKER,
      noBondShare: NO_BOND_SHARE
    }, settings), {
      codec: Coinjoin,
      entryType: Coinjoin.BODY_TYPES.OFFER,
      cancelType: Coinjoin.BODY_TYPES.CANCEL,
      field: 'offer',
      idField: 'offerId',
      noun: 'offer',
      capacitySetting: 'maxOffers',
      perMakerSetting: 'maxOffersPerMaker'
    });
    // maker → `{ ok, value, outpoint, reason, checkedAt }`
    this._bonds = new Map();
  }

  /**
   * Bond results go with a maker's last offer.
   * @protected
   */
  _afterPrune () {
    const makers = this.makers();
    for (const maker of this._bonds.keys()) {
      if (!makers.has(maker)) this._bonds.delete(maker);
    }
  }

  /** @protected */
  _afterForget (makerPubkey) {
    this._bonds.delete(makerPubkey);
  }

  /**
   * Bond standing of one maker after {@link CoinjoinBook#refreshBonds}.
   * @param {string} makerPubkey
   * @returns {{ ok: boolean, value: number, outpoint: (string|null), reason: (string|null) }|null}
   */
  bondOf (makerPubkey) {
    const row = this._bonds.get(String(makerPubkey || '').toLowerCase());
    return row ? { ok: row.ok, value: row.value, outpoint: row.outpoint, reason: row.reason } : null;
  }

  /**
   * Live offers in arrival order ({@link OrderBook#list}), each `{ id, bondValue, ...offer }`.
   * `filter.amountSats` keeps only offers whose range covers it.
   * @protected
   */
  _matches (offer, filter) {
    const amount = filter.amountSats != null ? Number(filter.amountSats) : null;
    return amount == null || !(amount < offer.minSats || amount > offer.maxSats);
  }

  /** @protected */
  _view (row) {
    const bond = this._bonds.get(row.offer.makerPubkey);
    return Object.assign({ id: row.id, bondValue: bond && bond.ok ? bond.value : 0 }, row.offer);
  }

  /**
   * Check every advertised bond on chain. A maker's value is its best valid
   * bond; an outpoint whose bond key certified more than one maker counts for
   * none. Bond descriptors are public, so only a claim that verifies on chain
   * (certificate, output script, unspent) can share an outpoint: a copy, or a
   * certificate from a key that does not lock the output, leaves the owner's
   * bond standing.
   * @param {Object} verifier `{ verify(bond, makerPubkey) }` (e.g. `Bond.FidelityVerifier`)
   * @returns {Promise<{ checked: number, valid: number, shared: number }>}
   */
  async refreshBonds (verifier) {
    this.prune();
    const perMaker = new Map();
    for (const row of this._rows()) {
      const bond = row.offer.fidelityBond;
      if (!bond) continue;
      if (!perMaker.has(row.offer.makerPubkey)) perMaker.set(row.offer.makerPubkey, new Map());
      perMaker.get(row.offer.makerPubkey).set(`${bond.txid}:${bond.vout}`, bond);
    }
    let checked = 0;
    let valid = 0;
    let shared = 0;
    // maker → outpoint → verify result
    const results = new Map();
    const claims = new Map();
    for (const [maker, bonds] of perMaker) {
      const rows = new Map();
      for (const [outpoint, bond] of bonds) {
        checked++;
        let result;
        try {
          result = await verifier.verify(bond, maker);
        } catch (err) {
          result = { ok: false, reason: err.message, value: 0 };
        }
        rows.set(outpoint, result);
        if (!result.ok) continue;
        if (!claims.has(outpoint)) claims.set(outpoint, new Set());
        claims.get(outpoint).add(maker);
      }
      results.set(maker, rows);
    }
    const next = new Map();
    for (const [maker, rows] of results) {
      let best = { ok: false, value: 0, outpoint: null, reason: 'no valid bond' };
      for (const [outpoint, result] of rows) {
        if (result.ok && claims.get(outpoint).size > 1) {
          shared++;
          if (!best.ok) best.reason = 'bond advertised by another maker';
          continue;
        }
        if (result.ok && (!best.ok || result.value > best.value)) {
          best = { ok: true, value: result.value, outpoint, reason: null };
        } else if (!best.ok && !result.ok) {
          best.reason = result.reason;
        }
      }
      if (best.ok) valid++;
      best.checkedAt = this.now();
      next.set(maker, best);
    }
    this._bonds = next;
    return { checked, valid, shared };
  }

  /**
   * One candidate per maker for `amountSats`: its cheapest fitting offer.
   * @private
   */
  _candidates (amountSats, opts = {}) {
    const exclude = new Set((opts.exclude || []).map((k) => String(k).toLowerCase()));
    const maxFee = opts.maxFeeSats != null ? Number(opts.maxFeeSats) : Infinity;
    const best = new Map();
    for (const offer of this.list({ amountSats })) {
      if (exclude.has(offer.makerPubkey)) continue;
      const cjfeeSats = Coinjoin.makerFee(offer, amountSats);
      if (cjfeeSats > maxFee) continue;
      if (opts.requireBond && !offer.bondValue) continue;
      const prior = best.get(offer.makerPubkey);
      if (!prior || cjfeeSats < prior.cjfeeSats) best.set(offer.makerPubkey, Object.assign({ cjfeeSats }, offer));
    }
    return [...best.values()];
  }

  /**
   * Draw up to `count` distinct makers for a coinjoin of `amountSats`, at
   * random without replacement, weighted by bond value. Unbonded makers weigh
   * `noBondShare` × the mean bond value (or all weigh 1 when nobody is
   * bonded). Fees above `maxFeeSats` are excluded, never ranked.
   * @param {number} amountSats
   * @param {number} count
   * @param {Object} [opts]
   * @param {number} [opts.maxFeeSats] most any one maker may charge
   * @param {string[]} [opts.exclude] maker keys to skip (stalled, refused)
   * @param {boolean} [opts.requireBond=false]
   * @param {Function} [opts.random] `() => [0, 1)` (tests)
   * @returns {Object[]} offers `{ id, cjfeeSats, bondValue, ...offer }`
   */
  choose (amountSats, count, opts = {}) {
    const amount = Number(amountSats);
    const n = Number(count);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('coinjoinBook: amountSats must be a positive integer');
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error('coinjoinBook: count must be a positive integer');
    const random = typeof opts.random === 'function' ? opts.random : defaultRandom;
    const pool = this._candidates(amount, opts);
    const bonded = pool.filter((o) => o.bondValue > 0);
    const mean = bonded.length ? bonded.reduce((t, o) => t + o.bondValue, 0) / bonded.length : 0;
    const floor = mean > 0 ? mean * Number(this.settings.noBondShare) : 1;
    const weighted = pool.map((offer) => ({ offer, weight: offer.bondValue > 0 ? offer.bondValue : floor }));
    const chosen = [];
    while (chosen.length < n && weighted.length) {
      const total = weighted.reduce((t, w) => t + w.weight, 0);
      let pick = random() * total;
      let index = weighted.length - 1;
      for (let i = 0; i < weighted.length; i++) {
        pick -= weighted[i].weight;
        if (pick < 0) {
          index = i;
          break;
        }
      }
      chosen.push(weighted.splice(index, 1)[0].offer);
    }
    return chosen;
  }

  /**
   * Summary of the market.
   * @param {number} [amountSats] also report makers and fees for this amount
   * @returns {Object}
   */
  index (amountSats) {
    const offers = this.list();
    const makers = new Set(offers.map((o) => o.makerPubkey));
    const bonded = [...makers].filter((m) => {
      const b = this._bonds.get(m);
      return b && b.ok;
    });
    const values = bonded.map((m) => this._bonds.get(m).value);
    const totalBondValue = values.reduce((t, v) => t + v, 0);
    const out = {
      network: this.settings.network,
      offers: offers.length,
      makers: makers.size,
      bondedMakers: bonded.length,
      totalBondValue,
      topBondShare: totalBondValue > 0 ? Math.max(...values) / totalBondValue : null,
      minSats: offers.length ? Math.min(...offers.map((o) => o.minSats)) : null,
      maxSats: offers.length ? Math.max(...offers.map((o) => o.maxSats)) : null
    };
    if (amountSats != null) {
      const fees = this._candidates(Number(amountSats)).map((o) => o.cjfeeSats).sort((a, b) => a - b);
      out.amountSats = Number(amountSats);
      out.makersForAmount = fees.length;
      out.cheapestFeeSats = fees.length ? fees[0] : null;
      out.medianFeeSats = fees.length ? fees[Math.floor(fees.length / 2)] : null;
    }
    return out;
  }
}

module.exports = CoinjoinBook;
module.exports.CoinjoinBook = CoinjoinBook;
module.exports.MAX_OFFERS = MAX_OFFERS;
module.exports.MAX_OFFERS_PER_MAKER = MAX_OFFERS_PER_MAKER;
module.exports.NO_BOND_SHARE = NO_BOND_SHARE;
