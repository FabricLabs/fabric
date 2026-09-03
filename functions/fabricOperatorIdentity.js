'use strict';

/**
 * Exclusive operator identity for Hub / playnet / applications.
 *
 * `Key` prefers `mnemonic` when a mixed bag is passed. Suite loaders must
 * collapse to **one** of xprv / seed / mnemonic / xpub / public so Hub
 * `_rootKey` matches `FABRIC_XPRV` (or `fabric setup` `~/.fabric/wallet.json`).
 *
 * Precedence: `FABRIC_XPRV` (xprv, or watch-only xpub/pubkey) → `FABRIC_SEED`
 * → `FABRIC_MNEMONIC` → sealed wallet file → `FABRIC_XPUB` / `FABRIC_PUBKEY`.
 *
 * @fileoverview Exclusive Fabric Environment identity for nodes.
 * @module functions/fabricOperatorIdentity
 */

const {
  classifyFabricKeyMaterial,
  classifyFabricIdentityEnvValue,
  keySettingsFromEnv
} = require('./fabricKeyMaterial');

function withPassphrase (out, bag) {
  if (!out || !bag || typeof bag !== 'object') return out;
  const passphrase = bag.passphrase != null ? bag.passphrase : bag.password;
  if (passphrase == null || passphrase === '') return out;
  out.passphrase = passphrase;
  return out;
}

/**
 * Collapse a Key settings bag to a single identity source.
 * Private HD (`xprv`) wins over seed/mnemonic so mixed env copies do not
 * silently follow Key's mnemonic-first constructor.
 *
 * @param {Object} [bag]
 * @returns {Object|null}
 */
function exclusiveOperatorKeySettings (bag = {}) {
  if (!bag || typeof bag !== 'object') return null;

  const xprvField = String(bag.xprv || '').trim();
  const fromXprvField = classifyFabricIdentityEnvValue(xprvField);
  if (fromXprvField.kind === 'xprv') {
    const out = { xprv: fromXprvField.xprv };
    const xpub = String(bag.xpub || '').trim();
    if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) out.xpub = xpub;
    return withPassphrase(out, bag);
  }
  if (fromXprvField.kind === 'xpub') {
    return withPassphrase({ xpub: fromXprvField.xpub }, bag);
  }
  if (fromXprvField.kind === 'pubkey') {
    return withPassphrase({ public: fromXprvField.public }, bag);
  }

  if (bag.seed != null && String(bag.seed).trim() !== '') {
    const classified = classifyFabricKeyMaterial(bag.seed);
    if (classified.kind === 'xprv') return withPassphrase({ xprv: classified.xprv }, bag);
    if (classified.kind === 'seedHex') return withPassphrase({ seed: classified.seed }, bag);
    if (classified.kind === 'mnemonic') {
      return withPassphrase({ mnemonic: classified.mnemonic }, bag);
    }
  }

  const mnemonic = String(bag.mnemonic || '').trim();
  if (mnemonic) {
    const classified = classifyFabricKeyMaterial(mnemonic);
    if (classified.kind === 'mnemonic') {
      return withPassphrase({ mnemonic: classified.mnemonic }, bag);
    }
    if (classified.kind === 'xprv') return withPassphrase({ xprv: classified.xprv }, bag);
    if (classified.kind === 'seedHex') return withPassphrase({ seed: classified.seed }, bag);
  }

  const xpub = String(bag.xpub || '').trim();
  if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) {
    return withPassphrase({ xpub }, bag);
  }
  const pub = String(bag.public || bag.pubkey || '').trim();
  const pubClassified = classifyFabricIdentityEnvValue(pub);
  if (pubClassified.kind === 'pubkey') {
    return withPassphrase({ public: pubClassified.public }, bag);
  }

  return null;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Object} [opts]
 * @param {boolean} [opts.allowWalletFallback=true]
 * @param {string} [opts.password]
 * @returns {{ source: string, key: Object }|null}
 */
function resolveFabricOperatorKeySettings (env = process.env, opts = {}) {
  const allowWallet = opts.allowWalletFallback !== false;
  const fromEnv = keySettingsFromEnv(env);
  if (fromEnv && (fromEnv.xprv || fromEnv.seed || fromEnv.mnemonic)) {
    const key = exclusiveOperatorKeySettings(fromEnv) || fromEnv;
    const source = fromEnv.xprv
      ? 'FABRIC_XPRV'
      : (fromEnv.seed ? 'FABRIC_SEED' : 'FABRIC_MNEMONIC');
    return { source, key };
  }

  if (allowWallet) {
    try {
      const { loadIdentityFromWalletFile } = require('./fabricWalletIdentity');
      const wallet = loadIdentityFromWalletFile({
        home: env && env.HOME,
        password: opts.password != null ? opts.password : (env && env.FABRIC_PASSWORD)
      });
      if (wallet && wallet.xprv) {
        const key = exclusiveOperatorKeySettings({
          xprv: wallet.xprv,
          seed: wallet.seed,
          mnemonic: wallet.mnemonic,
          xpub: wallet.xpub
        }) || { xprv: wallet.xprv };
        return { source: 'wallet.json', key };
      }
    } catch (_) { /* older pin or locked wallet */ }
  }

  if (fromEnv && (fromEnv.xpub || fromEnv.public)) {
    return {
      source: fromEnv.xpub ? 'FABRIC_XPRV' : 'FABRIC_PUBKEY',
      key: exclusiveOperatorKeySettings(fromEnv) || fromEnv
    };
  }

  return null;
}

module.exports = {
  exclusiveOperatorKeySettings,
  resolveFabricOperatorKeySettings
};
