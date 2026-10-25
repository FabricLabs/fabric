'use strict';

/**
 * @fileoverview Capped, keyed, insertion-ordered row store at the root of the
 * locally held books: {@link SignedBook} → {@link OrderBook}
 * (`types/coinjoinBook`, `types/liquidityBook`), `types/documentBook`, and
 * `types/channelBook`. Rows live in a `Map` so arrival order is iteration
 * order; past the capacity the oldest row goes. Subclasses own the row shape
 * and the public vocabulary (offers, orders, sessions); this class only keeps
 * the rows. A book is an {@link Actor} whose content is just its type name:
 * settings (clocks, keys) and rows stay out of Actor state.
 */

const Actor = require('./actor');

/**
 * Rows held before the oldest is evicted.
 * @private
 */
const MAX_ENTRIES = 10000;

class Book extends Actor {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.maxEntries=10000] rows held (oldest evicted)
   * @param {Function} [settings.now] clock in ms (tests)
   */
  constructor (settings = {}) {
    super({ type: new.target.name });
    this.settings = Object.assign({
      maxEntries: MAX_ENTRIES,
      now: () => Date.now()
    }, settings);
    // key → row, oldest first
    this._entries = new Map();
  }

  /**
   * Rows held before the oldest is evicted. Subclasses with their own
   * setting name (`maxOffers`, `maxOrders`) override this.
   * @returns {number}
   */
  get capacity () {
    return this.settings.maxEntries;
  }

  /**
   * {@link Book#capacity} as a usable bound: a missing or non-numeric
   * setting (e.g. `{ maxOrders: undefined }` overriding the default) falls
   * back to `MAX_ENTRIES` instead of leaving the book unbounded.
   * @private
   * @returns {number}
   */
  _limit () {
    const cap = this.capacity;
    const n = typeof cap === 'number' ? cap : Number(cap);
    return cap == null || Number.isNaN(n) ? MAX_ENTRIES : n;
  }

  /** @returns {number} rows held */
  get size () {
    return this._entries.size;
  }

  /** @returns {number} the book's clock, in ms */
  now () {
    return this.settings.now();
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  has (key) {
    return this._entries.has(key);
  }

  /**
   * @private
   * @param {string} key
   * @returns {Object|undefined} the stored row (not a copy)
   */
  _row (key) {
    return this._entries.get(key);
  }

  /**
   * Insert or refresh a row: a refreshed row moves to the newest position.
   * @private
   * @param {string} key
   * @param {Object} row
   */
  _put (key, row) {
    this._entries.delete(key);
    this._insert(key, row);
  }

  /**
   * Insert a row, evicting the oldest rows while the book is full.
   * @private
   * @param {string} key
   * @param {Object} row
   */
  _insert (key, row) {
    const limit = this._limit();
    while (this._entries.size && this._entries.size >= limit) {
      this._entries.delete(this._entries.keys().next().value);
    }
    this._entries.set(key, row);
  }

  /**
   * @private
   * @param {string} key
   * @returns {boolean} whether a row was removed
   */
  _delete (key) {
    return this._entries.delete(key);
  }

  /**
   * Remove every row matching `predicate`.
   * @private
   * @param {Function} predicate `(row, key) → boolean`
   * @returns {number} rows removed
   */
  _forget (predicate) {
    let n = 0;
    for (const [key, row] of this._entries) {
      if (predicate(row, key)) {
        this._entries.delete(key);
        n++;
      }
    }
    return n;
  }

  /**
   * @private
   * @returns {Iterator<Object>} rows, oldest first
   */
  _rows () {
    return this._entries.values();
  }

  /**
   * @private
   * @param {Function} [predicate] `(row, key) → boolean`
   * @returns {Object[]} matching rows, oldest first
   */
  _list (predicate) {
    const out = [];
    for (const [key, row] of this._entries) {
      if (!predicate || predicate(row, key)) out.push(row);
    }
    return out;
  }
}

module.exports = Book;
module.exports.Book = Book;
module.exports.MAX_ENTRIES = MAX_ENTRIES;
