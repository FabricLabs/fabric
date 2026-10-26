'use strict';

/**
 * @fileoverview One seed, many accounts, three separate keys each.
 *
 * A user imports one mnemonic (plus an optional BIP39 passphrase) once; the
 * client keeps only the resulting master xprv, sealed by a separate lock
 * password. From that master, every (account, network) pair derives:
 *
 * - a Fabric identity key `m/7777'/F'/n'/0/0` (F = 7777 on mainnet, 7778 elsewhere),
 *   the only key a sign-in proves;
 * - a Bitcoin wallet: `m/84'/B'/n'` (SegWit, every new receive and change
 *   address) and `m/44'/B'/n'` (standard `pkh`, watched and spendable, never
 *   hands out addresses), B = 0 on mainnet and 1 elsewhere;
 * - a multisig cosigner key `m/87'/B'/n'/0/0` for group wallets, escrow, and
 *   federations — never the identity key.
 *
 * Wallet xpubs are shared with depth, parent fingerprint, and child number
 * zeroed and no key origin, so xpubs from two accounts can't be linked to
 * one seed.
 *
 * @module functions/accountKeys
 */

const { networks, payments } = require('bitcoinjs-lib');
const Key = require('../types/key');
const bip39 = require('./bip39');
const { encodeCheck, decodeCheck } = require('./base58');
const { sealJson, openSealedJson } = require('./sealedBlob');
const { fabricIdentityIdFromPubkeyHex } = require('./fabricIdentitySchnorr');
const signingTags = require('./signingTags');
const {
  assertBip32ChildIndex,
  isMainnetNetwork,
  fabricIdentityDerivationPath,
  bitcoinAccountDerivationPath,
  bitcoinCosignerDerivationPath
} = require('../constants');

/** Networks an account may be derived for. */
const ACCOUNT_NETWORKS = Object.freeze(['mainnet', 'testnet', 'testnet4', 'signet', 'regtest']);
/** Addresses scanned past the last used one, on each chain of each wallet account. */
const WALLET_GAP_LIMIT = 20;
/** Stored record type for a sealed master plus its public account cache. */
const ACCOUNT_VAULT_TYPE = 'FabricAccountVault';
const ACCOUNT_VAULT_VERSION = 2;

/** @private bitcoinjs-lib address parameters per network. */
const ADDRESS_NETWORKS = Object.freeze({
  mainnet: networks.bitcoin,
  testnet: networks.testnet,
  regtest: networks.regtest
});

/** @private BIP32 serialization versions (xprv/xpub, tprv/tpub). */
const VERSIONS = Object.freeze({
  mainnet: networks.bitcoin.bip32,
  testnet: networks.testnet.bip32
});

/**
 * Canonical network name for account derivation.
 * @param {string} network
 * @returns {string} One of {@link ACCOUNT_NETWORKS}.
 */
function normalizeAccountNetwork (network) {
  if (isMainnetNetwork(network)) return 'mainnet';
  const n = String(network == null ? '' : network).trim().toLowerCase();
  if (n === 'test') return 'testnet';
  if (ACCOUNT_NETWORKS.includes(n)) return n;
  throw new RangeError(`unknown network: ${network}`);
}

/** @private */
function versionsFor (network) {
  return normalizeAccountNetwork(network) === 'mainnet' ? VERSIONS.mainnet : VERSIONS.testnet;
}

/** @private */
function addressNetworkFor (network) {
  const n = normalizeAccountNetwork(network);
  if (n === 'mainnet') return ADDRESS_NETWORKS.mainnet;
  if (n === 'regtest') return ADDRESS_NETWORKS.regtest;
  return ADDRESS_NETWORKS.testnet;
}

/**
 * @private
 * @param {string} base58
 * @returns {{ payload: Buffer, isPrivate: boolean }}
 */
function decodeExtendedKey (base58) {
  const payload = decodeCheck(String(base58 || '').trim());
  if (payload.length !== 78) throw new Error('invalid extended key length');
  const version = payload.readUInt32BE(0);
  const isPrivate = version === VERSIONS.mainnet.private || version === VERSIONS.testnet.private;
  const isPublic = version === VERSIONS.mainnet.public || version === VERSIONS.testnet.public;
  if (!isPrivate && !isPublic) throw new Error('unknown extended key version');
  return { payload, isPrivate };
}

/**
 * Re-serialize an extended key with a network's version bytes (`xpub`/`xprv`
 * on mainnet, `tpub`/`tprv` elsewhere). Key material is unchanged.
 * @param {string} base58
 * @param {string} network
 * @returns {string}
 */
function extendedKeyForNetwork (base58, network) {
  const { payload, isPrivate } = decodeExtendedKey(base58);
  const out = Buffer.from(payload);
  const versions = versionsFor(network);
  out.writeUInt32BE(isPrivate ? versions.private : versions.public, 0);
  return encodeCheck(out);
}

/**
 * Serialize an account xpub for sharing: the network's version bytes, with
 * depth, parent fingerprint, and child number zeroed. Those header fields
 * would otherwise tie every account of one seed to the same parent; child
 * derivation doesn't use them, so addresses are unchanged.
 * @param {string} base58 Account xpub / tpub.
 * @param {string} network
 * @returns {string}
 */
function shareableAccountXpub (base58, network) {
  const { payload, isPrivate } = decodeExtendedKey(base58);
  if (isPrivate) throw new Error('only public extended keys are shared');
  const out = Buffer.from(payload);
  out.writeUInt32BE(versionsFor(network).public, 0);
  out[4] = 0;
  out.writeUInt32BE(0, 5);
  out.writeUInt32BE(0, 9);
  return encodeCheck(out);
}

/**
 * Generate a new mnemonic. Show it once for backup; it is never stored.
 * @param {number} [strength=256] Entropy bits (128 → 12 words, 256 → 24 words).
 * @returns {string}
 */
function generateMnemonic (strength = 256) {
  return bip39.generateMnemonic(strength);
}

/**
 * Turn a mnemonic and optional BIP39 passphrase into the master xprv. Callers
 * drop the mnemonic and passphrase right after.
 * @param {string} mnemonic
 * @param {string} [passphrase] The derivation password (BIP39 passphrase).
 * @returns {string} Master xprv (mainnet serialization; the network is chosen per account).
 */
function importSeed (mnemonic, passphrase = '') {
  const phrase = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(phrase)) throw new Error('invalid BIP39 mnemonic');
  const seed = bip39.mnemonicToSeedSync(phrase, passphrase == null ? '' : String(passphrase));
  const key = new Key({ seed: Buffer.from(seed).toString('hex') });
  return normalizeMasterXprv(key.xprv);
}

/**
 * Validate a master xprv (depth 0, private) and serialize it for mainnet.
 * @param {string|Key} master xprv / tprv string or a Key holding one.
 * @returns {string}
 */
function normalizeMasterXprv (master) {
  const base58 = master instanceof Key ? master.xprv : master;
  if (typeof base58 !== 'string' || !base58) throw new TypeError('master xprv required');
  const { payload, isPrivate } = decodeExtendedKey(base58);
  if (!isPrivate) throw new Error('master xprv required (got a public key)');
  if (payload[4] !== 0) throw new Error('master xprv required (depth 0)');
  return extendedKeyForNetwork(base58, 'mainnet');
}

/**
 * Derive the three keys of one (account, network) pair.
 * @param {string|Key} master Master xprv.
 * @param {Object} [options]
 * @param {number} [options.account=0]
 * @param {string} [options.network='mainnet']
 * @returns {{ account: number, network: string, identity: { path: string, key: Key, pubkey: string, id: string }, wallet: { segwit: { path: string, xpub: string, key: Key }, standard: { path: string, xpub: string, key: Key }, receive: string, descriptors: object }, cosigner: { path: string, key: Key, pubkey: string } }}
 */
function deriveAccount (master, options = {}) {
  const root = new Key({ xprv: normalizeMasterXprv(master) });
  const account = assertBip32ChildIndex(options.account != null ? options.account : 0, 'account');
  const network = normalizeAccountNetwork(options.network != null ? options.network : 'mainnet');

  const identityPath = fabricIdentityDerivationPath(account, 0, network);
  const identityKey = root.derive(identityPath);
  const identityPubkey = String(identityKey.pubkey).toLowerCase();

  const segwitPath = bitcoinAccountDerivationPath(84, account, network);
  const segwitKey = root.derive(segwitPath);
  const standardPath = bitcoinAccountDerivationPath(44, account, network);
  const standardKey = root.derive(standardPath);
  const wallet = {
    segwit: { path: segwitPath, xpub: shareableAccountXpub(segwitKey.xpub, network), key: segwitKey },
    standard: { path: standardPath, xpub: shareableAccountXpub(standardKey.xpub, network), key: standardKey },
    receive: 'segwit'
  };
  wallet.descriptors = walletDescriptors(wallet);

  const cosignerPath = bitcoinCosignerDerivationPath(account, network);
  const cosignerKey = root.derive(cosignerPath);

  return {
    account,
    network,
    identity: {
      path: identityPath,
      key: identityKey,
      pubkey: identityPubkey,
      id: fabricIdentityIdFromPubkeyHex(identityPubkey)
    },
    wallet,
    cosigner: {
      path: cosignerPath,
      key: cosignerKey,
      pubkey: String(cosignerKey.pubkey).toLowerCase()
    }
  };
}

/**
 * The watch set of a wallet: SegWit receive and change, plus the standard
 * account's `pkh` receive and change. No key origins.
 * @param {{ segwit: { xpub: string }, standard: { xpub: string } }} wallet
 * @returns {{ receive: string, change: string, watch: string[] }}
 */
function walletDescriptors (wallet) {
  if (!wallet || !wallet.segwit || !wallet.standard) throw new TypeError('wallet with segwit and standard accounts required');
  const s = wallet.segwit.xpub;
  const l = wallet.standard.xpub;
  return {
    receive: `wpkh(${s}/0/*)`,
    change: `wpkh(${s}/1/*)`,
    watch: [
      `wpkh(${s}/0/*)`,
      `wpkh(${s}/1/*)`,
      `pkh(${l}/0/*)`,
      `pkh(${l}/1/*)`
    ]
  };
}

/**
 * Address at `<chain>/<index>` of a wallet account xpub.
 * @param {Object} params
 * @param {string} params.xpub Account xpub / tpub.
 * @param {string} params.network
 * @param {('wpkh'|'pkh')} [params.script='wpkh']
 * @param {number} [params.change=0]
 * @param {number} [params.index=0]
 * @returns {string}
 */
function walletAddress (params = {}) {
  const network = normalizeAccountNetwork(params.network);
  const change = assertBip32ChildIndex(params.change != null ? params.change : 0, 'change');
  if (change !== 0 && change !== 1) throw new RangeError('change must be 0 or 1');
  const index = assertBip32ChildIndex(params.index != null ? params.index : 0, 'index');
  const node = new Key({ xpub: extendedKeyForNetwork(params.xpub, 'mainnet') });
  const pubkey = Buffer.from(node.master.derive(change).derive(index).publicKey);
  const net = addressNetworkFor(network);
  const script = params.script || 'wpkh';
  if (script === 'wpkh') return payments.p2wpkh({ pubkey, network: net }).address;
  if (script === 'pkh') return payments.p2pkh({ pubkey, network: net }).address;
  throw new RangeError(`unsupported script: ${script}`);
}

/** @private */
function assertWalletVerified (wallet) {
  if (wallet && wallet.verified === false) {
    const err = new Error('unlock the vault before handing out addresses');
    err.code = 'FABRIC_ACCOUNT_UNVERIFIED';
    throw err;
  }
}

/**
 * Next receive address: always from the SegWit account. Refuses a wallet
 * from a locked vault view (`verified: false`, see {@link currentVaultAccount}).
 * @param {{ segwit: { xpub: string } }} wallet
 * @param {string} network
 * @param {number} index
 * @returns {string}
 */
function walletReceiveAddress (wallet, network, index = 0) {
  assertWalletVerified(wallet);
  return walletAddress({ xpub: wallet.segwit.xpub, network, script: 'wpkh', change: 0, index });
}

/**
 * Change address: always from the SegWit account. Refuses a wallet from a
 * locked vault view, like {@link walletReceiveAddress}.
 * @param {{ segwit: { xpub: string } }} wallet
 * @param {string} network
 * @param {number} index
 * @returns {string}
 */
function walletChangeAddress (wallet, network, index = 0) {
  assertWalletVerified(wallet);
  return walletAddress({ xpub: wallet.segwit.xpub, network, script: 'wpkh', change: 1, index });
}

/**
 * @private
 * @param {{ identityPubkey: string, cosignerPubkey: string, scope: string }} params
 * @returns {string}
 */
function cosignerProofMessage (params) {
  const identity = String(params.identityPubkey || '').toLowerCase();
  const cosigner = String(params.cosignerPubkey || '').toLowerCase();
  const scope = String(params.scope || '');
  if (!/^0[23][0-9a-f]{64}$/.test(identity)) throw new TypeError('compressed identity pubkey required');
  if (!/^0[23][0-9a-f]{64}$/.test(cosigner)) throw new TypeError('compressed cosigner pubkey required');
  if (!scope || scope.length > 512) throw new TypeError('scope required (at most 512 characters)');
  return `fabric-cosigner:1\n${scope}\n${identity}\n${cosigner}`;
}

/**
 * Sign a claim, by the holder of `cosignerKey`, that it acts for
 * `identityPubkey` within `scope` (e.g. `passport:<origin>:<challengeHash>`,
 * `group:<contractId>`). Only the cosigner key signs, and an identity pubkey
 * is public, so the proof alone does not show that the identity authorized
 * the cosigner: carry it inside a message the identity key signs, as a
 * `PASSPORT_ASSERTION` does.
 * @param {Key} cosignerKey
 * @param {{ identityPubkey: string, scope: string }} params
 * @returns {string} BIP340 signature hex.
 */
function cosignerProof (cosignerKey, params = {}) {
  if (!cosignerKey || !cosignerKey.private) throw new TypeError('cosigner private key required');
  const message = cosignerProofMessage({
    identityPubkey: params.identityPubkey,
    cosignerPubkey: cosignerKey.pubkey,
    scope: params.scope
  });
  return Buffer.from(cosignerKey.signSchnorr(message, signingTags.PASSPORT_COSIGNER)).toString('hex');
}

/**
 * Check a cosigner proof: the cosigner key signed this claim. Accept it only
 * from inside a message the identity key signed (see {@link cosignerProof}).
 * @param {{ cosigner: string, identityPubkey: string, scope: string, proof: string }} params
 * @returns {boolean}
 */
function verifyCosignerProof (params = {}) {
  try {
    const message = cosignerProofMessage({
      identityPubkey: params.identityPubkey,
      cosignerPubkey: params.cosigner,
      scope: params.scope
    });
    const sig = Buffer.from(String(params.proof || ''), 'hex');
    if (sig.length !== 64) return false;
    const key = new Key({ public: String(params.cosigner).toLowerCase() });
    return key.verifySchnorr(message, sig, signingTags.PASSPORT_COSIGNER);
  } catch (_) {
    return false;
  }
}

/**
 * Seal a master xprv with the lock password (PBKDF2-SHA256, AES-256-GCM).
 * @param {string|Key} master
 * @param {string} lockPassword
 * @returns {object}
 */
function sealMaster (master, lockPassword) {
  return sealJson({ xprv: normalizeMasterXprv(master) }, lockPassword, { type: 'FabricSealedMaster', version: ACCOUNT_VAULT_VERSION });
}

/**
 * Open a sealed master xprv.
 * @param {object} blob
 * @param {string} lockPassword
 * @returns {string}
 */
function unsealMaster (blob, lockPassword) {
  const inner = openSealedJson(blob, lockPassword);
  if (!inner || typeof inner.xprv !== 'string') throw new Error('sealed master is missing its xprv');
  return normalizeMasterXprv(inner.xprv);
}

/**
 * Public data of a derived account, cached unsealed in a vault so a locked
 * client can show identities and watch-only balances. Anyone able to edit the
 * record can change it, and no key is available to check it while locked, so
 * {@link currentVaultAccount} marks it unverified until the master checks it.
 * @param {ReturnType<typeof deriveAccount>} derived
 * @param {string} [label]
 * @returns {object}
 */
function accountPublicView (derived, label) {
  return {
    account: derived.account,
    network: derived.network,
    label: label != null ? String(label).slice(0, 64) : `Account ${derived.account}`,
    identity: { pubkey: derived.identity.pubkey, id: derived.identity.id },
    wallet: {
      segwit: { path: derived.wallet.segwit.path, xpub: derived.wallet.segwit.xpub },
      standard: { path: derived.wallet.standard.path, xpub: derived.wallet.standard.xpub },
      receive: 'segwit'
    },
    cosigner: { pubkey: derived.cosigner.pubkey }
  };
}

/**
 * Cache key of one (account, network) pair in a vault.
 * @param {number} account
 * @param {string} network
 * @returns {string}
 */
function vaultAccountKey (account, network) {
  return `${normalizeAccountNetwork(network)}:${assertBip32ChildIndex(account, 'account')}`;
}

/**
 * A new stored record: the sealed master, the current pair, and its public cache.
 * @param {Object} params
 * @param {string|Key} params.master
 * @param {string} params.lockPassword
 * @param {number} [params.account=0]
 * @param {string} [params.network='mainnet']
 * @param {string} [params.label]
 * @returns {object}
 */
function createAccountVault (params = {}) {
  const derived = deriveAccount(params.master, { account: params.account, network: params.network });
  const vault = {
    type: ACCOUNT_VAULT_TYPE,
    v: ACCOUNT_VAULT_VERSION,
    seal: sealMaster(params.master, params.lockPassword),
    current: { account: derived.account, network: derived.network },
    accounts: {}
  };
  vault.accounts[vaultAccountKey(derived.account, derived.network)] = accountPublicView(derived, params.label);
  return vault;
}

/** @private */
function assertAccountVault (vault) {
  if (!vault || vault.type !== ACCOUNT_VAULT_TYPE || vault.v !== ACCOUNT_VAULT_VERSION) {
    throw new TypeError('account vault v2 required');
  }
}

/** @private */
function vaultMismatch (why) {
  const err = new Error(`account vault cache does not match its master: ${why}`);
  err.code = 'FABRIC_ACCOUNT_VAULT_MISMATCH';
  return err;
}

/**
 * @private
 * @returns {object} The fresh view of a cached pair; throws when they differ.
 */
function checkCachedAccount (key, cached, master) {
  if (!cached || vaultAccountKey(cached.account, cached.network) !== key) throw vaultMismatch(key);
  const fresh = accountPublicView(deriveAccount(master, { account: cached.account, network: cached.network }), cached.label);
  if (JSON.stringify(fresh) !== JSON.stringify(cached)) throw vaultMismatch(key);
  return fresh;
}

/**
 * Check every cached pair of a vault against what `master` derives, and
 * refuse a vault whose cache was edited (say, an xpub swapped for someone
 * else's). Re-deriving checks more than a MAC could, and needs no key while
 * locked, when nothing could check a MAC anyway.
 * @param {object} vault
 * @param {string|Key} master
 * @returns {object} The vault, unchanged.
 */
function verifyVaultAccounts (vault, master) {
  assertAccountVault(vault);
  const accounts = vault.accounts || {};
  for (const [key, cached] of Object.entries(accounts)) checkCachedAccount(key, cached, master);
  if (!vault.current || !accounts[vaultAccountKey(vault.current.account, vault.current.network)]) {
    throw vaultMismatch('current account is not cached');
  }
  return vault;
}

/**
 * Unlock a vault: open the sealed master with the lock password and check the
 * public cache against it ({@link verifyVaultAccounts}). Pass the master to
 * {@link currentVaultAccount} for a view that hands out addresses.
 * @param {object} vault
 * @param {string} lockPassword
 * @returns {string} Master xprv.
 */
function openAccountVault (vault, lockPassword) {
  assertAccountVault(vault);
  const master = unsealMaster(vault.seal, lockPassword);
  verifyVaultAccounts(vault, master);
  return master;
}

/**
 * Switch a vault to another pair. Derives (and caches) it when the master is
 * given; without it only cached pairs can be selected.
 * @param {object} vault
 * @param {{ account: number, network: string, master: (string|Key|undefined), label: (string|undefined) }} params
 * @returns {object} New vault record.
 */
function selectVaultAccount (vault, params = {}) {
  assertAccountVault(vault);
  const network = normalizeAccountNetwork(params.network);
  const account = assertBip32ChildIndex(params.account, 'account');
  const key = vaultAccountKey(account, network);
  const accounts = Object.assign({}, vault.accounts);
  if (params.master) {
    const derived = deriveAccount(params.master, { account, network });
    const prior = accounts[key];
    accounts[key] = accountPublicView(derived, params.label != null ? params.label : (prior && prior.label));
  } else if (!accounts[key]) {
    const err = new Error('unlock to add this account');
    err.code = 'FABRIC_ACCOUNT_LOCKED';
    throw err;
  } else if (params.label != null) {
    accounts[key] = Object.assign({}, accounts[key], { label: String(params.label).slice(0, 64) });
  }
  return Object.assign({}, vault, { current: { account, network }, accounts });
}

/**
 * Public view of the vault's current pair, marked `verified` on the view and
 * its `wallet`. Without the master it is the cache as stored, `verified:
 * false`: show it as unverified, and {@link walletReceiveAddress} /
 * {@link walletChangeAddress} refuse its wallet. With the master the pair is
 * re-derived and checked first (`FABRIC_ACCOUNT_VAULT_MISMATCH` when it
 * differs), and the view is `verified: true`.
 * @param {object} vault
 * @param {string|Key} [master]
 * @returns {object|null}
 */
function currentVaultAccount (vault, master) {
  if (!vault || !vault.current || !vault.accounts) return null;
  const key = vaultAccountKey(vault.current.account, vault.current.network);
  const cached = vault.accounts[key];
  if (!cached) return null;
  const view = master ? checkCachedAccount(key, cached, master) : cached;
  const verified = Boolean(master);
  return Object.assign({}, view, { verified, wallet: Object.assign({}, view.wallet, { verified }) });
}

module.exports = {
  ACCOUNT_NETWORKS,
  ACCOUNT_VAULT_TYPE,
  ACCOUNT_VAULT_VERSION,
  WALLET_GAP_LIMIT,
  normalizeAccountNetwork,
  extendedKeyForNetwork,
  shareableAccountXpub,
  generateMnemonic,
  importSeed,
  normalizeMasterXprv,
  deriveAccount,
  walletDescriptors,
  walletAddress,
  walletReceiveAddress,
  walletChangeAddress,
  cosignerProof,
  verifyCosignerProof,
  sealMaster,
  unsealMaster,
  accountPublicView,
  vaultAccountKey,
  createAccountVault,
  verifyVaultAccounts,
  openAccountVault,
  selectVaultAccount,
  currentVaultAccount
};
