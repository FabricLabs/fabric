'use strict';

const bcoin = require('bcoin/lib/bcoin-browser');
const bcash = require('bcash/lib/bcoin-browser');

class Consensus {
  constructor (settings = {}) {
    this.settings = Object.assign({
      provider: 'bcoin'
    }, settings);

    // TODO: define class ConsensusProvider
    this.providers = { bcoin, bcash };
  }

  get SEQUENCE_GRANULARITY () {
    return this.providers[this.settings.provider].SEQUENCE_GRANULARITY;
  }

  get SEQUENCE_MASK () {
    return this.providers[this.settings.provider].SEQUENCE_MASK;
  }

  get SEQUENCE_TYPE_FLAG () {
    return this.providers[this.settings.provider].SEQUENCE_TYPE_FLAG;
  }
}

module.exports = Consensus;