'use strict';

// Dependencies
const merge = require('lodash.merge');

// Fabric Types
const Actor = require('./actor');
const Key = require('./key');

/**
 * Create and manage sets of signers with the Federation class.
 */
class Federation extends Actor {
  /**
   * Create an instance of a federation.
   * @param {Object} [settings] Settings.
   * @returns 
   */
  constructor (settings = {}) {
    super(settings);

    // Settings
    this.settings = merge({
      clock: 0,
      consensus: {
        type: 'roundrobin',
        validators: []
      },
      identity: {
        password: '', // derivation password
        seed: null, // seed phrase (!!!)
        xprv: null, // avoid using seed phrase
        xpub: null  // verify signatures only
      }
    }, settings);

    // Internal Key
    this.key = new Key(this.settings.identity);

    // Internal State
    this._state = {
      consensus: this.settings.consensus,
      content: {
        clock: this.settings.clock
      },
      status: 'PAUSED'
    };

    return this;
  }

  tick (input = {}) {
    this._state.content.clock++;
  }

  validatorNumberForStep (step) {
    return step % this._state.consensus.validators;
  }

  validatorForStep (step) {
    return this._state.consensus.validators[ this.validatorNumberForStep(step) ];
  }

  /**
   * Start tracking state (i.e., ready to receive events).
   * @returns {Federation} Instance of the Federation.
   */
  async start () {
    this.setStatus('STARTING');
    this.setStatus('STARTED');
    // this.commit();
    return this;
  }
}

module.exports = Federation;
