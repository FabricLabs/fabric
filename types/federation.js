'use strict';

// Dependencies
const merge = require('lodash.merge');
const { run } = require('minsc');
const crypto = require('crypto');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');

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
        keys: {},
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

    return contract.trim();
  }

  addMember (member) {
    // Create key with proper settings
    const keySettings = {
      private: member.private,
      public: member.public || member.pubkey
    };

    const key = new Key(keySettings);

    // Verify the key was created properly
    if (member.private && !key.private) {
      throw new Error('Failed to initialize private key');
    }

    // Store the member's public key in hex format
    const pubkey = key.public.encodeCompressed('hex');
    this._state.content.validators.push(pubkey);

    // Store the member's key for signing
    this._state.content.keys = this._state.content.keys || {};
    this._state.content.keys[pubkey] = key;

    // console.log('consensus validators:', this._state.content.validators);
    // console.log('contract for step 0:', this.contractForStep(0));

    this.commit();
  }

  contractForStep (number) {
    const index = this.validatorNumberForStep(number);

    try {
      const policy = run(`
        $A = ${this._state.content.validators[index]};
        pk($A)
      ` || this.contract);

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

  /**
   * Signs a message using the federation's key.
   * @param {Buffer|String|Message} msg - The message to sign
   * @param {String} [pubkey] - Optional public key of the member to sign with
   * @returns {Buffer} The signature
   */
  sign (msg, pubkey) {
    // Handle Message objects
    const messageToSign = msg.data ? msg.data : msg;

    // If pubkey is provided, use that specific key
    if (pubkey) {
      const key = this._state.content.keys[pubkey];
      if (key && key.private) {
        return key.signSchnorr(messageToSign);
      }
      throw new Error(`No private key available for member ${pubkey}`);
    }

    // Otherwise use the first available key with private key access
    for (const memberPubkey of this._state.content.validators) {
      const key = this._state.content.keys[memberPubkey];
      if (key && key.private) {
        return key.signSchnorr(messageToSign);
      }
    }
    throw new Error('No private key available for signing');
  }

  /**
   * Verifies a signature against a message.
   * @param {Buffer|String|Message} msg - The message that was signed
   * @param {Buffer} sig - The signature to verify
   * @returns {Boolean} Whether the signature is valid
   */
  verify (msg, sig) {
    // Handle Message objects
    const messageToVerify = msg.data ? msg.data : msg;

    // Try to verify with any of the federation's keys
    for (const pubkey of this._state.content.validators) {
      const key = this._state.content.keys[pubkey];
      if (key && key.verifySchnorr(messageToVerify, sig)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Creates a multi-signature for a message.
   * @param {Buffer|String|Message} msg - The message to sign
   * @returns {Object} The multi-signature object containing signatures from all validators
   */
  createMultiSignature (msg) {
    const signatures = {};
    // Handle Message objects
    const messageToSign = msg.data ? msg.data : msg;
    for (const pubkey of this._state.content.validators) {
      const key = this._state.content.keys[pubkey];
      if (key && key.private) {
        signatures[pubkey] = key.signSchnorr(messageToSign);
      }
    }
    return {
      message: msg,
      signatures
    };
  }

  /**
   * Verifies a multi-signature against a message.
   * @param {Object} multiSig - The multi-signature object
   * @param {Number} threshold - Number of valid signatures required
   * @returns {Boolean} Whether the multi-signature is valid
   */
  verifyMultiSignature (multiSig, threshold = 1) {
    const { message, signatures } = multiSig;
    let validCount = 0;

    // Handle Message objects and Buffers
    let messageToVerify;
    if (Buffer.isBuffer(message)) {
      messageToVerify = message;
    } else if (message.raw && message.raw.data) {
      messageToVerify = message.raw.data;
    } else if (typeof message === 'string') {
      messageToVerify = Buffer.from(message);
    } else if (typeof message === 'object') {
      messageToVerify = Buffer.from(JSON.stringify(message));
    } else {
      messageToVerify = message;
    }

    // Ensure messageToVerify is a Buffer
    if (!Buffer.isBuffer(messageToVerify)) {
      messageToVerify = Buffer.from(messageToVerify);
    }

    // Create message hash once for all verifications
    const messageHash = crypto.createHash('sha256').update(messageToVerify).digest();

    for (const [pubkey, signature] of Object.entries(signatures)) {
      const key = this._state.content.keys[pubkey];
      if (key) {
        // Get x-only public key (32 bytes) from compressed public key (33 bytes)
        const compressedPubkey = Buffer.from(key.public.encodeCompressed('hex'), 'hex');
        const xOnlyPubkey = compressedPubkey.slice(1); // Remove the prefix byte

        // Ensure signature is a Buffer
        const sigBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);

        // Verify using tiny-secp256k1's Schnorr implementation
        if (ecc.verifySchnorr(messageHash, xOnlyPubkey, sigBuffer)) {
          validCount++;
          if (validCount >= threshold) {
            return true;
          }
        }
      }
    }

    return false;
  }

  get address () {
    // Get the public keys of all validators
    const pubkeys = this._state.content.validators.map(pubkey => Buffer.from(pubkey, 'hex'));

    // Create the threshold script for majority of signers
    const threshold = Math.ceil(pubkeys.length / 2);
    const thresholdScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_PUSHNUM_1 + threshold - 1,
      ...pubkeys.map(pubkey => Buffer.concat([
        Buffer.from([pubkey.length]),
        pubkey
      ])),
      bitcoin.opcodes.OP_PUSHNUM_1 + pubkeys.length,
      bitcoin.opcodes.OP_CHECKMULTISIG
    ]);

    // Create the taproot tree
    const tree = [
      {
        script: thresholdScript,
        weight: 1
      }
    ];

    // Add timeout condition if specified in settings
    if (this.settings.timeout) {
      const timeoutScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        ...thresholdScript
      ]);
      tree.push({
        script: timeoutScript,
        weight: 1
      });
    }

    // Add contract condition if specified in settings
    if (this.settings.contract) {
      // If contract is a string, assume it's a script hex
      const contractScript = typeof this.settings.contract === 'string'
        ? Buffer.from(this.settings.contract, 'hex')
        : this.settings.contract;

      tree.push({
        script: contractScript,
        weight: 1
      });
    }

    // Create the taproot output
    const output = bitcoin.payments.p2tr({
      internalPubkey: pubkeys[0].slice(1), // Use first validator's x-only pubkey
      scriptTree: tree,
      network: bitcoin.networks.bitcoin
    });

    return output.address;
  }
}

module.exports = Federation;
