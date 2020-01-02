'use strict';

const Entity = require('./entity');
const Service = require('./service');
const Collection = require('./collection');
const Transaction = require('./transaction');

/**
 * Stores a list of {@link Transaction} elements.
 * @emits {Message} confirmed Emitted when the Mempool has dropped a transaction.
 */
class Mempool extends Service {
  /**
   * Creates an instance of a {@link Mempool} {@link Service}.
   * @param {Object} settings Map of settings to utilize.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/mempool'
    }, settings);

    this.transactions = new Collection({
      type: Transaction
    });

    this._state = {
      transactions: []
    }

    return this;
  }

  async _remove (txid) {
    return false;
  }

  async add (transaction) {
    const entity = new Entity(transaction);
    const target = await this.transactions.create(transaction);
    // TODO: compare target.id and entity.id
    this._state.transactions.push(entity.id);
  }

  async confirm (txid) {
    const found = await this._findByTXID(txid);
    if (!found) throw new Error(`Could not find transaction: ${txid} in ${JSON.stringify(this.transactions.map())}`);
    this.emit('confirmed', txid);
  }

  async _findByTXID (txid) {
    return this._state.transactions.filter((x) => {
      return x.id == query;
    });
  }
}

module.exports = Mempool;
