'use strict';

// Dependencies
const merge = require('lodash.merge');
const { run } = require('minsc');

// Fabric Types
const Contract = require('./contract');
const Key = require('./key');
const Wallet = require('./wallet');

/**
 * Create and manage sets of signers with the Federation class.
 */
class Federation extends Contract {
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
      },
      type: 'FabricFederation'
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

  get contract () {
    const contract = `
      $A = ${this._state.content.validators[0]};
      $B = ${this._state.content.validators[1]};
      $C = ${this._state.content.validators[2]};
      $D = ${this._state.content.validators[3]};
      $E = ${this._state.content.validators[4]};
      $F = ${this._state.content.validators[0]};
      $G = ${this._state.content.validators[0]};
      $H = ${this._state.content.validators[0]};

      $federation = 4 of [ pk(A), pk(B), pk(C), pk(D), pk(E) ];
      $recovery = 2 of [ pk(F), pk(G), pk(I) ];
      $timeout = older(3 months);

      likely@$federation || ($timeout && $recovery)
    `;

    console.log('contract:', contract);
    return contract.trim();
  }

  addMember (member) {
    const key = new Key(member);
    this._state.content.validators.push(key.pubkey);
    console.log('consensus validators:', this._state.content.validators);
    console.log('contract for step 0:', this.contractForStep(0));
    this.commit();
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

    this.commit();
    return this;
  }

  stop () {
    this.setStatus('STOPPING');
    this.wallet.stop();
    this.setStatus('STOPPED');

    this.commit();
    return this;
  }
}

module.exports = Federation;
