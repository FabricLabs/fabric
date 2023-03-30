'use strict';

const Actor = require('../actor');
// const Consensus = require('../consensus');
const Transaction = require('./transaction');

class BitcoinBlock extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      provider: 'bcoin',
      network: 'regtest'
    }, settings);

    // this.consensus = new Consensus(this.settings);
    this._state = {
      content: {},
      transactions: []
    };

    return this;
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
