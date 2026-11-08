'use strict';

/**
 * @fileoverview A {@link SignedBook} of maker entries a taker shops from:
 * coinjoin offers (`types/coinjoinBook`) and liquidity orders
 * (`types/liquidityBook`). Adds the market views both share: public
 * {@link OrderBook#ingest}, an optional cap on live entries per maker, the
 * live makers, and a filtered, ordered {@link OrderBook#list}. Subclasses
 * narrow the listing with {@link OrderBook#_matches}, order it with
 * {@link OrderBook#_compare}, and shape each row with {@link OrderBook#_view}.
 */

const SignedBook = require('./signedBook');

/**
 * Constructed like {@link SignedBook}; its `spec` may also name
 * `perMakerSetting`, the setting holding how many live entries one maker may
 * hold (its oldest is dropped).
 */
class OrderBook extends SignedBook {
  /**
   * Verify and hold a signed entry body.
   * @param {Object} body
   * @returns {{ ok: boolean, id: (string|null), reason: (string|null), duplicate: (boolean|undefined) }}
   */
  ingest (body) {
    return this._ingestSigned(body);
  }

  /**
   * A maker at its entry limit loses its oldest entry. In a full book the
   * maker holding the most entries (counting the incoming one; the incoming
   * maker on a tie) gives up its oldest, so one key cannot flush every other
   * maker out; with no such maker the book's oldest row goes.
   * @protected
   * @param {Object} entry verified body
   */
  _beforeInsert (entry) {
    const setting = this._spec.perMakerSetting;
    if (setting) {
      const mine = this._list((row) => this._body(row).makerPubkey === entry.makerPubkey);
      if (mine.length >= this.settings[setting]) this._delete(mine[0].id);
    }
    if (this.size < this._limit()) return;
    const byMaker = new Map();
    for (const row of this._rows()) {
      const maker = this._body(row).makerPubkey;
      if (byMaker.has(maker)) byMaker.get(maker).push(row);
      else byMaker.set(maker, [row]);
    }
    let victim = byMaker.get(entry.makerPubkey) || [];
    let most = victim.length + 1;
    for (const [maker, rows] of byMaker) {
      if (maker !== entry.makerPubkey && rows.length > most) {
        victim = rows;
        most = rows.length;
      }
    }
    if (victim.length) this._delete(victim[0].id);
  }

  /** @returns {Set<string>} makers with a live entry */
  makers () {
    return new Set(this._liveRows().map((row) => this._body(row).makerPubkey));
  }

  /**
   * Live entries, ordered by {@link OrderBook#_compare} (arrival by default).
   * @param {Object} [filter] passed to {@link OrderBook#_matches}
   * @param {string} [filter.makerPubkey]
   * @returns {Object[]} rows shaped by {@link OrderBook#_view} (`{ id, ...entry }`)
   */
  list (filter = {}) {
    const maker = filter.makerPubkey ? String(filter.makerPubkey).toLowerCase() : null;
    const rows = this._liveRows((entry) => {
      if (maker && entry.makerPubkey !== maker) return false;
      return this._matches(entry, filter);
    });
    rows.sort((a, b) => this._compare(a, b));
    return rows.map((row) => this._view(row));
  }

  /**
   * Market-specific listing filter.
   * @protected
   * @param {Object} _entry verified body
   * @param {Object} _filter
   * @returns {boolean}
   */
  _matches (_entry, _filter) {
    return true;
  }

  /**
   * Listing order of two rows `{ id, [field], seq }`.
   * @protected
   * @returns {number}
   */
  _compare (a, b) {
    return a.seq - b.seq;
  }

  /**
   * Public shape of one listed row.
   * @protected
   * @param {Object} row `{ id, [field], seq }`
   * @returns {Object}
   */
  _view (row) {
    return Object.assign({ id: row.id }, this._body(row));
  }
}

module.exports = OrderBook;
module.exports.OrderBook = OrderBook;
