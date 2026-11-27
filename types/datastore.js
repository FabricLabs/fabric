'use strict';

/**
 * A {@link Store} with a {@link Ledger}. The ledger, route, and ping behavior
 * live on Store; this name is the datastore path and <code>ledger: true</code>.
 */

const Store = require('./store');

class Datastore extends Store {
  /**
   * @param {Object} [state]
   */
  constructor (state) {
    super(Object.assign({
      path: './stores/datastore',
      ledger: true
    }, state));
  }
}

module.exports = Datastore;
