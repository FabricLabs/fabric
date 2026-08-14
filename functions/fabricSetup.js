'use strict';

/**
 * Headless environment / wallet setup for the `fabric setup` command.
 *
 * Blessed UI in {@link ../types/setup} stays a thin adapter over these helpers
 * so scripts, CI (`--no-tui`, `--json`, `--backup`, `--restore`), and tests
 * share the same flows without a TTY.
 *
 * @fileoverview Headless Fabric environment setup (snapshot, generate, backup, restore).
 * @module functions/fabricSetup
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const Wallet = require('../types/wallet');
const Identity = require('../types/identity');
const bip39 = require('./bip39');
const { tryParsePersistedJson } = require('./wireJson');
const { isPasswordProtectedDocument, PASSWORD_MIN_LENGTH } = require('./sealedBlob');

const SETUP_PATH_MAX_LEN = 4096;
const SETUP_RESTORE_MAX_BYTES = 1024 * 1024;
const WALLET_FILE_MODE = 0o600;

/**
 * @param {string} [v]
 * @returns {boolean}
 */
function debugEnabled (v) {
  const raw = v != null ? v : process.env.FABRIC_DEBUG;
  return raw === '1' || raw === 'true';
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isSet (value) {
  return value != null && String(value).trim() !== '';
}

/**
 * Constant-time UTF-8 compare (password confirmation / similar secrets).
 * Length is not leaked by an early return: both sides are padded to the
 * same buffer before `crypto.timingSafeEqual`.
 *
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
function passwordsMatch (left, right) {
  const a = Buffer.from(String(left == null ? '' : left), 'utf8');
  const b = Buffer.from(String(right == null ? '' : right), 'utf8');
  const n = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(n);
  const pb = Buffer.alloc(n);
  a.copy(pa);
  b.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && a.length === b.length;
}

/**
 * Operator-supplied filesystem path (backup / restore / --wallet).
 * Absolute paths are allowed (USB / off-machine backups). Relative paths
 * resolve against `cwd`. Null bytes and oversize strings are rejected.
 *
 * @param {string} filePath
 * @param {Object} [opts]
 * @param {string} [opts.cwd]
 * @returns {string|null}
 */
function resolveSetupPath (filePath, opts = {}) {
  if (filePath == null || typeof filePath !== 'string') return null;
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes('\0') || trimmed.length > SETUP_PATH_MAX_LEN) return null;
  const cwd = opts.cwd || process.cwd();
  let abs;
  if (path.isAbsolute(trimmed)) {
    abs = path.normalize(trimmed);
  } else {
    abs = path.normalize(path.resolve(cwd, trimmed));
  }
  if (!abs || abs.includes('\0') || !path.isAbsolute(abs)) return null;
  return abs;
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
function readResolvedSetupFile (absolutePath) {
  const p = path.normalize(String(absolutePath || ''));
  if (!p || p.includes('\0') || !path.isAbsolute(p)) {
    throw new Error('invalid setup path');
  }
  // Path already validated by resolveSetupPath.
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error('not a regular file');
  if (st.size > SETUP_RESTORE_MAX_BYTES) throw new Error('backup file is too large');
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  return fs.readFileSync(p, { encoding: 'utf8' });
}

/**
 * @param {Wallet} wallet
 * @returns {string}
 */
function serializeWalletFile (wallet) {
  const object = wallet.export();
  const document = Object.assign({
    type: 'FabricWallet',
    format: 'plaintext',
    version: object.version,
    passwordProtected: false
  }, object);
  return JSON.stringify(document, null, '  ') + '\n';
}

/**
 * @param {string} phrase
 * @param {string} [passphrase]
 * @returns {Wallet}
 */
function walletFromPhrase (phrase, passphrase = '') {
  if (phrase == null || typeof phrase !== 'string') {
    throw new Error('Seed phrase must be a string.');
  }
  const normalized = phrase.trim().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(normalized)) {
    throw new Error('Seed phrase must be a valid BIP39 mnemonic.');
  }
  return new Wallet({
    key: {
      seed: normalized,
      passphrase: passphrase || ''
    }
  });
}

/**
 * @param {string} xprv
 * @returns {Wallet}
 */
function walletFromXprv (xprv) {
  if (xprv == null || typeof xprv !== 'string' || !xprv.trim()) {
    throw new Error('xprv must be a non-empty string.');
  }
  return new Wallet({
    key: {
      xprv: xprv.trim()
    }
  });
}

/**
 * @param {Environment} environment
 * @param {string} [walletFile]
 * @returns {{ ok: boolean, error?: string }}
 */
function applyWalletFileOption (environment, walletFile) {
  if (!isSet(walletFile)) return { ok: true };
  const resolved = resolveSetupPath(walletFile);
  if (!resolved) return { ok: false, error: 'Invalid --wallet path.' };
  environment.settings.path = resolved;
  environment.loadWallet();
  if (environment.wallet) environment.wallet.start();
  return { ok: true, path: resolved };
}

/**
 * @param {Environment} environment
 * @returns {string}
 */
function defaultBackupPath (environment) {
  const store = (environment && environment.settings && environment.settings.store)
    ? environment.settings.store
    : path.join(os.homedir(), '.fabric');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(store, 'backups', `wallet-${stamp}.json`);
}

/**
 * @param {Environment} environment
 * @returns {string}
 */
function identityNetwork (environment) {
  if (environment && environment.settings && environment.settings.network) {
    return String(environment.settings.network);
  }
  if (isSet(process.env.FABRIC_NETWORK)) return String(process.env.FABRIC_NETWORK);
  return 'regtest';
}

/**
 * Public-only view of the local Fabric environment. Never includes seed / xprv.
 *
 * @param {Environment} environment
 * @returns {object}
 */
function snapshotEnvironment (environment) {
  const walletFile = environment.WALLET_FILE;
  const exists = typeof environment.walletExists === 'function'
    ? environment.walletExists()
    : false;
  const loaded = !!(environment.wallet && environment.wallet.key);
  const locked = !!environment.walletLocked;
  const network = identityNetwork(environment);
  const pub = environment.walletPublic || {};
  const lockSnap = environment.lockSession && typeof environment.lockSession.snapshot === 'function'
    ? environment.lockSession.snapshot()
    : null;

  const snapshot = {
    status: loaded ? 'unlocked' : (locked ? 'locked' : (exists ? 'unreadable' : 'missing')),
    home: environment.settings && environment.settings.home,
    store: environment.settings && environment.settings.store,
    walletFile,
    walletExists: exists,
    walletLoaded: loaded,
    walletLocked: locked,
    passwordProtected: false,
    lockTimeoutMinutes: lockSnap ? lockSnap.timeoutMinutes : null,
    lockRemainingMs: lockSnap ? lockSnap.remainingMs : null,
    walletId: (loaded && environment.wallet.id)
      ? String(environment.wallet.id)
      : (pub.id || null),
    network,
    identity: pub.identity || null,
    pubkey: pub.pubkey || null,
    xpub: pub.xpub || null,
    derivation: pub.derivation || null,
    bitcoin: null,
    env: {
      FABRIC_SEED: isSet(process.env.FABRIC_SEED) ? 'set' : 'unset',
      FABRIC_XPRV: isSet(process.env.FABRIC_XPRV) ? 'set' : 'unset',
      FABRIC_XPUB: isSet(process.env.FABRIC_XPUB) ? 'set' : 'unset',
      FABRIC_MNEMONIC: isSet(process.env.FABRIC_MNEMONIC) ? 'set' : 'unset',
      FABRIC_NETWORK: isSet(process.env.FABRIC_NETWORK) ? String(process.env.FABRIC_NETWORK) : 'unset',
      FABRIC_DEBUG: debugEnabled() ? 'on' : 'off'
    }
  };

  if (loaded) {
    try {
      snapshot.xpub = environment.wallet.xpub || (environment.wallet.key && environment.wallet.key.xpub) || null;
      const identity = new Identity(environment.wallet.key);
      identity._state.content.network = network;
      snapshot.identity = identity.toString();
      snapshot.pubkey = identity.pubkey || null;
      snapshot.derivation = identity.derivation || null;
    } catch (exception) {
      snapshot.status = 'partial';
      snapshot.identityError = exception.message || String(exception);
    }
  } else if (locked) {
    snapshot.identityError = null;
  } else if (exists) {
    snapshot.identityError = 'Wallet file exists but could not be loaded.';
  }

  try {
    const doc = typeof environment.readWalletDocument === 'function'
      ? environment.readWalletDocument()
      : null;
    snapshot.passwordProtected = !!(doc && isPasswordProtectedDocument(doc));
  } catch (_) {
    snapshot.passwordProtected = locked;
  }

  const conf = environment.bitcoinConfig;
  if (conf && conf.found) {
    const settings = environment.bitcoinSettings || {};
    snapshot.bitcoin = {
      found: true,
      path: conf.path || null,
      network: settings.network || null,
      host: settings.host || null,
      rpcport: settings.rpcport || null
    };
  } else {
    snapshot.bitcoin = { found: false };
  }

  return snapshot;
}

/**
 * @param {object} snapshot
 * @returns {string}
 */
function formatSnapshot (snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const rows = [
    ['Status', snapshot.status],
    ['Home', snapshot.home],
    ['Store', snapshot.store],
    ['Wallet', snapshot.walletFile],
    ['Wallet id', snapshot.walletId],
    ['Network', snapshot.network],
    ['Identity', snapshot.identity],
    ['Pubkey', snapshot.pubkey],
    ['XPUB', snapshot.xpub],
    ['Derivation', snapshot.derivation],
    ['Protected', snapshot.passwordProtected ? 'yes (AES-256-GCM)' : (snapshot.walletExists ? 'no (plaintext)' : '—')],
    ['Lock', snapshot.walletLocked ? 'locked' : (snapshot.walletLoaded ? 'unlocked' : '—')],
    ['Idle timeout', snapshot.lockTimeoutMinutes === 0
      ? 'off'
      : (snapshot.lockTimeoutMinutes != null ? `${snapshot.lockTimeoutMinutes} min` : '—')]
  ];
  if (snapshot.bitcoin && snapshot.bitcoin.found) {
    rows.push([
      'Bitcoin',
      `${snapshot.bitcoin.path || ''} · ${snapshot.bitcoin.network || ''} · ${snapshot.bitcoin.host || ''}:${snapshot.bitcoin.rpcport || ''}`
    ]);
  } else {
    rows.push(['Bitcoin', 'no bitcoin.conf']);
  }
  const env = snapshot.env || {};
  rows.push([
    'Env',
    `SEED=${env.FABRIC_SEED} XPRV=${env.FABRIC_XPRV} XPUB=${env.FABRIC_XPUB} MNEMONIC=${env.FABRIC_MNEMONIC} NETWORK=${env.FABRIC_NETWORK} DEBUG=${env.FABRIC_DEBUG}`
  ]);
  if (snapshot.identityError) rows.push(['Note', snapshot.identityError]);

  const width = rows.reduce((max, [k]) => Math.max(max, String(k).length), 0);
  return rows.map(([k, v]) => {
    const key = String(k).padEnd(width, ' ');
    const value = v == null || v === '' ? '—' : String(v).trim();
    return `${key}  ${value}`;
  }).join('\n');
}

/**
 * Seed / xprv for an explicit reveal. Callers must not log this by default.
 *
 * @param {Environment} environment
 * @returns {{ ok: boolean, seed?: string, xprv?: string, error?: string }}
 */
function revealSecrets (environment) {
  if (environment && environment.walletLocked) {
    return { ok: false, error: 'Wallet is locked. Unlock first.' };
  }
  if (!environment || !environment.wallet || !environment.wallet.key) {
    return { ok: false, error: 'No wallet loaded.' };
  }
  const key = environment.wallet.key;
  return {
    ok: true,
    seed: key.seed || key.mnemonic || null,
    xprv: key.xprv || (key.master && typeof key.master.toBase58 === 'function' ? key.master.toBase58() : null)
  };
}

/**
 * @param {string} filePath
 */
function ensureParentDir (filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * @param {string} filePath
 * @param {string} content
 */
function writePrivateFile (filePath, content) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: WALLET_FILE_MODE });
  try {
    fs.chmodSync(filePath, WALLET_FILE_MODE);
  } catch (_) { /* best-effort on platforms without chmod */ }
}

/**
 * @param {Environment} environment
 * @param {Object} [opts]
 * @param {string} [opts.passphrase] BIP39 passphrase (not the encryption password).
 * @param {string} [opts.password] Encryption password (required unless `encrypt` is false).
 * @param {boolean} [opts.encrypt=true]
 * @param {boolean} [opts.force]
 * @returns {{ ok: boolean, seed?: string, walletId?: string, snapshot?: object, error?: string }}
 */
function generateWallet (environment, opts = {}) {
  const force = !!opts.force;
  const passphrase = opts.passphrase || '';
  const encrypt = opts.encrypt !== false;
  const password = opts.password != null ? String(opts.password) : '';
  if ((environment.wallet || environment.walletExists()) && !force) {
    return {
      ok: false,
      error: 'Wallet already configured; pass force to overwrite.',
      snapshot: snapshotEnvironment(environment)
    };
  }
  if (encrypt && password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Encryption password must be at least ${PASSWORD_MIN_LENGTH} characters (use --password).`
    };
  }

  const seed = Wallet.createSeed(passphrase);
  const wallet = walletFromPhrase(seed.phrase, passphrase);
  try {
    environment.setWallet(wallet, true, { password, encrypt });
  } catch (exception) {
    return { ok: false, error: exception.message || String(exception) };
  }
  try {
    fs.chmodSync(environment.WALLET_FILE, WALLET_FILE_MODE);
  } catch (_) { /* best-effort */ }
  wallet.start();
  environment.wallet = wallet;

  return {
    ok: true,
    seed: seed.phrase,
    walletId: wallet.id,
    snapshot: snapshotEnvironment(environment)
  };
}

/**
 * @param {Environment} environment
 * @param {string} [destPath]
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
function backupWallet (environment, destPath) {
  const dest = destPath
    ? resolveSetupPath(destPath)
    : defaultBackupPath(environment);
  if (!dest) return { ok: false, error: 'Invalid backup path.' };

  try {
    if (environment.walletExists()) {
      const raw = environment.readWallet();
      writePrivateFile(dest, typeof raw === 'string' ? raw : String(raw ?? ''));
      return { ok: true, path: dest };
    }
    if (environment.wallet && environment.wallet.key) {
      writePrivateFile(dest, serializeWalletFile(environment.wallet));
      return { ok: true, path: dest };
    }
    return { ok: false, error: 'No wallet to back up.' };
  } catch (exception) {
    return { ok: false, error: exception.message || String(exception) };
  }
}

/**
 * @param {object} parsed
 * @param {string} [passphrase]
 * @returns {Wallet}
 */
function walletFromBackupObject (parsed, passphrase = '') {
  const object = parsed && parsed.object ? parsed.object : parsed;
  if (!object || typeof object !== 'object') {
    throw new Error('Backup is not a Fabric wallet.');
  }
  if (object.seed) return walletFromPhrase(object.seed, passphrase);
  if (object.xprv) return walletFromXprv(object.xprv);
  throw new Error('Backup is missing seed and xprv.');
}

/**
 * @param {Environment} environment
 * @param {string} sourcePath
 * @param {Object} [opts]
 * @param {boolean} [opts.force]
 * @param {string} [opts.passphrase] BIP39 passphrase for plaintext backups that store a seed.
 * @param {string} [opts.password] Unlock a sealed backup, or encrypt a plaintext restore.
 * @param {boolean} [opts.encrypt=true]
 * @returns {{ ok: boolean, walletId?: string, snapshot?: object, error?: string }}
 */
function restoreWalletFromFile (environment, sourcePath, opts = {}) {
  const force = !!opts.force;
  const src = resolveSetupPath(sourcePath);
  if (!src) return { ok: false, error: 'Invalid restore path.' };
  if ((environment.wallet || environment.walletExists()) && !force) {
    return { ok: false, error: 'Wallet already configured; pass force to overwrite.' };
  }

  try {
    const raw = readResolvedSetupFile(src);
    const pr = tryParsePersistedJson(raw);
    if (!pr.ok) return { ok: false, error: pr.error.message || 'Backup is not valid JSON.' };

    if (isPasswordProtectedDocument(pr.value)) {
      writePrivateFile(environment.WALLET_FILE, typeof raw === 'string' ? raw : String(raw));
      environment.loadWallet();
      if (opts.password) {
        try {
          environment.unlockWallet(opts.password);
        } catch (exception) {
          return {
            ok: false,
            locked: true,
            walletId: environment.walletPublic && environment.walletPublic.id,
            snapshot: snapshotEnvironment(environment),
            error: exception.message
          };
        }
      }
      return {
        ok: true,
        locked: !!environment.walletLocked,
        walletId: (environment.wallet && environment.wallet.id) ||
          (environment.walletPublic && environment.walletPublic.id),
        snapshot: snapshotEnvironment(environment)
      };
    }

    const wallet = walletFromBackupObject(pr.value, opts.passphrase || '');
    const encrypt = opts.encrypt !== false;
    const password = opts.password != null ? String(opts.password) : '';
    if (encrypt && password.length < PASSWORD_MIN_LENGTH) {
      return {
        ok: false,
        error: `Encryption password must be at least ${PASSWORD_MIN_LENGTH} characters (use --password).`
      };
    }
    environment.setWallet(wallet, true, {
      password,
      encrypt
    });
    try {
      fs.chmodSync(environment.WALLET_FILE, WALLET_FILE_MODE);
    } catch (_) { /* best-effort */ }
    wallet.start();
    environment.wallet = wallet;
    return {
      ok: true,
      walletId: wallet.id,
      snapshot: snapshotEnvironment(environment)
    };
  } catch (exception) {
    return { ok: false, error: exception.message || String(exception) };
  }
}

/**
 * @param {Environment} environment
 * @param {string} phrase
 * @param {Object} [opts]
 * @param {boolean} [opts.force]
 * @param {string} [opts.passphrase] BIP39 passphrase.
 * @param {string} [opts.password] Encryption password (required unless `encrypt` is false).
 * @param {boolean} [opts.encrypt=true]
 * @returns {{ ok: boolean, walletId?: string, snapshot?: object, error?: string }}
 */
function restoreWalletFromSeed (environment, phrase, opts = {}) {
  const force = !!opts.force;
  const encrypt = opts.encrypt !== false;
  const password = opts.password != null ? String(opts.password) : '';
  if ((environment.wallet || environment.walletExists()) && !force) {
    return { ok: false, error: 'Wallet already configured; pass force to overwrite.' };
  }
  if (encrypt && password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Encryption password must be at least ${PASSWORD_MIN_LENGTH} characters (use --password).`
    };
  }
  try {
    const wallet = walletFromPhrase(phrase, opts.passphrase || '');
    environment.setWallet(wallet, true, {
      password: opts.password || '',
      encrypt: opts.encrypt !== false
    });
    try {
      fs.chmodSync(environment.WALLET_FILE, WALLET_FILE_MODE);
    } catch (_) { /* best-effort */ }
    wallet.start();
    environment.wallet = wallet;
    return {
      ok: true,
      walletId: wallet.id,
      snapshot: snapshotEnvironment(environment)
    };
  } catch (exception) {
    return { ok: false, error: exception.message || String(exception) };
  }
}

/**
 * Launch the Blessed setup TUI when the operator is at an interactive terminal
 * and has not requested a one-shot flag.
 *
 * @param {Object} [opts] Commander options (command + globals).
 * @param {Object} [io]
 * @param {NodeJS.WriteStream} [io.stdout]
 * @returns {boolean}
 */
function shouldLaunchTui (opts = {}, io = {}) {
  if (opts.json) return false;
  if (opts.force) return false;
  if (opts.restore) return false;
  if (opts.unlock || opts.lock) return false;
  if (opts.timeout !== undefined && opts.timeout !== false) return false;
  if (opts.backup !== undefined && opts.backup !== false) return false;
  if (opts.noTui || opts.tui === false) return false;
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  if (process.env.FABRIC_SETUP_TUI === '0' || process.env.FABRIC_SETUP_TUI === 'false') return false;
  const stdout = io.stdout || process.stdout;
  return !!(stdout && stdout.isTTY);
}

/**
 * Print the historical toxic-waste banner plus the mnemonic.
 *
 * @param {string} phrase
 * @param {object} [extra]
 * @param {string} [extra.walletId]
 * @param {string} [extra.xpub]
 * @param {string} [extra.walletPath]
 */
function printGeneratedWallet (phrase, extra = {}) {
  console.warn('[FABRIC:CLI]', '---');
  console.warn('[FABRIC:CLI]', '[!!!]', 'WARNING!', 'TOXIC WASTE BELOW', '[!!!]');
  console.warn('[FABRIC:CLI]', '[!!!]', 'The seed phrase is PRIVATE KEY MATERIAL.');
  console.warn('[FABRIC:CLI]', '[!!!]', 'Anyone with it can spend funds and deanonymize history.');
  console.warn('[FABRIC:CLI]', '[!!!]', 'Write it down offline. DO NOT DISTRIBUTE.', '[!!!]');
  console.warn('[FABRIC:CLI]', '---');
  console.warn('[FABRIC:CLI]', `Your seed phrase:\n\n${phrase}\n`);
  if (extra.walletId) console.log('[FABRIC:CLI]', 'Wallet id:', extra.walletId);
  if (extra.xpub) console.log('[FABRIC:CLI]', 'XPUB (public):', extra.xpub);
  if (extra.walletPath) console.log('[FABRIC:CLI]', 'Saved to:', extra.walletPath);
  console.log('[FABRIC:CLI]', 'Next: run `fabric` to open the shell, or `fabric setup` to review this environment.');
}

/**
 * One-shot CLI (no TUI): inspect, backup, restore, or generate.
 *
 * @param {Environment} environment
 * @param {Object} [opts]
 * @returns {Promise<object>}
 */
async function runSetupCli (environment, opts = {}) {
  const applied = applyWalletFileOption(environment, opts.wallet);
  if (!applied.ok) {
    console.error('[FABRIC:CLI]', applied.error);
    process.exitCode = 1;
    return applied;
  }

  if (opts.json) {
    const snapshot = snapshotEnvironment(environment);
    console.log(JSON.stringify(snapshot, null, 2));
    return { ok: true, snapshot };
  }

  if (opts.backup !== undefined && opts.backup !== false) {
    const dest = (typeof opts.backup === 'string' && opts.backup.length)
      ? opts.backup
      : defaultBackupPath(environment);
    const result = backupWallet(environment, dest);
    if (!result.ok) {
      console.error('[FABRIC:CLI]', result.error);
      process.exitCode = 1;
      return result;
    }
    console.log('[FABRIC:CLI]', 'Backup written:', result.path);
    return result;
  }

  if (opts.unlock) {
    const password = opts.password || process.env.FABRIC_PASSWORD || '';
    try {
      environment.unlockWallet(password);
      console.log('[FABRIC:CLI]', 'Wallet unlocked.');
      console.log('[FABRIC:CLI]', formatSnapshot(snapshotEnvironment(environment)));
      return { ok: true, snapshot: snapshotEnvironment(environment) };
    } catch (exception) {
      console.error('[FABRIC:CLI]', exception.message || String(exception));
      process.exitCode = 1;
      return { ok: false, error: exception.message };
    }
  }

  if (opts.lock) {
    environment.lockWallet();
    console.log('[FABRIC:CLI]', 'Wallet locked.');
    return { ok: true, snapshot: snapshotEnvironment(environment) };
  }

  if (opts.timeout !== undefined && opts.timeout !== false) {
    const raw = opts.timeout === true ? '0' : String(opts.timeout).trim();
    if (!/^\d+$/.test(raw)) {
      console.error('[FABRIC:CLI]', 'Idle timeout must be a non-negative integer (minutes).');
      process.exitCode = 1;
      return { ok: false, error: 'Idle timeout must be a non-negative integer (minutes).' };
    }
    environment.setLockTimeoutMinutes(Number(raw));
    console.log('[FABRIC:CLI]', 'Lock timeout:', environment.lockSession.timeoutMinutes, 'min');
    return { ok: true, snapshot: snapshotEnvironment(environment) };
  }

  if (opts.restore) {
    const result = restoreWalletFromFile(environment, opts.restore, {
      force: !!opts.force,
      passphrase: opts.passphrase || '',
      password: opts.password || process.env.FABRIC_PASSWORD || ''
    });
    if (!result.ok) {
      console.error('[FABRIC:CLI]', result.error);
      process.exitCode = 1;
      return result;
    }
    console.log('[FABRIC:CLI]', 'Wallet restored. id:', result.walletId);
    console.log('[FABRIC:CLI]', formatSnapshot(result.snapshot));
    return result;
  }

  if ((environment.wallet || environment.walletExists()) && !opts.force) {
    console.warn('[FABRIC:CLI]', 'Wallet already configured; no data will be written. Use --force to override, or run `fabric setup` in a TTY to manage keys.');
    console.warn('[FABRIC:CLI]', '[WARNING]', '--force DESTROYS ALL DATA: DOUBLE-CHECK YOUR BACKUPS!');
    const snapshot = snapshotEnvironment(environment);
    console.log('[FABRIC:CLI]', '\n' + formatSnapshot(snapshot));
    return { ok: true, skipped: true, snapshot };
  }

  console.log('[FABRIC:CLI]', 'Generating a new seed…');
  const result = generateWallet(environment, {
    passphrase: opts.passphrase || '',
    password: opts.password || process.env.FABRIC_PASSWORD || '',
    force: !!opts.force
  });
  if (!result.ok) {
    console.error('[FABRIC:CLI]', result.error);
    process.exitCode = 1;
    return result;
  }

  printGeneratedWallet(result.seed, {
    walletId: result.walletId,
    xpub: result.snapshot && result.snapshot.xpub,
    walletPath: environment.WALLET_FILE
  });
  return result;
}

module.exports = {
  SETUP_PATH_MAX_LEN,
  SETUP_RESTORE_MAX_BYTES,
  WALLET_FILE_MODE,
  PASSWORD_MIN_LENGTH,
  applyWalletFileOption,
  backupWallet,
  debugEnabled,
  defaultBackupPath,
  formatSnapshot,
  generateWallet,
  printGeneratedWallet,
  readResolvedSetupFile,
  revealSecrets,
  resolveSetupPath,
  restoreWalletFromFile,
  restoreWalletFromSeed,
  runSetupCli,
  serializeWalletFile,
  shouldLaunchTui,
  snapshotEnvironment,
  walletFromBackupObject,
  walletFromPhrase,
  walletFromXprv,
  passwordsMatch
};
