'use strict';

const {
  MAX_CHANNEL_VALUE
} = require('../constants');

const Key = require('./key');
const Scribe = require('./scribe');
const Secret = require('./secret');

const Consensus = require('./consensus');

/**
 * Creates a channel between to peers.  Useful for aggregation
 * of many transactions over time, to be settled on-chain later.
 */
class Channel extends Scribe {
  /**
   * 
   * @param {Object} [settings] Configuration for the channel.
   */
  constructor (settings) {
    super(settings);

    // assign internal settings
    this.settings = Object.assign({
      asset: null,
      maximum: MAX_CHANNEL_VALUE, // 1 BTC in satoshis
      provider: 'bcoin',
      mode: 'bidirectional'
    }, settings);

    this.key = new Key();
    this.secret = new Secret();
    this.provider = new Consensus({ provider: this.settings.provider });

    this._state = {
      counterparty: this.settings.counterparty || {},
      value: {
        incoming: 0,
        outgoing: 0
      },
      inputs: []
    };

    Object.defineProperties(this, {
      '@allocation': { enumerable: false },
      '@data': { enumerable: false },
      '@input': { enumerable: false },
      // 'id': { enumerable: false },
      'config': { enumerable: false },
      'key': { enumerable: false },
      'observer': { enumerable: false },
      'provider': { enumerable: false },
      'settings': { enumerable: false },
      // 'size': { enumerable: false },
      'state': { enumerable: false },
    });

    this['@id'] = this.id;
    this.status = 'initialized';

    return this;
  }

  get counterparty () {
    return this._state.counterparty || null;
  }

  async fund (input) {
    this._state.inputs.push(input);
  }

  async open (channel = {}) {
    if (!channel.recipient) return console.error('Channel recipient must be provided.');
  }

  async _getSpendableOutput () {
    let mtx = new this.provider.MTX();
    let script = new this.provider.Script();

    let tx = mtx.toTX();
    // TODO: remove short-circuit
    return {
      '@type': "BitcoinTransactionOutput",
      "@data": {
        script: script,
        transaction: tx
      }
    };
  }
}

module.exports = Channel;
