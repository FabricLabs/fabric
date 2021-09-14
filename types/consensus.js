'use strict';

// For browsers...
// const bcoin = require('bcoin/lib/bcoin-browser');
// const bcash = require('bcash/lib/bcoin-browser');

// For node...
const bcoin = require('bcoin');

/**
 * Provides various network-specific rules.
 */
class Consensus {
  /**
   * Create an instance of a {@link Consensus} verifier.
   * @param {Object} [settings] Configuration for the network.
   * @param {String} [settings.network] Name of the network.
   * @param {String} [settings.provider] Name of the source provider.
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      network: 'mainnet',
      provider: 'bcoin'
    }, settings);

    // TODO: define class ConsensusProvider
    this.providers = { bcoin };
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

  get Block () {
    return this.providers[this.settings.provider].Block;
  }

  get FullNode () {
    return this.providers[this.settings.provider].FullNode;
  }

  get MTX () {
    return this.providers[this.settings.provider].MTX;
  }

  get Script () {
    return this.providers[this.settings.provider].Script;
  }

  get Transaction () {
    return this.providers[this.settings.provider].Transaction;
  }

  // TODO: remove from {@link Consensus}
  get Wallet () {
    return this.providers[this.settings.provider].Wallet;
  }

  get blocks () {
    return {
      // TODO: compute from chain height
      subsidy: 50
    }
  }

  get port () {
    return (this.settings.provider === 'bcash') ? 18033 : 18332;
  }
}

module.exports = Consensus;
