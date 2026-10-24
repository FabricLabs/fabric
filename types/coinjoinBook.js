'use strict';

/**
 * @fileoverview Locally held offer book for the L1:L1 coinjoin market
 * (`functions/coinjoin`). Makers gossip signed `CoinjoinOffer` bodies; each
 * node verifies and keeps its own book. A taker draws makers at random with
 * {@link CoinjoinBook#choose}: fee is a hard limit, not a ranking (always
 * taking the cheapest makers would let one cheap Sybil fill every round), and
 * the draw is weighted by fidelity bond value so identities backed by locked
 * coins are picked more often. Bonds are checked on chain with
 * {@link CoinjoinBook#refreshBonds}; a bond outpoint claimed by two makers
 * counts for neither.
 */

const crypto = require('crypto');
const coinjoin = require('../functions/coinjoin');

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
 * Cancels remembered so a replayed offer stays dead.
 * @private
 */
const MAX_CANCELLED = 10000;
/**
 * Cancels one key may hold for offers this book has not seen.
 * @private
 */
const MAX_PENDING_CANCELS_PER_MAKER = 100;
/**
 * Selection weight of an unbonded maker, as a share of the mean bond value.
 * @private
 */
const NO_BOND_SHARE = 0.1;

/** @private */
function cancelKey (offerId, makerPubkey) {
  return `${offerId}:${makerPubkey}`;
}

/** @private */
function defaultRandom () {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

class CoinjoinBook {
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
    this.settings = Object.assign({
      network: 'regtest',
      maxOffers: MAX_OFFERS,
      maxOffersPerMaker: MAX_OFFERS_PER_MAKER,
      maxCancelled: MAX_CANCELLED,
      maxPendingCancelsPerMaker: MAX_PENDING_CANCELS_PER_MAKER,
      noBondShare: NO_BOND_SHARE,
      now: () => Date.now()
    }, settings);
    this.settings.network = String(this.settings.network).toLowerCase();
    // offer id → `{ id, offer, seq }`
    this._offers = new Map();
    // `offerId:makerPubkey` → the cancelled offer's `expiresAt`, or null while it is not held
    this._cancelled = new Map();
    // maker → keys of its cancels for offers not held
    this._pendingCancels = new Map();
    // maker → `{ ok, value, outpoint, reason, checkedAt }`
    this._bonds = new Map();
    this._seq = 0;
  }

  /** @returns {number} offers held */
  get size () {
    return this._offers.size;
  }

  /**
   * Verify and hold a signed `CoinjoinOffer` body.
   * @param {Object} body
   * @returns {{ ok: boolean, id: (string|null), reason: (string|null), duplicate: (boolean|undefined) }}
   */
  ingestOffer (body) {
    if (!body || body.type !== coinjoin.BODY_TYPES.OFFER) return { ok: false, id: null, reason: 'not a CoinjoinOffer' };
    const v = coinjoin.verifyBody(body);
    if (!v.ok) return { ok: false, id: null, reason: v.reason };
    const offer = v.body;
    if (offer.network !== this.settings.network) return { ok: false, id: v.id, reason: 'wrong network' };
    if (offer.expiresAt <= this.settings.now()) return { ok: false, id: v.id, reason: 'offer expired' };
    const cancelled = cancelKey(v.id, offer.makerPubkey);
    if (this._cancelled.has(cancelled)) {
      this._confirmCancel(cancelled, offer.expiresAt);
      return { ok: false, id: v.id, reason: 'offer cancelled' };
    }
    if (this._offers.has(v.id)) return { ok: false, id: v.id, reason: 'duplicate offer', duplicate: true };
    this.prune();
    const mine = [...this._offers.values()].filter((row) => row.offer.makerPubkey === offer.makerPubkey);
    if (mine.length >= this.settings.maxOffersPerMaker) this._offers.delete(mine[0].id);
    while (this._offers.size >= this.settings.maxOffers) {
      this._offers.delete(this._offers.keys().next().value);
    }
    this._offers.set(v.id, { id: v.id, offer, seq: ++this._seq });
    return { ok: true, id: v.id, reason: null };
  }

  /**
   * Apply a signed `CoinjoinOfferCancel` from the offer's maker. A cancel for
   * an offer not held yet is remembered with its signer, so the offer cannot
   * arrive later from that maker; another key's cancel never blocks it.
   * @param {Object} body
   * @returns {{ ok: boolean, id: (string|null), reason: (string|null) }}
   */
  cancel (body) {
    if (!body || body.type !== coinjoin.BODY_TYPES.CANCEL) return { ok: false, id: null, reason: 'not a CoinjoinOfferCancel' };
    const v = coinjoin.verifyBody(body);
    if (!v.ok) return { ok: false, id: null, reason: v.reason };
    const { offerId, makerPubkey } = v.body;
    const held = this._offers.get(offerId);
    if (held && held.offer.makerPubkey !== makerPubkey) return { ok: false, id: offerId, reason: 'cancel is not from the maker' };
    this._offers.delete(offerId);
    this._rememberCancelled(offerId, makerPubkey, held ? held.offer.expiresAt : null);
    return { ok: true, id: offerId, reason: null };
  }

  /** @private */
  _rememberCancelled (offerId, makerPubkey, expiresAt) {
    const key = cancelKey(offerId, makerPubkey);
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

  /** @private */
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

  /** @private */
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
   * Drop expired offers (and bond results for makers with none left).
   * @returns {number} offers removed
   */
  prune () {
    const now = this.settings.now();
    let n = 0;
    for (const [id, row] of this._offers) {
      if (row.offer.expiresAt <= now) {
        this._offers.delete(id);
        n++;
      }
    }
    if (n) this._dropOrphanBonds();
    return n;
  }

  /** @private */
  _dropOrphanBonds () {
    const makers = new Set([...this._offers.values()].map((row) => row.offer.makerPubkey));
    for (const maker of this._bonds.keys()) {
      if (!makers.has(maker)) this._bonds.delete(maker);
    }
  }

  /**
   * Drop every offer from one maker (stalled a round, failed validation).
   * @param {string} makerPubkey
   * @returns {number} offers removed
   */
  forgetMaker (makerPubkey) {
    const key = String(makerPubkey || '').toLowerCase();
    let n = 0;
    for (const [id, row] of this._offers) {
      if (row.offer.makerPubkey === key) {
        this._offers.delete(id);
        n++;
      }
    }
    this._bonds.delete(key);
    return n;
  }

  /**
   * @param {string} id
   * @returns {Object|null} the offer body
   */
  get (id) {
    const row = this._offers.get(String(id || ''));
    return row ? Object.assign({}, row.offer) : null;
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
   * Live offers in arrival order.
   * @param {Object} [filter]
   * @param {string} [filter.makerPubkey]
   * @param {number} [filter.amountSats] only offers whose range covers this
   * @returns {Object[]} `{ id, bondValue, ...offer }`
   */
  listOffers (filter = {}) {
    const now = this.settings.now();
    const maker = filter.makerPubkey ? String(filter.makerPubkey).toLowerCase() : null;
    const amount = filter.amountSats != null ? Number(filter.amountSats) : null;
    const rows = [];
    for (const row of this._offers.values()) {
      if (row.offer.expiresAt <= now) continue;
      if (maker && row.offer.makerPubkey !== maker) continue;
      if (amount != null && (amount < row.offer.minSats || amount > row.offer.maxSats)) continue;
      rows.push(row);
    }
    rows.sort((a, b) => a.seq - b.seq);
    return rows.map((row) => {
      const bond = this._bonds.get(row.offer.makerPubkey);
      return Object.assign({ id: row.id, bondValue: bond && bond.ok ? bond.value : 0 }, row.offer);
    });
  }

  /**
   * Check every advertised bond on chain. A maker's value is its best valid
   * bond; an outpoint advertised by more than one maker counts for none.
   * @param {Object} verifier `{ verify(bond, makerPubkey) }` (e.g. `functions/fidelityBond` `BondVerifier`)
   * @returns {Promise<{ checked: number, valid: number, shared: number }>}
   */
  async refreshBonds (verifier) {
    this.prune();
    const claims = new Map();
    const perMaker = new Map();
    for (const row of this._offers.values()) {
      const bond = row.offer.fidelityBond;
      if (!bond) continue;
      const outpoint = `${bond.txid}:${bond.vout}`;
      if (!claims.has(outpoint)) claims.set(outpoint, new Set());
      claims.get(outpoint).add(row.offer.makerPubkey);
      if (!perMaker.has(row.offer.makerPubkey)) perMaker.set(row.offer.makerPubkey, new Map());
      perMaker.get(row.offer.makerPubkey).set(outpoint, bond);
    }
    let checked = 0;
    let valid = 0;
    let shared = 0;
    const next = new Map();
    for (const [maker, bonds] of perMaker) {
      let best = { ok: false, value: 0, outpoint: null, reason: 'no valid bond' };
      for (const [outpoint, bond] of bonds) {
        if (claims.get(outpoint).size > 1) {
          shared++;
          if (!best.ok) best.reason = 'bond advertised by another maker';
          continue;
        }
        checked++;
        let result;
        try {
          result = await verifier.verify(bond, maker);
        } catch (err) {
          result = { ok: false, reason: err.message, value: 0 };
        }
        if (result.ok && (!best.ok || result.value > best.value)) {
          best = { ok: true, value: result.value, outpoint, reason: null };
        } else if (!best.ok && !result.ok) {
          best.reason = result.reason;
        }
      }
      if (best.ok) valid++;
      best.checkedAt = this.settings.now();
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
    for (const offer of this.listOffers({ amountSats })) {
      if (exclude.has(offer.makerPubkey)) continue;
      const cjfeeSats = coinjoin.makerFee(offer, amountSats);
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
    const offers = this.listOffers();
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
