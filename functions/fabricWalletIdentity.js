'use strict';

/**
 * Load operator identity from `~/.fabric/wallet.json` (Environment).
 *
 * Sealed wallets need `FABRIC_PASSWORD`. Public object never contains seed/xprv.
 *
 * @fileoverview Wallet-file identity fallback for suite loaders.
 * @module functions/fabricWalletIdentity
 */

const os = require('os');
const path = require('path');

const Environment = require('../types/environment');
const { classifyFabricKeyMaterial } = require('./fabricKeyMaterial');

/**
 * @param {Object} [opts]
 * @param {string} [opts.home]
 * @param {string} [opts.walletPath]
 * @param {string} [opts.store]
 * @param {string} [opts.password]
 * @returns {{ mnemonic: string|null, seed: string|null, xprv: string, xpub: string }|null}
 */
function loadIdentityFromWalletFile (opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const store = opts.store || path.join(home, '.fabric');
  const walletPath = opts.walletPath || path.join(store, 'wallet.json');
  const environment = new Environment({
    home,
    path: walletPath,
    store
  });
  try {
    environment.loadWallet({ password: opts.password || environment.readVariable('FABRIC_PASSWORD') });
  } catch (_) {
    return null;
  }
  if (!environment.wallet || !environment.wallet.key || !environment.wallet.key.xprv) {
    return null;
  }
  const key = environment.wallet.key;
  const seedRaw = key.seed ? String(key.seed) : '';
  const classified = classifyFabricKeyMaterial(seedRaw);
  return {
    mnemonic: classified.kind === 'mnemonic'
      ? classified.mnemonic
      : (key.mnemonic ? String(key.mnemonic) : null),
    seed: classified.kind === 'seedHex' ? classified.seed : (classified.kind === 'mnemonic' ? null : (seedRaw || null)),
    xprv: key.xprv,
    xpub: key.xpub || null
  };
}

module.exports = {
  loadIdentityFromWalletFile
};
