'use strict';

/**
 * @fileoverview Federations: k-of-n signer sets and their Bitcoin vaults.
 *
 * The {@link Federation} instance tracks members and signs as a set. The
 * statics are the whole federation toolkit shared by Hub, GoonCitizen, and
 * Passport:
 *
 * - **Validator sets:** one entry per signing key, default threshold.
 * - **Pre-sign gates:** refuse to sign epochs or withdrawals until local state
 *   and the reserve ledger still agree.
 * - **Reserve ledger:** explicit-amount peg-in / peg-out accounting under
 *   `/federationReserve` in sidechain content.
 * - **Named federations:** a canonical descriptor (validators, threshold,
 *   network, publisher, ladder) whose hash is the federation id, the Taproot
 *   vault every member derives from it, withdrawals through the k-of-n
 *   authority leaf, and the `CONTRACT_MESSAGE` bodies members exchange.
 */

// Dependencies
const merge = require('lodash.merge');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const ecc = require('./ecc');

// Fabric Functions
const { stableStringify } = require('../functions/fabricCanonicalJson');
const { pubkeyXOnly } = require('../functions/pubkey');
const { normalizePeerPubkeyHex } = require('../functions/contractPublishAuthority');

// Fabric Types
const Contract = require('./contract');
const Key = require('./key');
const Wallet = require('./wallet');

// A linked @fabric/core resolves its own bitcoinjs-lib, which leaves this copy without ECC.
bitcoin.initEccLib(ecc);

const RESERVE_KEY = 'federationReserve';
const DUST_SATS = 546;
const DEFAULT_PAYOUT_MIN_CONFIRMATIONS = 6;
// Base58 version bytes: mainnet, then testnet / signet / regtest.
const P2PKH_VERSIONS = new Set([0x00, 0x6f]);
const P2SH_VERSIONS = new Set([0x05, 0xc4]);

const DESCRIPTOR_TYPE = 'FabricFederationDescriptor';
const DESCRIPTOR_VERSION = 1;
const NETWORKS = ['regtest', 'signet', 'testnet', 'mainnet'];
const DEFAULT_CSV_BLOCKS = 144;
const AUTHORITY_TIER = 't0-authority';

const MESSAGE_TYPES = Object.freeze({
  invite: 'FederationInvite',
  response: 'FederationInviteResponse',
  sync: 'FederationSync',
  withdrawal: 'FederationWithdrawalRequest',
  signature: 'FederationWithdrawalSignature',
  broadcast: 'FederationWithdrawalBroadcast'
});
const MESSAGE_TYPE_SET = new Set(Object.values(MESSAGE_TYPES));

/**
 * `functions/bls` imports this module, so it loads on first use.
 * @returns {Object}
 * @private
 */
function blsLib () {
  return require('../functions/bls');
}

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
    ? blsLib().deriveFederationSigner(key.private).publicKey.toString('hex')
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
 * @param {string} hex 66-hex compressed point
 * @returns {boolean}
 * @private
 */
function isCurvePoint (hex) {
  try {
    secp256k1.Point.fromHex(hex);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Parse one validator entry. An x-only key is lifted to its even-y (`02…`)
 * point, which BIP340 treats as the same key.
 * @param {*} pubkey
 * @returns {{ id: string, compressed: string }|null} null when not a key on the curve
 * @private
 */
function parseValidator (pubkey) {
  const id = Federation.validatorId(pubkey);
  if (!id) return null;
  const s = Buffer.isBuffer(pubkey)
    ? pubkey.toString('hex')
    : String(pubkey).trim().toLowerCase().replace(/^0x/, '');
  const compressed = /^0[23][0-9a-f]{64}$/.test(s) ? s : '02' + id;
  return isCurvePoint(compressed) ? { id, compressed } : null;
}

/**
 * Explicit threshold as configured (rounded up), or NaN when unset.
 * @param {*} threshold
 * @returns {number}
 * @private
 */
function explicitThreshold (threshold) {
  const t = (threshold == null || threshold === '') ? NaN : Number(threshold);
  return (Number.isFinite(t) && t >= 1) ? Math.ceil(t) : NaN;
}

/**
 * Lowercase compressed pubkey hex (no lifting of x-only keys), or null.
 * @param {*} hex
 * @returns {string|null}
 * @private
 */
function compressedPubkey (hex) {
  const s = String(hex || '').trim().toLowerCase().replace(/^0x/, '');
  return /^0[23][0-9a-f]{64}$/.test(s) ? s : null;
}

/**
 * scriptPubKey hex for a Bitcoin address on any network, or null when the
 * address does not decode.
 * @param {string} address
 * @returns {string|null}
 * @private
 */
function addressScriptHex (address) {
  const s = String(address || '').trim();
  if (!s) return null;
  try {
    const { version, data } = bitcoin.address.fromBech32(s);
    const program = Buffer.from(data);
    if (version < 0 || version > 16 || program.length < 2 || program.length > 40) return null;
    return Buffer.concat([
      Buffer.from([version === 0 ? 0x00 : 0x50 + version, program.length]),
      program
    ]).toString('hex');
  } catch (_) { /* not bech32 */ }
  try {
    const { version, hash } = bitcoin.address.fromBase58Check(s);
    const h = Buffer.from(hash).toString('hex');
    if (P2PKH_VERSIONS.has(version)) return `76a914${h}88ac`;
    if (P2SH_VERSIONS.has(version)) return `a914${h}87`;
  } catch (_) { /* not base58 */ }
  return null;
}

/**
 * Whether a payout output pays the withdrawal destination: same scriptPubKey
 * (`payout.scriptPubKey` when given), so bech32 case does not matter. Strings
 * that do not decode as addresses must match exactly.
 * @param {object} payout
 * @param {object} withdrawal
 * @returns {boolean}
 * @private
 */
function payoutPaysDestination (payout, withdrawal) {
  const want = addressScriptHex(withdrawal.destinationAddress);
  const given = payout.scriptPubKey != null && String(payout.scriptPubKey).trim()
    ? String(payout.scriptPubKey).trim().toLowerCase()
    : addressScriptHex(payout.destinationAddress);
  if (want && given) return want === given;
  const a = String(payout.destinationAddress || '').trim();
  return !!a && a === String(withdrawal.destinationAddress || '').trim();
}

/** @private */
function hex (bytes) {
  return Buffer.from(bytes).toString('hex');
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
    return blsLib().normalizeSignatureScheme(this.settings.signatureScheme);
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

    this.commit();
  }

  contractForStep (number) {
    const index = this.validatorNumberForStep(number);

    try {
      const { run } = require('minsc');
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
    const bls = blsLib();

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
    const bls = blsLib();

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
    const bls = blsLib();
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
    const bls = blsLib();
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

  // ---------------------------------------------------------------------------
  // Validator sets

  /**
   * Spelling-independent id for one signing key: lowercase x-only hex. BIP340
   * verifies over the x coordinate only, so `02…` / `03…` / x-only / mixed-case
   * spellings of one key share an id.
   * @param {*} pubkey compressed (33-byte) or x-only (32-byte) hex, or a Buffer
   * @returns {string|null} 64-hex id, or null when the input is not a key encoding
   */
  static validatorId (pubkey) {
    if (pubkey == null || pubkey === '') return null;
    const id = normalizePeerPubkeyHex(pubkey);
    return /^[0-9a-f]{64}$/.test(id) ? id : null;
  }

  /**
   * First entry per signing key; entries that are not keys on the curve are dropped.
   * @param {string[]} validatorPubkeys
   * @returns {string[]} entries as given, minus repeats and malformed entries
   */
  static uniqueValidatorPubkeys (validatorPubkeys) {
    const seen = new Set();
    const out = [];
    for (const p of (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])) {
      if (typeof p !== 'string' || !p) continue;
      const parsed = parseValidator(p);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push(p);
    }
    return out;
  }

  /**
   * Canonical validator list: lowercase compressed hex, one entry per signing key,
   * invalid points dropped, x-only keys lifted to `02…`. Compare members with
   * {@link Federation.validatorId}, not string equality.
   * @param {string[]} validatorPubkeys
   * @returns {string[]}
   */
  static normalizeValidators (validatorPubkeys) {
    const seen = new Set();
    const out = [];
    for (const p of (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])) {
      const parsed = parseValidator(p);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push(parsed.compressed);
    }
    return out;
  }

  /**
   * The listed entry for `pubkey`, matched by signing key rather than spelling.
   * @param {string[]} validatorPubkeys
   * @param {*} pubkey
   * @returns {string|null}
   */
  static findValidatorEntry (validatorPubkeys, pubkey) {
    const id = Federation.validatorId(pubkey);
    if (!id) return null;
    for (const p of (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])) {
      if (typeof p === 'string' && Federation.validatorId(p) === id) return p;
    }
    return null;
  }

  /**
   * The witness entry signed by `pubkey`, wherever the witness spelled its id.
   * @param {Object} signatures witness `signatures` map keyed by validator id
   * @param {*} pubkey
   * @returns {*} the entry, or undefined
   */
  static witnessSignatureFor (signatures, pubkey) {
    if (!signatures || typeof signatures !== 'object') return undefined;
    if (typeof pubkey === 'string' && Object.prototype.hasOwnProperty.call(signatures, pubkey)) {
      return signatures[pubkey];
    }
    const id = Federation.validatorId(pubkey);
    if (!id) return undefined;
    for (const k of Object.keys(signatures)) {
      if (Federation.validatorId(k) === id) return signatures[k];
    }
    return undefined;
  }

  /**
   * k for a k-of-n federation. An explicit threshold wins (rounded up) but is
   * clamped to the number of distinct validators, so an unsatisfiable k never
   * stalls sealing; when none is set, a strict majority of the distinct
   * validators (1 when empty). Use {@link Federation.thresholdExceedsValidators}
   * to warn about a clamp.
   * @param {*} threshold configured value (`null` / `''` / non-positive = unset)
   * @param {string[]} validatorPubkeys
   * @returns {number}
   */
  static resolveThreshold (threshold, validatorPubkeys) {
    const n = Federation.uniqueValidatorPubkeys(validatorPubkeys).length;
    const t = explicitThreshold(threshold);
    if (Number.isFinite(t)) return n > 0 ? Math.min(t, n) : t;
    return Math.floor(n / 2) + 1;
  }

  /**
   * Whether an explicit threshold asks for more signatures than there are
   * distinct validators (and so is clamped by {@link Federation.resolveThreshold}).
   * @param {*} threshold
   * @param {string[]} validatorPubkeys
   * @returns {boolean}
   */
  static thresholdExceedsValidators (threshold, validatorPubkeys) {
    const n = Federation.uniqueValidatorPubkeys(validatorPubkeys).length;
    const t = explicitThreshold(threshold);
    return n > 0 && Number.isFinite(t) && t > n;
  }

  // ---------------------------------------------------------------------------
  // Pre-sign gates (docs/SIGNATURE_PROOF_MODEL.md, docs/FEDERATED_SETTLEMENT.md)
  //
  // Agreeing on a digest is not the same as verifying that local state and typed
  // ledgers still conserve. Validators SHOULD refuse to Schnorr-sign Beacon
  // epochs, sidechain patches, or vault withdrawals until these checks pass.

  /**
   * Fail-closed digest equality for epoch vs local snapshots.
   * When failClosed is true (validators configured), missing either side fails.
   * @param {object} epoch
   * @param {object} localSidechain `{ stateDigest }`
   * @param {object} localContracts `{ merkleRoot|stateDigest }`
   * @param {Object} [opts]
   * @param {boolean} [opts.failClosed=true]
   * @returns {{ ok: true }|{ ok: false, error: string }}
   */
  static verifyLocalEpochDigests (epoch, localSidechain, localContracts, opts = {}) {
    const failClosed = opts.failClosed !== false;
    if (!epoch || typeof epoch !== 'object') {
      return { ok: false, error: 'epoch required' };
    }
    let completedChecks = 0;

    if (epoch.contracts && typeof epoch.contracts === 'object') {
      const remoteRoot = epoch.contracts.merkleRoot || epoch.contracts.stateDigest;
      const localRoot = localContracts
        ? (localContracts.merkleRoot || localContracts.stateDigest)
        : null;
      if (failClosed) {
        if (!remoteRoot || !localRoot) {
          return { ok: false, error: 'contracts digest missing on remote or local snapshot' };
        }
        if (String(remoteRoot) !== String(localRoot)) {
          return { ok: false, error: 'contracts digest mismatch vs local snapshot' };
        }
        completedChecks++;
      } else if (remoteRoot && localRoot && String(remoteRoot) !== String(localRoot)) {
        return { ok: false, error: 'contracts digest mismatch vs local snapshot' };
      } else if (remoteRoot && localRoot) {
        completedChecks++;
      }
    }

    if (epoch.sidechain && typeof epoch.sidechain === 'object') {
      const remoteDig = epoch.sidechain.stateDigest;
      const localDig = localSidechain && localSidechain.stateDigest
        ? localSidechain.stateDigest
        : null;
      if (failClosed) {
        if (!remoteDig || !localDig) {
          return { ok: false, error: 'sidechain digest missing on remote or local snapshot' };
        }
        if (String(remoteDig) !== String(localDig)) {
          return { ok: false, error: 'sidechain digest mismatch vs local snapshot' };
        }
        completedChecks++;
      } else if (remoteDig && localDig && String(remoteDig) !== String(localDig)) {
        return { ok: false, error: 'sidechain digest mismatch vs local snapshot' };
      } else if (remoteDig && localDig) {
        completedChecks++;
      }
    }

    if (failClosed && completedChecks === 0) {
      return { ok: false, error: 'no validator checks completed' };
    }
    return { ok: true };
  }

  /**
   * Recompute reserve conservation on sidechain content (typed peg ledger).
   * No-op success when `/federationReserve` is absent.
   * @param {object} [content]
   * @returns {{ ok: true, reserve?: object }|{ ok: false, error: string }}
   */
  static verifyReserveConservation (content) {
    if (!content || typeof content !== 'object') return { ok: true };
    if (!content[RESERVE_KEY]) return { ok: true };
    // Reject invalid numerics before readReserve normalizes negatives to 0.
    const schema = Federation.validateReserveObjectSchema(content[RESERVE_KEY]);
    if (!schema.ok) return schema;
    const reserve = Federation.readReserve(content);
    const cons = Federation.assertConservation(reserve);
    if (!cons.ok) return cons;
    return { ok: true, reserve };
  }

  /**
   * Re-verify a Machine/Program run commitment (independent recomputation gate).
   * @param {object} opts
   * @param {object} opts.program Program with runCommitmentHex()
   * @param {object} opts.run Machine run result (`tip`/`stack`/`runCommitmentHex`)
   * @returns {{ ok: true, programHash: string, runCommitmentHex: string }|{ ok: false, error: string }}
   */
  static verifyProgramRunRecompute (opts = {}) {
    return require('../functions/contractProgramBind').assertMachineRunMatches(opts);
  }

  /**
   * Aggregate pre-sign gate for Beacon epoch auto-sign / vault prep.
   * @param {object} opts
   * @param {object} [opts.epoch] Peer epoch payload
   * @param {object} [opts.localSidechain] `{ stateDigest, clock? }`
   * @param {object} [opts.localContracts] `{ merkleRoot|stateDigest }`
   * @param {object} [opts.sidechainContent] Full sidechain content for reserve check
   * @param {boolean} [opts.failClosed=true]
   * @param {object} [opts.program] Optional Program for recompute
   * @param {object} [opts.run] Optional Machine run
   * @returns {{ ok: true, checks: string[] }|{ ok: false, error: string, checks: string[] }}
   */
  static evaluateValidatorSignGate (opts = {}) {
    const checks = [];
    const failClosed = opts.failClosed !== false;

    if (opts.epoch) {
      const dig = Federation.verifyLocalEpochDigests(
        opts.epoch,
        opts.localSidechain || null,
        opts.localContracts || null,
        { failClosed }
      );
      if (!dig.ok) {
        return { ok: false, error: dig.error, checks };
      }
      checks.push('epoch-digests');
    }

    if (opts.sidechainContent != null || (opts.localSidechain && opts.localSidechain.content)) {
      const content = opts.sidechainContent != null
        ? opts.sidechainContent
        : opts.localSidechain.content;
      const reserve = Federation.verifyReserveConservation(content);
      if (!reserve.ok) {
        return { ok: false, error: reserve.error, checks };
      }
      if (reserve.reserve) checks.push('reserve-conservation');
    }

    if (opts.program && opts.run) {
      const run = Federation.verifyProgramRunRecompute({
        program: opts.program,
        run: opts.run
      });
      if (!run.ok) {
        return { ok: false, error: run.error, checks };
      }
      checks.push('program-run-recompute');
    }

    if (failClosed && checks.length === 0) {
      return { ok: false, error: 'no validator checks completed', checks };
    }
    return { ok: true, checks };
  }

  // ---------------------------------------------------------------------------
  // Reserve ledger (F0, explicit amounts)
  //
  // Sidechain content lives under `/federationReserve`. Conservation:
  //   outstandingSats + pendingBurnsSats <= vaultConfirmedSats
  // (operators supply vaultConfirmedSats from L1; credits require matured deposits).

  /** @returns {Object} reserve with every total at zero */
  static emptyReserve () {
    return {
      outstandingSats: 0,
      creditedSats: 0,
      burnedSats: 0,
      pendingBurnsSats: 0,
      vaultConfirmedSats: 0,
      deposits: [],
      withdrawals: []
    };
  }

  /**
   * @param {object} content Sidechain content object
   * @returns {Object} `{ outstandingSats, creditedSats, burnedSats, pendingBurnsSats, vaultConfirmedSats, deposits, withdrawals }`
   */
  static readReserve (content) {
    const raw = content && typeof content === 'object' ? content[RESERVE_KEY] : null;
    if (!raw || typeof raw !== 'object') return Federation.emptyReserve();
    return {
      outstandingSats: Math.max(0, Math.round(Number(raw.outstandingSats) || 0)),
      creditedSats: Math.max(0, Math.round(Number(raw.creditedSats) || 0)),
      burnedSats: Math.max(0, Math.round(Number(raw.burnedSats) || 0)),
      pendingBurnsSats: Math.max(0, Math.round(Number(raw.pendingBurnsSats) || 0)),
      vaultConfirmedSats: Math.max(0, Math.round(Number(raw.vaultConfirmedSats) || 0)),
      deposits: Array.isArray(raw.deposits) ? raw.deposits.slice() : [],
      withdrawals: Array.isArray(raw.withdrawals) ? raw.withdrawals.slice() : []
    };
  }

  /**
   * @param {Object} reserve
   * @returns {{ ok: true }|{ ok: false, error: string }}
   */
  static assertConservation (reserve) {
    const r = reserve && typeof reserve === 'object' ? reserve : Federation.emptyReserve();
    const outstanding = Math.max(0, Math.round(Number(r.outstandingSats) || 0));
    const pending = Math.max(0, Math.round(Number(r.pendingBurnsSats) || 0));
    const vault = Math.max(0, Math.round(Number(r.vaultConfirmedSats) || 0));
    if (outstanding + pending > vault) {
      return {
        ok: false,
        error: `conservation violated: outstanding(${outstanding})+pendingBurns(${pending}) > vaultConfirmed(${vault})`
      };
    }
    return { ok: true };
  }

  /**
   * Deposit outpoint key.
   * @param {string} txid
   * @param {number} vout
   * @returns {string}
   */
  static depositKey (txid, vout) {
    return `${String(txid || '').trim().toLowerCase()}:${Number(vout)}`;
  }

  /**
   * Credit peg-in after L1 maturity.
   * @param {object} content
   * @param {object} proof
   * @param {string} proof.txid
   * @param {number} proof.vout
   * @param {number} proof.amountSats
   * @param {number} proof.confirmations
   * @param {Object} [opts]
   * @param {number} [opts.depositMaturityBlocks=144]
   * @param {number} opts.vaultConfirmedSats Verified L1 vault total (required — never invent from proof)
   * @returns {{ ok: true, content: object, reserve: Object }|{ ok: false, error: string }}
   */
  static applyPegInCredit (content, proof = {}, opts = {}) {
    const maturity = Math.max(1, Number(opts.depositMaturityBlocks) || 144);
    const txid = String(proof.txid || '').trim().toLowerCase();
    const vout = Number(proof.vout);
    const amountSats = Math.round(Number(proof.amountSats));
    const confirmations = Math.round(Number(proof.confirmations));

    if (!/^[0-9a-f]{64}$/.test(txid)) {
      return { ok: false, error: 'txid required (64-hex)' };
    }
    if (!Number.isInteger(vout) || vout < 0) {
      return { ok: false, error: 'vout required (non-negative integer)' };
    }
    if (!Number.isInteger(amountSats) || amountSats < DUST_SATS) {
      return { ok: false, error: `amountSats required (integer >= ${DUST_SATS})` };
    }
    if (!Number.isInteger(confirmations) || confirmations < maturity) {
      return {
        ok: false,
        error: `deposit not mature (need >= ${maturity} confirmations, have ${confirmations})`
      };
    }

    const nextContent = Object.assign({}, content && typeof content === 'object' ? content : {});
    const reserve = Federation.readReserve(nextContent);
    const key = Federation.depositKey(txid, vout);
    if (reserve.deposits.some((d) => Federation.depositKey(d.txid, d.vout) === key)) {
      return { ok: false, error: 'deposit already credited' };
    }

    if (opts.vaultConfirmedSats != null) {
      const v = Math.round(Number(opts.vaultConfirmedSats));
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, error: 'vaultConfirmedSats invalid' };
      }
      reserve.vaultConfirmedSats = v;
    } else {
      return {
        ok: false,
        error: 'vaultConfirmedSats required (verified L1 vault total; do not invent from deposit proof)'
      };
    }

    reserve.deposits.push({
      txid,
      vout,
      amountSats,
      confirmations,
      creditedAt: opts.creditedAt || new Date().toISOString()
    });
    reserve.creditedSats += amountSats;
    reserve.outstandingSats += amountSats;

    const cons = Federation.assertConservation(reserve);
    if (!cons.ok) return cons;

    nextContent[RESERVE_KEY] = reserve;
    return { ok: true, content: nextContent, reserve };
  }

  /**
   * Burn peg-out claims before L1 vault payout (binds to withdrawal requestId).
   * @param {object} content
   * @param {object} withdrawal
   * @param {string} withdrawal.requestId
   * @param {number} withdrawal.amountSats
   * @param {string} withdrawal.destinationAddress
   * @param {Object} [opts]
   * @param {number} [opts.vaultConfirmedSats]
   * @returns {{ ok: true, content: object, reserve: Object }|{ ok: false, error: string }}
   */
  static applyPegOutBurn (content, withdrawal = {}, opts = {}) {
    const requestId = String(withdrawal.requestId || '').trim().toLowerCase();
    const amountSats = Math.round(Number(withdrawal.amountSats));
    const destinationAddress = String(withdrawal.destinationAddress || '').trim();

    if (!/^[0-9a-f]{64}$/.test(requestId)) {
      return { ok: false, error: 'requestId required (64-hex)' };
    }
    if (!Number.isInteger(amountSats) || amountSats < DUST_SATS) {
      return { ok: false, error: `amountSats required (integer >= ${DUST_SATS})` };
    }
    if (!destinationAddress) {
      return { ok: false, error: 'destinationAddress required' };
    }

    const nextContent = Object.assign({}, content && typeof content === 'object' ? content : {});
    const reserve = Federation.readReserve(nextContent);

    if (reserve.withdrawals.some((w) => String(w.requestId || '').toLowerCase() === requestId)) {
      return { ok: false, error: 'withdrawal already burned' };
    }
    if (amountSats > reserve.outstandingSats) {
      return { ok: false, error: 'burn exceeds outstandingSats' };
    }

    if (opts.vaultConfirmedSats != null) {
      const v = Math.round(Number(opts.vaultConfirmedSats));
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, error: 'vaultConfirmedSats invalid' };
      }
      reserve.vaultConfirmedSats = v;
    }

    reserve.outstandingSats -= amountSats;
    reserve.pendingBurnsSats += amountSats;
    reserve.burnedSats += amountSats;
    reserve.withdrawals.push({
      requestId,
      amountSats,
      destinationAddress,
      burnedAt: opts.burnedAt || new Date().toISOString(),
      status: 'pending'
    });

    const cons = Federation.assertConservation(reserve);
    if (!cons.ok) return cons;

    nextContent[RESERVE_KEY] = reserve;
    return { ok: true, content: nextContent, reserve };
  }

  /**
   * After L1 vault payout confirms, settle a pending burn: drop pendingBurns and
   * vaultConfirmed by the same amountSats (request-scoped).
   *
   * The caller verifies the payout on L1; this helper only settles against a
   * named payout output that matches the burned withdrawal exactly, and never
   * lets one output settle two withdrawals.
   *
   * Fees: the payout output must carry the full withdrawal `amountSats`; the
   * federation pays the L1 fee from vault funds above `outstandingSats +
   * pendingBurnsSats`. Without `opts.vaultConfirmedSats` the vault only drops
   * by `amountSats`, so the fee stays counted in it until the caller passes the
   * verified vault total (which fails conservation when there was no surplus to
   * pay the fee from).
   *
   * A settled payout that later leaves the best chain is undone with
   * {@link Federation.unsettlePegOutPayout}; wait for `payoutMinConfirmations`
   * to make that rare.
   * @param {object} content
   * @param {string} requestId
   * @param {Object} opts
   * @param {Object} opts.payout Verified L1 payout output
   * @param {string} opts.payout.txid
   * @param {number} opts.payout.vout
   * @param {number} opts.payout.amountSats Must equal the withdrawal amountSats
   * @param {string} opts.payout.destinationAddress Must pay the withdrawal destination (compared by scriptPubKey)
   * @param {string} [opts.payout.scriptPubKey] output script hex; preferred over destinationAddress
   * @param {number} opts.payout.confirmations
   * @param {number} [opts.payoutMinConfirmations=6]
   * @param {number} [opts.vaultConfirmedSats] optional verified vault total after payout
   * @returns {{ ok: true, content: object, reserve: Object }|{ ok: false, error: string }}
   */
  static settlePegOutPayout (content, requestId, opts = {}) {
    const id = String(requestId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(id)) {
      return { ok: false, error: 'requestId required (64-hex)' };
    }
    const payout = opts.payout && typeof opts.payout === 'object' ? opts.payout : null;
    if (!payout) {
      return { ok: false, error: 'payout required (verified L1 payout output)' };
    }
    const payoutTxid = String(payout.txid || '').trim().toLowerCase();
    const payoutVout = Number(payout.vout);
    const payoutSats = Math.round(Number(payout.amountSats));
    const payoutConfirmations = Math.round(Number(payout.confirmations));
    const minConfirmations = Math.max(1, Number(opts.payoutMinConfirmations) || DEFAULT_PAYOUT_MIN_CONFIRMATIONS);
    if (!/^[0-9a-f]{64}$/.test(payoutTxid)) {
      return { ok: false, error: 'payout.txid required (64-hex)' };
    }
    if (!Number.isInteger(payoutVout) || payoutVout < 0) {
      return { ok: false, error: 'payout.vout required (non-negative integer)' };
    }
    if (!Number.isInteger(payoutConfirmations) || payoutConfirmations < minConfirmations) {
      return {
        ok: false,
        error: `payout not confirmed (need >= ${minConfirmations} confirmations, have ${payoutConfirmations})`
      };
    }
    const nextContent = Object.assign({}, content && typeof content === 'object' ? content : {});
    const reserve = Federation.readReserve(nextContent);
    const rowIndex = reserve.withdrawals.findIndex(
      (w) => String(w.requestId || '').toLowerCase() === id
    );
    // Clone before mutation so a failed assertConservation cannot mark the caller's row settled
    // (readReserve only shallow-copies the withdrawals array).
    const row = rowIndex >= 0 ? Object.assign({}, reserve.withdrawals[rowIndex]) : null;
    if (!row) return { ok: false, error: 'withdrawal not found' };
    if (String(row.status || '') === 'settled') {
      return { ok: false, error: 'withdrawal already settled' };
    }
    const amountSats = Math.round(Number(row.amountSats));
    if (!Number.isInteger(amountSats) || amountSats < DUST_SATS) {
      return { ok: false, error: 'withdrawal amountSats invalid' };
    }
    if (amountSats > reserve.pendingBurnsSats) {
      return { ok: false, error: 'settle exceeds pendingBurnsSats' };
    }
    if (payoutSats !== amountSats) {
      return { ok: false, error: `payout.amountSats (${payoutSats}) must equal withdrawal amountSats (${amountSats})` };
    }
    if (!payoutPaysDestination(payout, row)) {
      return { ok: false, error: 'payout.destinationAddress must pay the withdrawal destinationAddress' };
    }
    const outpoint = Federation.depositKey(payoutTxid, payoutVout);
    if (reserve.withdrawals.some((w) => w && w.payout && Federation.depositKey(w.payout.txid, w.payout.vout) === outpoint)) {
      return { ok: false, error: 'payout output already settled another withdrawal' };
    }

    if (opts.vaultConfirmedSats != null) {
      const v = Math.round(Number(opts.vaultConfirmedSats));
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, error: 'vaultConfirmedSats invalid' };
      }
      reserve.vaultConfirmedSats = v;
    } else {
      reserve.vaultConfirmedSats = Math.max(0, reserve.vaultConfirmedSats - amountSats);
    }

    reserve.pendingBurnsSats -= amountSats;
    row.status = 'settled';
    row.settledAt = opts.settledAt || new Date().toISOString();
    row.payout = { txid: payoutTxid, vout: payoutVout, confirmations: payoutConfirmations };
    reserve.withdrawals[rowIndex] = row;

    const cons = Federation.assertConservation(reserve);
    if (!cons.ok) return cons;

    nextContent[RESERVE_KEY] = reserve;
    return { ok: true, content: nextContent, reserve };
  }

  /**
   * Undo {@link Federation.settlePegOutPayout} after the payout transaction left
   * the best chain: the withdrawal is pending again and its amount returns to
   * `pendingBurnsSats` and the vault, so it can settle against a new payout.
   * @param {object} content
   * @param {string} requestId
   * @param {Object} opts
   * @param {Object} opts.payout the reorged payout outpoint (must match the settled one)
   * @param {string} opts.payout.txid
   * @param {number} opts.payout.vout
   * @param {number} [opts.vaultConfirmedSats] verified vault total after the reorg
   * (default: the settled total plus `amountSats`)
   * @returns {{ ok: true, content: object, reserve: Object }|{ ok: false, error: string }}
   */
  static unsettlePegOutPayout (content, requestId, opts = {}) {
    const id = String(requestId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(id)) {
      return { ok: false, error: 'requestId required (64-hex)' };
    }
    const payout = opts.payout && typeof opts.payout === 'object' ? opts.payout : null;
    if (!payout) return { ok: false, error: 'payout required (the reorged payout outpoint)' };

    const nextContent = Object.assign({}, content && typeof content === 'object' ? content : {});
    const reserve = Federation.readReserve(nextContent);
    const rowIndex = reserve.withdrawals.findIndex(
      (w) => String(w.requestId || '').toLowerCase() === id
    );
    const row = rowIndex >= 0 ? Object.assign({}, reserve.withdrawals[rowIndex]) : null;
    if (!row) return { ok: false, error: 'withdrawal not found' };
    if (String(row.status || '') !== 'settled' || !row.payout) {
      return { ok: false, error: 'withdrawal is not settled' };
    }
    if (Federation.depositKey(row.payout.txid, row.payout.vout) !== Federation.depositKey(payout.txid, payout.vout)) {
      return { ok: false, error: 'payout does not match the settled payout' };
    }
    const amountSats = Math.round(Number(row.amountSats));
    if (!Number.isInteger(amountSats) || amountSats < DUST_SATS) {
      return { ok: false, error: 'withdrawal amountSats invalid' };
    }

    if (opts.vaultConfirmedSats != null) {
      const v = Math.round(Number(opts.vaultConfirmedSats));
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, error: 'vaultConfirmedSats invalid' };
      }
      reserve.vaultConfirmedSats = v;
    } else {
      reserve.vaultConfirmedSats += amountSats;
    }
    reserve.pendingBurnsSats += amountSats;
    row.status = 'pending';
    delete row.payout;
    delete row.settledAt;
    row.unsettledAt = opts.unsettledAt || new Date().toISOString();
    reserve.withdrawals[rowIndex] = row;

    const cons = Federation.assertConservation(reserve);
    if (!cons.ok) return cons;

    nextContent[RESERVE_KEY] = reserve;
    return { ok: true, content: nextContent, reserve };
  }

  /**
   * RFC6902 replace/add patch that writes the full reserve object (typed path only).
   * @param {Object} reserve
   * @returns {object[]}
   */
  static patchesForReserve (reserve) {
    return [{
      op: 'add',
      path: `/${RESERVE_KEY}`,
      value: reserve
    }];
  }

  /**
   * Schema-check a full /federationReserve object (array elements included).
   * @param {object} value
   * @returns {{ ok: true }|{ ok: false, error: string }}
   */
  static validateReserveObjectSchema (value) {
    if (!value || typeof value !== 'object') {
      return { ok: false, error: 'federationReserve value must be object' };
    }
    for (const key of ['outstandingSats', 'creditedSats', 'burnedSats', 'pendingBurnsSats', 'vaultConfirmedSats']) {
      const n = Number(value[key]);
      if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) {
        return { ok: false, error: `${key} must be a non-negative integer` };
      }
    }
    if (!Array.isArray(value.deposits) || !Array.isArray(value.withdrawals)) {
      return { ok: false, error: 'deposits and withdrawals must be arrays' };
    }
    for (const d of value.deposits) {
      if (!d || typeof d !== 'object') return { ok: false, error: 'invalid deposit row' };
      if (!/^[0-9a-f]{64}$/i.test(String(d.txid || ''))) {
        return { ok: false, error: 'deposit.txid must be 64-hex' };
      }
      if (!Number.isInteger(Number(d.vout)) || Number(d.vout) < 0) {
        return { ok: false, error: 'deposit.vout invalid' };
      }
      if (!Number.isInteger(Number(d.amountSats)) || Number(d.amountSats) < DUST_SATS) {
        return { ok: false, error: 'deposit.amountSats invalid' };
      }
    }
    for (const w of value.withdrawals) {
      if (!w || typeof w !== 'object') return { ok: false, error: 'invalid withdrawal row' };
      if (!/^[0-9a-f]{64}$/i.test(String(w.requestId || ''))) {
        return { ok: false, error: 'withdrawal.requestId must be 64-hex' };
      }
      if (!Number.isInteger(Number(w.amountSats)) || Number(w.amountSats) < DUST_SATS) {
        return { ok: false, error: 'withdrawal.amountSats invalid' };
      }
      if (!String(w.destinationAddress || '').trim()) {
        return { ok: false, error: 'withdrawal.destinationAddress required' };
      }
      if (String(w.status || '') === 'settled') {
        const p = w.payout;
        if (!p || typeof p !== 'object' || !/^[0-9a-f]{64}$/i.test(String(p.txid || ''))) {
          return { ok: false, error: 'settled withdrawal.payout.txid must be 64-hex' };
        }
        if (!Number.isInteger(Number(p.vout)) || Number(p.vout) < 0) {
          return { ok: false, error: 'settled withdrawal.payout.vout invalid' };
        }
      }
    }
    return { ok: true };
  }

  /**
   * Reject raw RFC6902 that mutates reserve fields without going through ledger helpers.
   * Call before applyPatchesToState when patches touch /federationReserve*.
   * Full-object replace/add must pass schema + conservation (provenance still requires
   * helper-generated patches in production — see docs/PEG_OPERATIONS.md).
   * @param {object[]} patches
   * @returns {{ ok: true }|{ ok: false, error: string }}
   */
  static validateLedgerPatch (patches) {
    if (!Array.isArray(patches) || !patches.length) {
      return { ok: false, error: 'patches must be a non-empty array' };
    }
    for (const p of patches) {
      if (!p || typeof p !== 'object') {
        return { ok: false, error: 'invalid patch op' };
      }
      const path = String(p.path || '');
      if (!path.startsWith(`/${RESERVE_KEY}`)) continue;
      // Only allow full-object replace/add of /federationReserve (not nested invent).
      if (path !== `/${RESERVE_KEY}`) {
        return {
          ok: false,
          error: 'federationReserve nested patches forbidden; use peg ledger helpers'
        };
      }
      if (p.op !== 'add' && p.op !== 'replace') {
        return { ok: false, error: `federationReserve op ${p.op} forbidden` };
      }
      const schema = Federation.validateReserveObjectSchema(p.value);
      if (!schema.ok) return schema;
      const cons = Federation.assertConservation({
        outstandingSats: p.value.outstandingSats,
        pendingBurnsSats: p.value.pendingBurnsSats,
        vaultConfirmedSats: p.value.vaultConfirmedSats
      });
      if (!cons.ok) return cons;
    }
    return { ok: true };
  }

  /**
   * Default path policy denying free-form balance invent outside typed reserve writes.
   * @returns {object}
   */
  static defaultSidechainPolicy () {
    return {
      maxOps: 64,
      maxPathDepth: 8,
      allowedPathPrefixes: [
        '/federationReserve',
        '/namespaces',
        '/program',
        '/members',
        '/clock'
      ],
      deniedPathPrefixes: [
        '/balances',
        '/reserves',
        '/claims',
        '/lbtc',
        '/mint'
      ],
      allowEmptyPolicy: false
    };
  }

  // ---------------------------------------------------------------------------
  // Named federations: descriptor, vault, withdrawals, messages

  /**
   * Build a canonical descriptor. The soft tier needs the full threshold after the
   * CSV delay (never a single key), and the internal key is NUMS so no key-path spend exists.
   * @param {Object} opts
   * @param {string[]} opts.validators Compressed pubkeys (any order, deduplicated)
   * @param {number} opts.threshold Signatures required
   * @param {string} opts.network Bitcoin network name
   * @param {string} opts.publisher Creator pubkey (must be a validator)
   * @param {number} [opts.csvBlocks=144] Soft-tier CSV delay
   * @returns {Object}
   */
  static buildDescriptor (opts = {}) {
    const raw = Array.isArray(opts.validators) ? opts.validators : [];
    const validators = [];
    for (const v of raw) {
      const pk = compressedPubkey(v);
      if (!pk) throw new Error(`invalid validator pubkey: ${String(v).slice(0, 80)}`);
      if (validators.some((x) => x.slice(2) === pk.slice(2))) continue;
      validators.push(pk);
    }
    validators.sort();
    if (validators.length < 1) throw new Error('at least one validator is required');
    const threshold = Number(opts.threshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > validators.length) {
      throw new Error(`threshold must be an integer from 1 to ${validators.length}`);
    }
    const network = String(opts.network || '').trim().toLowerCase();
    if (!NETWORKS.includes(network)) throw new Error(`unknown network: ${opts.network}`);
    const publisher = compressedPubkey(opts.publisher);
    if (!publisher) throw new Error('publisher pubkey is required');
    if (!validators.some((v) => v.slice(2) === publisher.slice(2))) {
      throw new Error('publisher must be one of the validators');
    }
    const csvBlocks = opts.csvBlocks != null ? Number(opts.csvBlocks) : DEFAULT_CSV_BLOCKS;
    if (!Number.isInteger(csvBlocks) || csvBlocks < 1 || csvBlocks > 65535) {
      throw new Error('csvBlocks must be an integer from 1 to 65535');
    }
    return {
      type: DESCRIPTOR_TYPE,
      version: DESCRIPTOR_VERSION,
      network,
      validators,
      threshold,
      signatureScheme: 'schnorr',
      internalKeyMode: 'nums',
      ladder: { softMode: 'reduced', softThreshold: threshold, csvBlocks },
      publisher
    };
  }

  /**
   * Re-derive a descriptor from untrusted input; throws when it is not canonical.
   * @param {Object} descriptor
   * @returns {Object} canonical descriptor
   */
  static canonicalDescriptor (descriptor) {
    if (!descriptor || descriptor.type !== DESCRIPTOR_TYPE) throw new Error('not a federation descriptor');
    if (Number(descriptor.version) !== DESCRIPTOR_VERSION) throw new Error('unsupported descriptor version');
    const ladder = descriptor.ladder || {};
    const canonical = Federation.buildDescriptor({
      validators: descriptor.validators,
      threshold: descriptor.threshold,
      network: descriptor.network,
      publisher: descriptor.publisher,
      csvBlocks: ladder.csvBlocks
    });
    if (stableStringify(canonical) !== stableStringify(descriptor)) {
      throw new Error('descriptor is not canonical');
    }
    return canonical;
  }

  /**
   * Federation id: SHA-256 of the canonical descriptor.
   * @param {Object} descriptor
   * @returns {string} 64 hex
   */
  static descriptorId (descriptor) {
    return crypto.createHash('sha256').update(stableStringify(descriptor), 'utf8').digest('hex');
  }

  /**
   * Taproot vault for a descriptor (the same address for every member).
   * @param {Object} descriptor
   * @returns {Object} `Policy.buildFederationVaultFromPolicy` result (address, output, policy, leaves, …)
   */
  static vaultForDescriptor (descriptor) {
    const Policy = require('./policy');
    const d = descriptor;
    return Policy.buildFederationVaultFromPolicy({
      validators: d.validators,
      threshold: d.threshold,
      networkName: d.network,
      publisher: d.publisher,
      csvBlocks: d.ladder.csvBlocks,
      softMode: d.ladder.softMode,
      softThreshold: d.ladder.softThreshold,
      internalKeyMode: d.internalKeyMode
    });
  }

  /**
   * Is `pubkey` (compressed or x-only) one of the descriptor's validators?
   * @param {Object} descriptor
   * @param {string} pubkey
   * @returns {boolean}
   */
  static isValidator (descriptor, pubkey) {
    const x = pubkeyXOnly(pubkey);
    return !!x && !!descriptor && Array.isArray(descriptor.validators) &&
      descriptor.validators.some((v) => v.slice(2) === x);
  }

  /**
   * Withdrawal request id: SHA-256 of the unsigned PSBT.
   * @param {string} psbtBase64
   * @returns {string} 64 hex
   */
  static withdrawalRequestId (psbtBase64) {
    return crypto.createHash('sha256').update(String(psbtBase64), 'utf8').digest('hex');
  }

  /**
   * Build the unsigned withdrawal PSBT for a descriptor. Every member rebuilds
   * the same PSBT from the same request (the input txid commits to the funding
   * transaction), so a member signs only what it would have built itself.
   * @param {Object} opts
   * @param {Object} opts.descriptor Canonical federation descriptor
   * @param {string} opts.fundedTxHex Raw transaction paying the vault
   * @param {number} [opts.vout] Expected vault output index (checked)
   * @param {string} opts.destinationAddress
   * @param {number} opts.amountSats
   * @param {number} opts.feeSats
   * @returns {{ requestId: string, psbtBase64: string, txid: string, vout: number, inputSats: number, amountSats: number, feeSats: number, changeSats: number, vaultAddress: string }}
   */
  static prepareWithdrawal (opts = {}) {
    const Policy = require('./policy');
    const descriptor = Federation.canonicalDescriptor(opts.descriptor);
    const vault = Federation.vaultForDescriptor(descriptor);
    const destination = String(opts.destinationAddress || '').trim();
    if (!destination) throw new Error('destinationAddress is required');
    if (destination === vault.address) throw new Error('destination is the federation vault itself');
    const amountSats = Number(opts.amountSats);
    if (!Number.isSafeInteger(amountSats) || amountSats < DUST_SATS) throw new Error(`amountSats must be an integer of at least ${DUST_SATS}`);
    const feeSats = Number(opts.feeSats);
    if (!Number.isSafeInteger(feeSats) || feeSats < 1) throw new Error('feeSats must be a positive integer');
    const fundedTxHex = String(opts.fundedTxHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(fundedTxHex)) throw new Error('fundedTxHex must be hex');

    const prepared = Policy.prepareTierWithdrawalPsbt({
      policy: vault.policy,
      fundedTxHex,
      vaultAddress: vault.address,
      destinationAddress: destination,
      amountSats,
      feeSats,
      tierId: AUTHORITY_TIER
    });
    if (opts.vout != null && Number(opts.vout) !== prepared.vout) {
      throw new Error(`vault output ${opts.vout} is not the first vault output of its transaction (found ${prepared.vout})`);
    }
    return {
      requestId: Federation.withdrawalRequestId(prepared.psbtBase64),
      psbtBase64: prepared.psbtBase64,
      txid: bitcoin.Transaction.fromHex(fundedTxHex).getId(),
      vout: prepared.vout,
      inputSats: prepared.inputSats,
      amountSats,
      feeSats,
      changeSats: prepared.changeSats,
      vaultAddress: vault.address
    };
  }

  /**
   * Sign the authority leaf with one member key.
   * @param {Object} opts
   * @param {string} opts.psbtBase64 Unsigned (or partially signed) PSBT
   * @param {Buffer|Uint8Array} opts.privateKey 32-byte member private key
   * @returns {{ psbtBase64: string, signatures: Array<{ pubkey: string, leafHash: string, signature: string }> }}
   */
  static signWithdrawal (opts = {}) {
    const Htlc = require('./htlc');
    const psbt = bitcoin.Psbt.fromBase64(String(opts.psbtBase64 || ''));
    const signer = Htlc.signerFromPriv32(opts.privateKey);
    const x = hex(signer.publicKey).slice(2);
    psbt.signInput(0, signer);
    const signatures = (psbt.data.inputs[0].tapScriptSig || [])
      .filter((s) => hex(s.pubkey) === x)
      .map((s) => ({ pubkey: hex(s.pubkey), leafHash: hex(s.leafHash), signature: hex(s.signature) }));
    if (!signatures.length) throw new Error('this key is not in the authority leaf');
    return { psbtBase64: psbt.toBase64(), signatures };
  }

  /**
   * Add member signatures after checking each one against the transaction.
   * @param {Object} opts
   * @param {Object} opts.descriptor
   * @param {string} opts.psbtBase64
   * @param {Array<{ pubkey: string, leafHash: string, signature: string }>} opts.signatures
   * @returns {{ psbtBase64: string, signers: string[] }} x-only pubkeys that have signed
   */
  static addWithdrawalSignatures (opts = {}) {
    const descriptor = Federation.canonicalDescriptor(opts.descriptor);
    const psbt = bitcoin.Psbt.fromBase64(String(opts.psbtBase64 || ''));
    const input = psbt.data.inputs[0];
    const have = new Set((input.tapScriptSig || []).map((s) => hex(s.pubkey)));
    const add = [];
    for (const s of Array.isArray(opts.signatures) ? opts.signatures : []) {
      const x = pubkeyXOnly(s && s.pubkey);
      if (!x || !Federation.isValidator(descriptor, x)) throw new Error('signature from a key outside the federation');
      if (!/^[0-9a-f]{64}$/.test(String(s.leafHash)) || !/^[0-9a-f]{128}$/.test(String(s.signature))) {
        throw new Error('malformed signature');
      }
      if (have.has(x)) continue;
      have.add(x);
      add.push({ pubkey: Buffer.from(x, 'hex'), leafHash: Buffer.from(s.leafHash, 'hex'), signature: Buffer.from(s.signature, 'hex') });
    }
    if (add.length) psbt.updateInput(0, { tapScriptSig: add });
    for (const s of add) {
      const ok = psbt.validateSignaturesOfInput(0, (pubkey, msghash, signature) => ecc.verifySchnorr(msghash, pubkey, signature), s.pubkey);
      if (!ok) throw new Error(`signature from ${hex(s.pubkey)} does not verify`);
    }
    return { psbtBase64: psbt.toBase64(), signers: [...have] };
  }

  /**
   * Finalize with exactly `threshold` signatures (CHECKSIGADD … NUMEQUAL fails with more).
   * @param {Object} opts
   * @param {Object} opts.descriptor
   * @param {string} opts.psbtBase64
   * @returns {{ txHex: string, txid: string }}
   */
  static finalizeWithdrawal (opts = {}) {
    const Policy = require('./policy');
    const descriptor = Federation.canonicalDescriptor(opts.descriptor);
    const psbt = bitcoin.Psbt.fromBase64(String(opts.psbtBase64 || ''));
    const input = psbt.data.inputs[0];
    const sigs = (input.tapScriptSig || []).filter((s) => Federation.isValidator(descriptor, hex(s.pubkey)));
    if (sigs.length < descriptor.threshold) {
      throw new Error(`${sigs.length} of ${descriptor.threshold} signatures`);
    }
    input.tapScriptSig = sigs.slice(0, descriptor.threshold);
    const done = Policy.finalizeSpendPsbt({ psbtBase64: psbt.toBase64() });
    return { txHex: done.txHex, txid: done.txid };
  }

  /**
   * Whether a `CONTRACT_MESSAGE` body is one of the federation messages.
   * @param {Object} body
   * @returns {boolean}
   */
  static isMessage (body) {
    return !!(body && typeof body === 'object' && MESSAGE_TYPE_SET.has(body.type));
  }

  /**
   * Invite body, sent by the publisher (namespace = federation id).
   * @param {Object} opts
   * @param {Object} opts.descriptor Canonical descriptor
   * @param {string} [opts.name]
   * @param {Array<{ pubkey: string, url?: string, alias?: string }>} [opts.members] Contact hints per validator
   * @returns {Object}
   */
  static inviteMessage (opts = {}) {
    const descriptor = Federation.canonicalDescriptor(opts.descriptor);
    const id = Federation.descriptorId(descriptor);
    const hints = new Map((Array.isArray(opts.members) ? opts.members : [])
      .map((m) => [pubkeyXOnly(m && m.pubkey), m])
      .filter(([x]) => x));
    return {
      contract: id,
      type: MESSAGE_TYPES.invite,
      federationId: id,
      name: opts.name || null,
      descriptor,
      members: descriptor.validators.map((pk) => {
        const m = hints.get(pk.slice(2)) || {};
        return { pubkey: pk, url: m.url || null, alias: m.alias || null };
      })
    };
  }

  /**
   * Accept or decline an invite.
   * @param {string} federationId
   * @param {boolean} accept
   * @returns {Object}
   */
  static responseMessage (federationId, accept) {
    return { contract: federationId, type: MESSAGE_TYPES.response, federationId, accept: accept === true };
  }

  /**
   * Ask the other members to re-send their invite, answers, and pending withdrawals.
   * @param {string} federationId
   * @returns {Object}
   */
  static syncMessage (federationId) {
    return { contract: federationId, type: MESSAGE_TYPES.sync, federationId };
  }

  /**
   * Withdrawal request: what to pay and from which funding transaction, so every
   * member can rebuild the PSBT ({@link Federation.verifyWithdrawalRequest}).
   * @param {string} federationId
   * @param {Object} w `{ requestId, fundedTxHex, vout, destinationAddress, amountSats, feeSats }`
   * @returns {Object}
   */
  static withdrawalMessage (federationId, w) {
    return {
      contract: federationId,
      type: MESSAGE_TYPES.withdrawal,
      federationId,
      requestId: w.requestId,
      fundedTxHex: w.fundedTxHex,
      vout: w.vout,
      destinationAddress: w.destinationAddress,
      amountSats: w.amountSats,
      feeSats: w.feeSats
    };
  }

  /**
   * One member's signatures for a withdrawal.
   * @param {string} federationId
   * @param {string} requestId
   * @param {Array<{ pubkey: string, leafHash: string, signature: string }>} signatures
   * @returns {Object}
   */
  static signatureMessage (federationId, requestId, signatures) {
    return { contract: federationId, type: MESSAGE_TYPES.signature, federationId, requestId, signatures };
  }

  /**
   * Notice that a withdrawal reached the chain.
   * @param {string} federationId
   * @param {string} requestId
   * @param {string} txid
   * @returns {Object}
   */
  static broadcastMessage (federationId, requestId, txid) {
    return { contract: federationId, type: MESSAGE_TYPES.broadcast, federationId, requestId, txid };
  }

  /**
   * Check an invite: the id is its descriptor's hash and the publisher signed it.
   * @param {Object} body
   * @param {string} signer verified author pubkey (compressed or x-only)
   * @returns {Object} canonical descriptor
   */
  static verifyInvite (body, signer) {
    if (!body || body.type !== MESSAGE_TYPES.invite) throw new Error('not a federation invite');
    if (body.contract !== body.federationId) throw new Error('contract must be the federation id');
    const descriptor = Federation.canonicalDescriptor(body.descriptor);
    if (Federation.descriptorId(descriptor) !== String(body.federationId)) {
      throw new Error('federation id does not match its descriptor');
    }
    if (descriptor.publisher.slice(2) !== pubkeyXOnly(signer)) throw new Error('invite is not signed by its publisher');
    return descriptor;
  }

  /**
   * Check a message for a known federation: right namespace, signed by a member.
   * @param {Object} descriptor
   * @param {Object} body
   * @param {string} signer verified author pubkey
   * @returns {string} x-only signer
   */
  static verifySender (descriptor, body, signer) {
    if (!body || body.contract !== body.federationId) throw new Error('contract must be the federation id');
    if (Federation.descriptorId(descriptor) !== String(body.federationId)) throw new Error('message is for another federation');
    const x = pubkeyXOnly(signer);
    if (!x || !Federation.isValidator(descriptor, x)) throw new Error('signer is not a member');
    return x;
  }

  /**
   * Rebuild a withdrawal request's PSBT and check it matches its request id.
   * @param {Object} descriptor
   * @param {Object} body withdrawal message body
   * @returns {Object} {@link Federation.prepareWithdrawal} result
   */
  static verifyWithdrawalRequest (descriptor, body) {
    const prepared = Federation.prepareWithdrawal({
      descriptor,
      fundedTxHex: body.fundedTxHex,
      vout: body.vout,
      destinationAddress: body.destinationAddress,
      amountSats: body.amountSats,
      feeSats: body.feeSats
    });
    if (prepared.requestId !== String(body.requestId)) throw new Error('withdrawal request does not match what it describes');
    return prepared;
  }
}

Federation.RESERVE_KEY = RESERVE_KEY;
Federation.DUST_SATS = DUST_SATS;
Federation.DEFAULT_PAYOUT_MIN_CONFIRMATIONS = DEFAULT_PAYOUT_MIN_CONFIRMATIONS;
Federation.DESCRIPTOR_TYPE = DESCRIPTOR_TYPE;
Federation.DESCRIPTOR_VERSION = DESCRIPTOR_VERSION;
Federation.NETWORKS = NETWORKS;
Federation.DEFAULT_CSV_BLOCKS = DEFAULT_CSV_BLOCKS;
Federation.AUTHORITY_TIER = AUTHORITY_TIER;
Federation.MESSAGE_TYPES = MESSAGE_TYPES;

module.exports = Federation;
