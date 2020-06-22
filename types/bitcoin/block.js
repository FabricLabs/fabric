'use strict';

class BitcoinBlock {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this._state = {
      transactions: []
    };
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

    console.log('Converted to Bitcoin block:', block);
    return block;
  }
}

module.exports = BitcoinBlock;
