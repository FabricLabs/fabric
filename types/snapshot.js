'use strict';

const crypto = require('crypto');

/**
 * A type of message to be expected from a {@link Service}.
 */
class Snapshot {
  /**
   * Creates an instance of a {@link Snapshot}.
   * @param {Object} settings Map of settings to configure the {@link Snapshot} with.
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      '@type': 'Snapshot'
    }, settings);

    // Stores local state
    this._state = null;
  }

  set state (state) {
    if (!state) throw new Error('State must be provided.');
    this._state = state;
  }

  get state () {
    return Object.assign({}, this._state);
  }

  /**
   * Retrieves the `sha256` fingerprint for the {@link Snapshot} state.
   */
  commit () {
    return crypto.createHash('sha256').update(JSON.stringify(this.state)).digest('hex');
  }
}

module.exports = Snapshot;
