'use strict';

// Dependencies
const merge = require('lodash.merge');
const { run } = require('minsc');
const crypto = require('crypto');
const ecc = require('./ecc');
const bls = require('../functions/bls');

// Fabric Types
const Contract = require('./contract');
const Key = require('./key');
const Wallet = require('./wallet');

/**
 * BLS public key stored for a member. Private material derives it once.
 * Public-only members must supply `blsPublicKey` (48-byte hex); a member with
 * private material may supply it only when it matches the derived key.
 * @param {object} member
 * @param {object} key
 * @returns {string|null}
 * @private
 */
function federationBlsPublicKey (member, key) {
  const derived = (key && key.private)
    ? bls.deriveFederationSigner(key.private).publicKey.toString('hex')
    : null;
  const supplied = member && (member.blsPublicKey || member.blsPublic);
  if (supplied != null && supplied !== '') {
    const raw = String(supplied).trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{96}$/.test(raw)) {
      throw new Error('blsPublicKey must be a 48-byte hex key');
    }
    if (derived && raw !== derived) {
      throw new Error('blsPublicKey does not match the key derived from the member private key');
    }
    return raw;
  }
  return derived;
}

/**
 * Create and manage sets of {Signer} instances with the Federation class.
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
      key: {
        password: '', // derivation password
        seed: null, // seed phrase (!!!)
        xprv: null, // avoid using seed phrase
        xpub: null  // verify signatures only
      },
      type: 'FabricFederation',
      // 'schnorr' (BIP340, default) or 'bls' (BLS12-381 bundles).
      signatureScheme: 'schnorr'
    }, settings);

    // Internal Key
    this.key = new Key(this.settings.key);
    this.wallet = new Wallet(this.settings.key);

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

  /**
   * Witness scheme for this federation. Bitcoin vault spends stay BIP340.
   * @returns {'schnorr'|'bls'}
   */
  get signatureScheme () {
    return bls.normalizeSignatureScheme(this.settings.signatureScheme);
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

    // Throws on a bad blsPublicKey; must run before any state changes.
    const blsPublicKey = federationBlsPublicKey(member, key);

    // Store the member's public key in hex format
    const pubkey = key.public.encodeCompressed('hex');
    this._state.content.validators.push(pubkey);

    // Store the member's key for signing
    this._state.content.keys = this._state.content.keys || {};
    this._state.content.keys[pubkey] = key;

    if (blsPublicKey) {
      this._state.content.blsPublicKeys = this._state.content.blsPublicKeys || {};
      this._state.content.blsPublicKeys[pubkey] = blsPublicKey;
    }

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

  tick (_input = {}) {
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

    const signWith = (key) => {
      if (this.signatureScheme === bls.SCHEME_BLS) {
        const derived = bls.deriveFederationSigner(key.private);
        return bls.sign(messageToSign, derived.secretKey);
      }
      return key.signSchnorr(messageToSign);
    };

    // If pubkey is provided, use that specific key
    if (pubkey) {
      const key = this._state.content.keys[pubkey];
      if (key && key.private) {
        return signWith(key);
      }
      throw new Error(`No private key available for member ${pubkey}`);
    }

    // Otherwise use the first available key with private key access
    for (const memberPubkey of this._state.content.validators) {
      const key = this._state.content.keys[memberPubkey];
      if (key && key.private) {
        return signWith(key);
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
      if (!key) continue;
      if (this.signatureScheme === bls.SCHEME_BLS) {
        const blsPublicKey = this._state.content.blsPublicKeys && this._state.content.blsPublicKeys[pubkey];
        if (blsPublicKey && bls.verify(sig, messageToVerify, blsPublicKey)) return true;
      } else if (key.verifySchnorr(messageToVerify, sig)) {
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
    const useBls = this.signatureScheme === bls.SCHEME_BLS;
    for (const pubkey of this._state.content.validators) {
      const key = this._state.content.keys[pubkey];
      if (key && key.private) {
        signatures[pubkey] = useBls
          ? bls.createFederationBlsBundle(messageToSign, key)
          : key.signSchnorr(messageToSign);
      }
    }
    return {
      message: msg,
      scheme: useBls ? bls.SCHEME_BLS : bls.SCHEME_SCHNORR,
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

    if (multiSig.scheme != null && multiSig.scheme !== '') {
      const witnessScheme = bls.normalizeSignatureScheme(multiSig.scheme);
      if (witnessScheme !== this.signatureScheme) return false;
    }
    const useBls = this.signatureScheme === bls.SCHEME_BLS;
    if (useBls) {
      return bls.verifyFederationBlsWitness(
        messageToVerify,
        { scheme: bls.SCHEME_BLS, signatures },
        this._state.content.validators,
        threshold
      );
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

        // Verify using noble-curves Schnorr (BIP340)
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

  /**
   * Federation validators live on consensus state, not only constructor settings.
   * @param {object} [overrides]
   * @returns {object}
   */
  _taprootPolicyInputs (overrides = {}) {
    const Policy = require('./policy');
    const validators = overrides.validators
      || (this._state.content.validators || []).slice();
    if (!validators.length) {
      throw new Error('Federation address requires at least one validator');
    }
    const threshold = overrides.threshold != null
      ? Number(overrides.threshold)
      : (this.settings.threshold != null
        ? Number(this.settings.threshold)
        : Math.ceil(validators.length / 2));
    const publisher = overrides.publisher || this.settings.publisher || validators[0];
    // Do not treat settings.timeout as a block count (units differ).
    const csvBlocks = overrides.csvBlocks != null
      ? Number(overrides.csvBlocks)
      : (this.settings.csvBlocks != null ? Number(this.settings.csvBlocks) : Policy.DEFAULT_CSV_BLOCKS);
    const network = overrides.network || this.settings.network || null;
    if (!network) {
      throw new Error(
        'Federation Bitcoin network required (set settings.network or pass overrides.network; do not default to regtest)'
      );
    }
    return { validators, threshold, publisher, network, csvBlocks };
  }

  get address () {
    return this.toAddress();
  }
}

module.exports = Federation;
