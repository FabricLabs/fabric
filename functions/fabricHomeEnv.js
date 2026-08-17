'use strict';

/**
 * `~/.fabric/env` and `~/.fabric/hub-admin-token` — operator home environment.
 *
 * Dotenv fills **missing** `FABRIC_*` keys only (process env wins). The Hub
 * admin token is a Schnorr-signed `OP_IDENTITY` Token for future RC1
 * `AcceptTrackedApplicationContract` / `--accept`.
 *
 * @fileoverview Fabric home env file + Hub admin token helpers.
 * CLI: `node functions/fabricHomeEnv.js` (or `npm run home-env`) writes
 * `~/.fabric/env` + `~/.fabric/hub-admin-token` without printing secrets.
 * @module functions/fabricHomeEnv
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const Token = require('../types/token');

const WALLET_FILE_MODE = 0o600;
const HOME_ENV_FILENAME = 'env';
const HUB_ADMIN_TOKEN_FILENAME = 'hub-admin-token';

/** Keys applied from `~/.fabric/env` (never overwrite a set process env value). */
const HOME_ENV_KEYS = new Set([
  'FABRIC_SEED',
  'FABRIC_MNEMONIC',
  'FABRIC_XPRV',
  'FABRIC_XPUB',
  'FABRIC_PUBKEY',
  'FABRIC_PASSWORD',
  'FABRIC_PASSPHRASE',
  'FABRIC_NETWORK',
  'FABRIC_LOCK_TIMEOUT_MINUTES',
  'FABRIC_HUB_ADMIN_TOKEN',
  'FABRIC_HUB_ADMIN_TOKEN_FILE',
  'FABRIC_ADMIN_TOKEN'
]);

/**
 * @param {Object} [opts]
 * @param {string} [opts.home]
 * @param {string} [opts.store]
 * @returns {string}
 */
function fabricHomeDir (opts = {}) {
  if (opts.store) return opts.store;
  const home = opts.home || process.env.HOME || os.homedir();
  return path.join(home, '.fabric');
}

/**
 * @param {Object} [opts]
 * @returns {string}
 */
function fabricHomeEnvPath (opts = {}) {
  return opts.envPath || path.join(fabricHomeDir(opts), HOME_ENV_FILENAME);
}

/**
 * @param {Object} [opts]
 * @returns {string}
 */
function fabricHubAdminTokenPath (opts = {}) {
  return opts.tokenPath || path.join(fabricHomeDir(opts), HUB_ADMIN_TOKEN_FILENAME);
}

/**
 * @param {string} filePath
 * @param {string} content
 */
function writePrivateFile (filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: WALLET_FILE_MODE });
  try {
    fs.chmodSync(filePath, WALLET_FILE_MODE);
  } catch (_) { /* best-effort on platforms without chmod */ }
}

/**
 * @param {string} text
 * @returns {Object<string, string>}
 */
function parseDotEnvText (text) {
  const out = {};
  if (text == null) return out;
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Load KEY=VALUE lines into `env` without overriding variables already present.
 *
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Object} [opts]
 * @param {Set<string>|string[]} [opts.allowKeys] When set, ignore other keys.
 * @returns {number} Count of keys applied
 */
function loadDotEnvFile (filePath, env = process.env, opts = {}) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return 0;
  }
  const allow = opts.allowKeys
    ? (opts.allowKeys instanceof Set ? opts.allowKeys : new Set(opts.allowKeys))
    : null;
  const parsed = parseDotEnvText(text);
  let n = 0;
  for (const [key, val] of Object.entries(parsed)) {
    if (allow && !allow.has(key)) continue;
    if (env[key] != null && env[key] !== '') continue;
    env[key] = val;
    n++;
  }
  return n;
}

/**
 * Fill missing `FABRIC_*` keys from `~/.fabric/env`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Object} [opts]
 * @returns {number}
 */
function loadFabricHomeEnv (env = process.env, opts = {}) {
  return loadDotEnvFile(fabricHomeEnvPath(opts), env, {
    allowKeys: opts.allowKeys || HOME_ENV_KEYS
  });
}

/**
 * Mint a Hub operator admin token (Schnorr `OP_IDENTITY` / `sub=admin`).
 * Valid only for Hubs whose root key is `issuerKey`.
 *
 * @param {import('../types/key')} issuerKey
 * @returns {string}
 */
function mintHubAdminToken (issuerKey) {
  if (!issuerKey) throw new Error('issuerKey required');
  const token = new Token({
    capability: 'OP_IDENTITY',
    issuer: issuerKey,
    subject: 'admin'
  });
  return token.toSignedString();
}

/**
 * @param {string} token
 * @param {Object} [opts]
 * @returns {string} Path written
 */
function writeHubAdminToken (token, opts = {}) {
  const file = fabricHubAdminTokenPath(opts);
  const line = String(token || '').trim();
  if (!line) throw new Error('admin token is empty');
  writePrivateFile(file, line + '\n');
  return file;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function readTokenFile (filePath) {
  const p = String(filePath || '').trim();
  if (!p) return '';
  try {
    if (!fs.existsSync(p)) return '';
    const line = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0];
    return String(line || '').trim();
  } catch (_) {
    return '';
  }
}

/**
 * Resolve Hub admin token: env → `FABRIC_HUB_ADMIN_TOKEN_FILE` → `~/.fabric/hub-admin-token`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Object} [opts]
 * @param {string} [opts.tokenPath]
 * @returns {Object} `token`, `source`, and optional `path` when read from a file
 */
function readHubAdminToken (env = process.env, opts = {}) {
  const direct = String(
    (env && (env.FABRIC_HUB_ADMIN_TOKEN || env.FABRIC_ADMIN_TOKEN)) || ''
  ).trim();
  if (direct) return { token: direct, source: 'env' };

  const file = String(
    (env && env.FABRIC_HUB_ADMIN_TOKEN_FILE) || opts.tokenPath || ''
  ).trim();
  if (file) {
    const fromFile = readTokenFile(file);
    if (fromFile) return { token: fromFile, source: 'adminTokenFile', path: file };
  }

  const homePath = fabricHubAdminTokenPath(opts);
  const fromHome = readTokenFile(homePath);
  if (fromHome) return { token: fromHome, source: 'home', path: homePath };

  return { token: '', source: null };
}

/**
 * Merge values into `~/.fabric/env` (0600). Existing keys are replaced when
 * present in `values`; other keys are preserved. Does not log secrets.
 *
 * @param {Object<string, string|null|undefined>} values
 * @param {Object} [opts]
 * @returns {string} Path written
 */
function upsertFabricHomeEnv (values, opts = {}) {
  const file = fabricHomeEnvPath(opts);
  let existing = {};
  try {
    existing = parseDotEnvText(fs.readFileSync(file, 'utf8'));
  } catch (_) { /* new file */ }

  const merged = Object.assign({}, existing);
  for (const [key, val] of Object.entries(values || {})) {
    if (!HOME_ENV_KEYS.has(key)) continue;
    if (val == null || val === '') {
      delete merged[key];
    } else {
      merged[key] = String(val);
    }
  }

  const lines = [
    '# Fabric home environment — gitignored, mode 0600.',
    '# Process env wins. Identity secrets prefer ~/.fabric/wallet.json when unset.',
    '# Do not commit this file.'
  ];
  for (const key of Array.from(HOME_ENV_KEYS)) {
    if (merged[key] == null || merged[key] === '') continue;
    lines.push(`${key}=${merged[key]}`);
  }
  writePrivateFile(file, lines.join('\n') + '\n');
  return file;
}

module.exports = {
  HOME_ENV_KEYS,
  HOME_ENV_FILENAME,
  HUB_ADMIN_TOKEN_FILENAME,
  WALLET_FILE_MODE,
  fabricHomeDir,
  fabricHomeEnvPath,
  fabricHubAdminTokenPath,
  writePrivateFile,
  parseDotEnvText,
  loadDotEnvFile,
  loadFabricHomeEnv,
  mintHubAdminToken,
  writeHubAdminToken,
  readTokenFile,
  readHubAdminToken,
  upsertFabricHomeEnv,
  runEnsureHomeEnvCli
};

function publicKeyPrefix (key) {
  try {
    const hex = key.public ? key.public.encodeCompressed('hex') : (key.pubkey || '');
    return hex ? String(hex).slice(0, 12) + '…' : null;
  } catch (_) {
    return null;
  }
}

/**
 * Stamp `~/.fabric/env` + Hub admin token. Prints public paths only.
 *
 * @param {string[]} [argv]
 * @returns {number} process exit code
 */
function runEnsureHomeEnvCli (argv = process.argv) {
  const Key = require('../types/key');
  const bip39 = require('./bip39');
  const { keySettingsFromEnv, classifyFabricKeyMaterial } = require('./fabricKeyMaterial');
  const { loadIdentityFromWalletFile } = require('./fabricWalletIdentity');

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

  const walletOnly = argv.includes('--wallet-only');
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
    return 1;
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
  return 0;
}

if (require.main === module) {
  const code = runEnsureHomeEnvCli(process.argv);
  if (code) process.exit(code);
}
