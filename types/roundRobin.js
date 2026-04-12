'use strict';

const Circuit = require('./circuit');

/**
 * {@link Circuit} specialization for round-robin selection over a set of nodes or peers.
 * @class RoundRobin
 * @extends Circuit
 */
class RoundRobin extends Circuit {
  constructor (config = {}) {
    super(Object.assign({
      name: 'RoundRobin'
    }, config));
    this._rrIndex = 0;
    return this;
  }

  /**
   * @param {Array} items
   * @returns {*|null}
   */
  next (items = []) {
    if (!items.length) return null;
    const i = this._rrIndex % items.length;
    this._rrIndex = (this._rrIndex + 1) % Math.max(1, items.length);
    return items[i];
  }
}

module.exports = RoundRobin;
