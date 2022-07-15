'use strict';

// const Consensus = require('../consensus');
const Transaction = require('./transaction');

class BitcoinBlock {
  constructor (settings = {}) {
    this.settings = Object.assign({
      provider: 'bcoin',
      network: 'regtest'
    }, settings);

    // this.consensus = new Consensus(this.settings);
    this._state = {
      transactions: []
    };
  }

  set state (value) {
    // TODO: validation
    this._state = value;
  }

  get state () {
    return this._state;
  }

  get data () {
    return this.settings;
  }

  toBitcoinBlock () {
    const Block = this.consensus.Block;
    const block = new Block({
      txs: this.state.transactions.map((x) => {
        return new Transaction({
          hash: x
        });
      })
    });
    return block;
  }
}

module.exports = BitcoinBlock;
