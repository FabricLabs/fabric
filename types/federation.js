'use strict';

// Dependencies
const merge = require('lodash.merge');
const { run } = require('minsc');

// Fabric Types
const Actor = require('./actor');
const Key = require('./key');
const Wallet = require('./wallet');

/**
 * Create and manage sets of signers with the Federation class.
 */
class Federation extends Actor {
  /**
   * Create an instance of a federation.
   * @param {Object} [settings] Settings.
   * @returns {Federation} Instance of the federation.
   */
  constructor (settings = {}) {
    super(settings);

    // Settings
    this.settings = merge({
      clock: 0,
      consensus: {
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
    this.wallet = new Wallet(this.settings.identity);

    // Internal State
    this._state = {
      consensus: this.settings.consensus,
      content: {
        clock: this.settings.clock,
        validators: this.settings.consensus.validators
      },
      status: 'PAUSED'
    };

    return this;
  }

  addMember (member) {
    const key = new Key(member);
    this._state.content.validators.push(key.pubkey);
    console.log('consensus validators:', this._state.content.validators);
    console.log('contract for step 0:', this.contractForStep(0));
  }

  contractForStep (number) {
    const index = this.validatorNumberForStep(number);

    try {
      const policy = run(`
        $A = ${this._state.content.validators[index]};
        pk($A)
      `);

      const miniscript = run(`miniscript(${policy})`);
      const descriptor = run(`wsh(${miniscript})`);
      const address = run(`address(${miniscript})`);

      return {
        policy,
        miniscript,
        descriptor,
        address
      };
    } catch (exception) {
      console.error('could not run fed:', exception);
    }

    return null;
  }

  tick (input = {}) {
    this._state.content.clock++;
  }

  validatorNumberForStep (step) {
    return step % this._state.content.validators.length;
  }

  validatorForStep (step) {
    return this._state.content.validators[ this.validatorNumberForStep(step) ];
  }

  /**
   * Start tracking state (i.e., ready to receive events).
   * @returns {Federation} Instance of the Federation.
   */
  start () {
    this.setStatus('STARTING');
    this.wallet.start();
    this.setStatus('STARTED');

    // this.commit();
    return this;
  }
}

module.exports = Federation;
