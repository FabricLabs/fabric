'use strict';

const Store = require('./store');

/**
 * Persistent data storage.
 * @param       {Object} config Configuration for internal datastore.
 * @constructor
 */
class Storage extends Store {
  constructor (config) {
    super(config);
    this.config = Object.assign({
      path: './data/storage',
      get: this.get,
      set: this.set,
      del: this.del,
      transform: this.transform,
      createReadStream: this.createReadStream
    }, config);
    return this;
  }

  async _populate () {
    let output = [];

    if (!this.output) return new Error('Populate called, but no output was provided.');

    for (let i in this.output) {
      let id = this.output[i];
      // TODO: use this._GET(id);
      output.push({ id });
    }

    return output;
  }
}

module.exports = Storage;
