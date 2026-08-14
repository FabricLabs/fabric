#!/usr/bin/env node
'use strict';

/**
 * Ensure `~/.fabric/env` and `~/.fabric/hub-admin-token` for RC1 publish.
 *
 * Identity precedence (same as Environment / suite loaders):
 *   FABRIC_XPRV → FABRIC_SEED (raw hex, or legacy mnemonic/xprv) → FABRIC_MNEMONIC
 *   → ~/.fabric/wallet.json (FABRIC_PASSWORD unlocks a sealed wallet)
 *
 * Prints public summary only (paths, source). Never prints seed/xprv/token.
 *
 *   node scripts/ensure-home-env.js
 *   FABRIC_PASSWORD='…' node scripts/ensure-home-env.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const Key = require('../types/key');
const bip39 = require('../functions/bip39');
const { keySettingsFromEnv, classifyFabricKeyMaterial } = require('../functions/fabricKeyMaterial');
const { loadIdentityFromWalletFile } = require('../functions/fabricWalletIdentity');
const {
  loadFabricHomeEnv,
  mintHubAdminToken,
  writeHubAdminToken,
  upsertFabricHomeEnv,
  readHubAdminToken
} = require('../functions/fabricHomeEnv');

function publicKeyPrefix (key) {
  try {
    const hex = key.public ? key.public.encodeCompressed('hex') : (key.pubkey || '');
    return hex ? String(hex).slice(0, 12) + '…' : null;
  } catch (_) {
    return null;
  }
}

function keyFromSettings (settings) {
  if (!settings) return null;
  return new Key(settings);
}

function identitySettingsFromWallet (row) {
  if (!row || !row.xprv) return null;
  return { xprv: row.xprv };
}

function seedHexFromKey (key) {
  if (!key) return null;
  const classified = classifyFabricKeyMaterial(key.seed);
  if (classified.kind === 'seedHex') return classified.seed;
  const phrase = classified.kind === 'mnemonic'
    ? classified.mnemonic
    : (key.mnemonic ? String(key.mnemonic) : '');
  if (phrase && bip39.validateMnemonic(phrase)) {
    return bip39.mnemonicToSeedSync(phrase).toString('hex');
  }
  return null;
}

function mnemonicFromKey (key) {
  if (!key) return null;
  const classified = classifyFabricKeyMaterial(key.seed);
  if (classified.kind === 'mnemonic') return classified.mnemonic;
  if (key.mnemonic && bip39.validateMnemonic(String(key.mnemonic))) return String(key.mnemonic);
  return null;
}

function hasFlag (name) {
  return process.argv.includes(name);
}

function main () {
  const walletOnly = hasFlag('--wallet-only');
  loadFabricHomeEnv();

  let source = null;
  let key = null;

  if (!walletOnly) {
    const fromEnv = keySettingsFromEnv(process.env);
    if (fromEnv) {
      key = keyFromSettings(fromEnv);
      source = fromEnv.xprv ? 'FABRIC_XPRV' : (fromEnv.seed ? 'FABRIC_SEED' : 'FABRIC_MNEMONIC');
    }
  }

  if (!key || !key.xprv) {
    const wallet = loadIdentityFromWalletFile({
      home: process.env.HOME || os.homedir(),
      password: process.env.FABRIC_PASSWORD
    });
    const settings = identitySettingsFromWallet(wallet);
    if (settings) {
      key = keyFromSettings(settings);
      source = 'wallet.json';
    }
  }

  const home = process.env.HOME || os.homedir();
  const store = path.join(home, '.fabric');
  const walletPath = path.join(store, 'wallet.json');
  const walletExists = fs.existsSync(walletPath);
  let walletLocked = false;
  if (walletExists && source !== 'wallet.json') {
    try {
      const doc = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
      walletLocked = !!(doc && doc.passwordProtected);
    } catch (_) { /* ignore */ }
  }

  if (!key || !key.xprv) {
    console.error('[FABRIC:HOME-ENV] No private key. Set FABRIC_XPRV / FABRIC_SEED / FABRIC_MNEMONIC,');
    console.error('                  or FABRIC_PASSWORD to unlock ~/.fabric/wallet.json.');
    process.exit(1);
  }

  const token = mintHubAdminToken(key);
  const tokenPath = writeHubAdminToken(token, { home, store });
  const hex = seedHexFromKey(key);
  const mnemonic = mnemonicFromKey(key);

  const stamped = {
    FABRIC_HUB_ADMIN_TOKEN: token,
    FABRIC_HUB_ADMIN_TOKEN_FILE: tokenPath
  };
  if (source === 'wallet.json') {
    stamped.FABRIC_XPRV = key.xprv;
    if (hex) stamped.FABRIC_SEED = hex;
    if (mnemonic) stamped.FABRIC_MNEMONIC = mnemonic;
    if (key.xpub) stamped.FABRIC_XPUB = key.xpub;
  }

  const envPath = upsertFabricHomeEnv(stamped, { home, store });
  const check = readHubAdminToken(process.env, { home, store });

  console.log('[FABRIC:HOME-ENV] home        ', store);
  console.log('[FABRIC:HOME-ENV] env         ', envPath);
  console.log('[FABRIC:HOME-ENV] admin token ', tokenPath);
  console.log('[FABRIC:HOME-ENV] identity    ', source, publicKeyPrefix(key) || '');
  console.log('[FABRIC:HOME-ENV] wallet.json ', walletExists ? (walletLocked && source !== 'wallet.json' ? 'present (sealed; FABRIC_PASSWORD to import)' : 'present') : 'missing');
  console.log('[FABRIC:HOME-ENV] token source', check.source || 'written');
  if (walletExists && walletLocked && source !== 'wallet.json') {
    console.log('[FABRIC:HOME-ENV] Note: sealed wallet was not unlocked; token is from', source + '.');
    console.log('                  Re-run with FABRIC_PASSWORD to stamp identity from wallet.json.');
  }
}

main();
