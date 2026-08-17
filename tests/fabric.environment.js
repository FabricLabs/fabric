'use strict';

// Constants
const {
  FIXTURE_SEED,
  FIXTURE_XPUB,
  FIXTURE_XPRV
} = require('../constants');

// Dependencies
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fabric Types
const Environment = require('../types/environment');
const Wallet = require('../types/wallet');
const Key = require('../types/key');

const IDENTITY_ENV_KEYS = [
  'NODE_ENV',
  'FABRIC_SEED',
  'FABRIC_MNEMONIC',
  'FABRIC_XPRV',
  'FABRIC_XPUB',
  'FABRIC_PASSWORD',
  'FABRIC_HUB_ADMIN_TOKEN',
  'FABRIC_HUB_ADMIN_TOKEN_FILE'
];

function withIsolatedHome (prefix = 'fabric-env-') {
  const prev = {};
  for (const key of IDENTITY_ENV_KEYS) prev[key] = process.env[key];
  prev.HOME = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = path.join(home, '.fabric');
  const walletPath = path.join(store, 'wallet.json');
  process.env.HOME = home;
  return {
    home,
    store,
    walletPath,
    clearIdentityEnv () {
      delete process.env.FABRIC_SEED;
      delete process.env.FABRIC_MNEMONIC;
      delete process.env.FABRIC_XPRV;
      delete process.env.FABRIC_XPUB;
      delete process.env.FABRIC_PASSWORD;
      delete process.env.FABRIC_HUB_ADMIN_TOKEN;
      delete process.env.FABRIC_HUB_ADMIN_TOKEN_FILE;
    },
    leftoverWalletTemporaryFiles () {
      try {
        const base = path.basename(walletPath);
        return fs.readdirSync(store).filter((name) => {
          return name.startsWith(base + '.') && name.endsWith('.tmp');
        });
      } catch (error) {
        if (error && error.code === 'ENOENT') return [];
        throw error;
      }
    },
    restore () {
      for (const key of IDENTITY_ENV_KEYS) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
      if (prev.HOME === undefined) delete process.env.HOME;
      else process.env.HOME = prev.HOME;
      fs.rmSync(home, { recursive: true, force: true });
    }
  };
}

describe('@fabric/core/types/environment', function () {
  describe('Environment', function () {
    it('is a constructor', function () {
      assert.equal(Environment instanceof Function, true);
    });

    it('can start and stop smoothly', async function () {
      const iso = withIsolatedHome('fabric-env-start-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        await environment.start();
        await environment.stop();
        assert.ok(environment);
        assert.strictEqual(environment.wallet, false);
      } finally {
        iso.restore();
      }
    });

    it('wipes in-memory wallet keys on stop', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-stop-wipe-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        delete process.env.FABRIC_PASSWORD;
        process.env.NODE_ENV = 'test';
        const environment = new Environment({
          home,
          path: walletPath,
          store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        assert.ok(environment.wallet, 'fixture seed should load a wallet in test');
        assert.ok(environment.wallet.key);
        environment.stop();
        assert.strictEqual(environment.wallet, false);
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('ignores CWD .FABRIC_SEED unless allowCwdSeed is true', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        cwd: process.cwd()
      };
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-cwd-seed-'));
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        process.env.NODE_ENV = 'production';
        process.chdir(tmp);
        fs.writeFileSync(path.join(tmp, '.FABRIC_SEED'), FIXTURE_SEED + '\n', 'utf8');
        const denied = new Environment({
          home: path.join(tmp, 'home'),
          path: path.join(tmp, 'home', '.fabric', 'wallet.json'),
          store: path.join(tmp, 'home', '.fabric')
        });
        denied.local = denied.readSeedFile();
        assert.ok(denied.local, 'CWD seed file should be readable');
        assert.strictEqual(denied.seed, undefined, 'CWD seed must not become Environment.seed by default');

        const allowed = new Environment({
          home: path.join(tmp, 'home2'),
          path: path.join(tmp, 'home2', '.fabric', 'wallet.json'),
          store: path.join(tmp, 'home2', '.fabric'),
          allowCwdSeed: true
        });
        allowed.local = allowed.readSeedFile();
        assert.strictEqual(String(allowed.seed).trim(), FIXTURE_SEED);
      } finally {
        process.chdir(prev.cwd);
        for (const k of ['NODE_ENV', 'FABRIC_SEED', 'FABRIC_MNEMONIC', 'FABRIC_XPRV', 'FABRIC_XPUB']) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('does not treat the BIP39 fixture as the default seed when NODE_ENV is not test (fresh install)', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        process.env.NODE_ENV = 'production';
        const environment = new Environment({ home, path: walletPath, store });
        environment.start();
        assert.strictEqual(environment.wallet, false, 'in-memory wallet must not be created from the test fixture in production');
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('NODE_ENV=test fixture seed wins over a developer FABRIC_XPRV', function () {
      const { home, store, walletPath, restore, clearIdentityEnv } = withIsolatedHome('fabric-env-fixture-xprv-');
      try {
        clearIdentityEnv();
        process.env.NODE_ENV = 'test';
        const foreign = new Key();
        process.env.FABRIC_XPRV = foreign.xprv;
        const environment = new Environment({ home, path: walletPath, store });
        environment.start();
        assert.ok(environment.wallet, 'fixture seed should still load in test');
        const fixtureWallet = new Wallet({ key: { seed: FIXTURE_SEED } });
        assert.strictEqual(
          environment.wallet.key && environment.wallet.key.pubkey,
          fixtureWallet.key.pubkey,
          'mocha fixture identity must not be replaced by FABRIC_XPRV'
        );
        environment.stop();
      } finally {
        restore();
      }
    });

    it('does not emit fatal error events when wallet file is empty or invalid JSON', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };

      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        process.env.NODE_ENV = 'production';

        for (const content of ['', '{']) {
          const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-bad-wallet-'));
          const store = path.join(home, '.fabric');
          const walletPath = path.join(store, 'wallet.json');
          fs.mkdirSync(store, { recursive: true });
          fs.writeFileSync(walletPath, content, 'utf8');

          const environment = new Environment({ home, path: walletPath, store });
          let emittedError = null;
          environment.on('error', (err) => { emittedError = err; });

          environment.start();
          assert.strictEqual(emittedError, null, `unexpected error event for wallet content repr: ${JSON.stringify(content)}`);
          assert.strictEqual(environment.wallet, false);
          fs.rmSync(home, { recursive: true, force: true });
        }
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
      }
    });

    it('can instantiate from a seed', async function () {
      const iso = withIsolatedHome('fabric-env-seed-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          seed: FIXTURE_SEED,
          home: iso.home,
          path: iso.walletPath,
          store: iso.store
        });
        await environment.start();
        assert.ok(environment.wallet);
        assert.ok(environment.xprv);
        assert.match(String(environment.xprv), /^xprv/);
        await environment.stop();
      } finally {
        iso.restore();
      }
    });

    it('can instantiate from an xpub', async function () {
      const iso = withIsolatedHome('fabric-env-xpub-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          xpub: FIXTURE_XPUB,
          home: iso.home,
          path: iso.walletPath,
          store: iso.store
        });
        await environment.start();
        assert.ok(environment.xpub);
        await environment.stop();
      } finally {
        iso.restore();
      }
    });

    it('classifies an xprv in settings.seed as the wallet xprv', async function () {
      const iso = withIsolatedHome('fabric-env-seed-xprv-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          seed: FIXTURE_XPRV,
          home: iso.home,
          path: iso.walletPath,
          store: iso.store
        });
        environment.loadWallet();
        assert.strictEqual(environment.wallet.key.xprv, FIXTURE_XPRV);
      } finally {
        iso.restore();
      }
    });

    it('can instantiate from an xprv', async function () {
      const environment = new Environment({ xprv: FIXTURE_XPRV });
      await environment.start();
      await environment.stop();
      assert.ok(environment);
      assert.strictEqual(environment.xprv, FIXTURE_XPRV);
      // assert.strictEqual(environment.xub, FIXTURE_XPUB);
    });

    it('xprv/xpub getters are safe before wallet load', function () {
      const environment = new Environment();
      environment.wallet = null;
      assert.doesNotThrow(() => environment.xprv);
      assert.doesNotThrow(() => environment.xpub);
    });

    it('can read an environment variable', async function () {
      const environment = new Environment();
      const home = environment.readVariable('HOME');
      assert.ok(home);
    });

    it('can verify', async function () {
      const environment = new Environment();
      const verified = environment.verify();
      assert.ok(verified);
    });

    it('can save a valid wallet', async function () {
      const iso = withIsolatedHome('fabric-env-save-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        const wallet = new Wallet({ key: { seed: FIXTURE_SEED } });
        environment.setWallet(wallet, false, { password: 'test-pass-ok!' });
        assert.ok(fs.existsSync(iso.walletPath));
        const doc = JSON.parse(fs.readFileSync(iso.walletPath, 'utf8'));
        assert.strictEqual(doc.passwordProtected, true);
        environment.destroyWallet();
        assert.strictEqual(fs.existsSync(iso.walletPath), false);
      } finally {
        iso.restore();
      }
    });

    it('can check for store', async function () {
      const iso = withIsolatedHome('fabric-env-store-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store
        });
        assert.strictEqual(environment.storeExists(), false);
        environment.makeStore();
        assert.strictEqual(environment.storeExists(), true);
      } finally {
        iso.restore();
      }
    });

    it('can check for wallet', async function () {
      const iso = withIsolatedHome('fabric-env-exists-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        assert.strictEqual(environment.walletExists(), false);
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), false, { password: 'test-pass-ok!' });
        assert.strictEqual(environment.walletExists(), true);
      } finally {
        iso.restore();
      }
    });

    it('can touch the wallet', async function () {
      const iso = withIsolatedHome('fabric-env-touch-ok-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store
        });
        assert.strictEqual(environment.touchWallet(), true);
        assert.ok(fs.existsSync(iso.walletPath));
        assert.strictEqual(fs.statSync(iso.walletPath).size, 0);
      } finally {
        iso.restore();
      }
    });

    it('can load the wallet', async function () {
      const iso = withIsolatedHome('fabric-env-load-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), false, { password: 'test-pass-ok!' });
        environment.lockWallet();
        environment.loadWallet({ fromFile: true, password: 'test-pass-ok!' });
        assert.ok(environment.wallet && environment.wallet.key);
      } finally {
        iso.restore();
      }
    });

    it('loadWallet({ fromFile: true }) ignores leftover FABRIC_SEED and FABRIC_XPRV (PR #185)', function () {
      const iso = withIsolatedHome('fabric-env-fromfile-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        fs.mkdirSync(iso.store, { recursive: true });
        const writer = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        writer.start();
        const wallet = new Wallet({ key: { seed: FIXTURE_SEED } });
        writer.setWallet(wallet, false, { encrypt: false });
        const fileXprv = writer.wallet.key.xprv;
        writer.stop();

        const leftover = new Key({ mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow' });
        process.env.FABRIC_SEED = leftover.seed;
        process.env.FABRIC_XPRV = leftover.xprv;
        const reader = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        reader.start();
        reader.loadWallet({ fromFile: true });
        assert.ok(reader.wallet && reader.wallet.key);
        assert.strictEqual(reader.wallet.key.xprv, fileXprv);
        assert.notStrictEqual(reader.wallet.key.xprv, leftover.xprv);
        reader.stop();
      } finally {
        iso.restore();
      }
    });

    it('can read the wallet', async function () {
      const iso = withIsolatedHome('fabric-env-read-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), false, { password: 'test-pass-ok!' });
        const raw = environment.readWallet();
        assert.ok(typeof raw === 'string' && raw.includes('seal'));
        assert.ok(!raw.includes(FIXTURE_SEED));
      } finally {
        iso.restore();
      }
    });

    it('can read contracts', async function () {
      const environment = new Environment();
      environment.readContracts();
      assert.ok(environment);
    });

    it('defaults new wallets to a password-sealed JSON store', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-seal-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      const password = 'test-pass-ok!';
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        delete process.env.FABRIC_PASSWORD;
        process.env.NODE_ENV = 'production';

        const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        environment.start();
        const wallet = new Wallet({ key: { seed: FIXTURE_SEED } });
        environment.setWallet(wallet, true, { password });

        const raw = fs.readFileSync(walletPath, 'utf8');
        const doc = JSON.parse(raw);
        assert.strictEqual(doc.passwordProtected, true);
        assert.strictEqual(doc.format, 'aes-256-gcm-pbkdf2-sha256');
        assert.ok(doc.seal && doc.seal.ciphertext);
        assert.ok(doc.object && doc.object.xpub);
        assert.ok(doc.walletVersion != null);
        assert.ok(!JSON.stringify(doc.object).includes('xprv'));
        assert.ok(!raw.includes(FIXTURE_SEED));

        environment.lockWallet();
        assert.strictEqual(environment.wallet, false);
        assert.strictEqual(environment.walletLocked, true);

        const reloaded = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        reloaded.start();
        assert.strictEqual(reloaded.wallet, false);
        assert.strictEqual(reloaded.walletLocked, true);
        reloaded.unlockWallet(password);
        assert.ok(reloaded.wallet && reloaded.wallet.key);
        assert.strictEqual(reloaded.wallet.version, doc.walletVersion);
        assert.ok(String(reloaded.wallet.key.seed || '').includes(FIXTURE_SEED.split(' ')[0]));
        reloaded.lockWallet();
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('preserves external lock listeners across unlock', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-lock-l-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        delete process.env.FABRIC_PASSWORD;
        process.env.NODE_ENV = 'production';
        const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        environment.start();
        const wallet = new Wallet({ key: { seed: FIXTURE_SEED } });
        environment.setWallet(wallet, true, { password: 'test-pass-ok!' });
        let external = 0;
        environment.lockSession.on('lock', () => { external += 1; });
        environment.lockWallet();
        environment.unlockWallet('test-pass-ok!');
        environment.lockWallet();
        assert.ok(external >= 2);
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('touchWallet does not truncate an existing sealed wallet when utimes fails', function () {
      const isolated = withIsolatedHome('fabric-env-touch-');
      const origUtimes = fs.utimesSync;
      try {
        isolated.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: isolated.home,
          path: isolated.walletPath,
          store: isolated.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password: 'test-pass-ok!' });
        const before = fs.readFileSync(isolated.walletPath, 'utf8');
        assert.ok(before.includes('seal'));
        fs.utimesSync = () => { throw new Error('EPERM'); };
        environment.touchWallet();
        assert.strictEqual(fs.readFileSync(isolated.walletPath, 'utf8'), before);
        assert.deepStrictEqual(isolated.leftoverWalletTemporaryFiles(), []);
      } finally {
        fs.utimesSync = origUtimes;
        isolated.restore();
      }
    });

    it('cleans up the tmp wallet file when rename fails and keeps the existing seal', function () {
      const isolated = withIsolatedHome('fabric-env-rename-');
      const origRename = fs.renameSync;
      try {
        isolated.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: isolated.home,
          path: isolated.walletPath,
          store: isolated.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password: 'test-pass-ok!' });
        const before = fs.readFileSync(isolated.walletPath, 'utf8');
        fs.renameSync = () => { throw new Error('EXDEV'); };
        assert.throws(
          () => environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password: 'test-pass-ok!' }),
          /EXDEV/
        );
        assert.deepStrictEqual(isolated.leftoverWalletTemporaryFiles(), []);
        assert.strictEqual(fs.readFileSync(isolated.walletPath, 'utf8'), before);
      } finally {
        fs.renameSync = origRename;
        isolated.restore();
      }
    });

    it('clamps persisted lockTimeoutMinutes on load', function () {
      const { MAX_LOCK_TIMEOUT_MINUTES, DEFAULT_LOCK_TIMEOUT_MINUTES } = require('../functions/identityLock');
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-clamp-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        delete process.env.FABRIC_PASSWORD;
        process.env.NODE_ENV = 'production';
        const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password: 'test-pass-ok!' });
        const huge = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        huge.lockTimeoutMinutes = 99999;
        fs.writeFileSync(walletPath, JSON.stringify(huge, null, '  ') + '\n');
        const reloaded = new Environment({ home, path: walletPath, store });
        reloaded.start();
        assert.strictEqual(reloaded.lockSession.timeoutMinutes, MAX_LOCK_TIMEOUT_MINUTES);

        huge.lockTimeoutMinutes = 'nope';
        fs.writeFileSync(walletPath, JSON.stringify(huge, null, '  ') + '\n');
        const again = new Environment({ home, path: walletPath, store });
        again.start();
        assert.strictEqual(again.lockSession.timeoutMinutes, DEFAULT_LOCK_TIMEOUT_MINUTES);
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('throws a password-policy error instead of exiting when encrypting without a password', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-policy-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        process.env.NODE_ENV = 'production';
        const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        environment.start();
        const wallet = new Wallet({ key: { seed: FIXTURE_SEED } });
        assert.throws(
          () => environment.setWallet(wallet, true, { password: 'short' }),
          (err) => err && err.code === 'FABRIC_PASSWORD_POLICY'
        );
        assert.strictEqual(fs.existsSync(walletPath), false);
        assert.ok(!environment.wallet);
        environment.setWallet(wallet, false, { password: 'test-pass-ok!' });
        assert.strictEqual(fs.existsSync(walletPath), true);
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('rethrows wallet write errors instead of exiting the process', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-write-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        process.env.NODE_ENV = 'production';
        const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        environment.start();
        const wallet = new Wallet({ key: { seed: FIXTURE_SEED } });
        environment._writeWalletDocument = function () {
          const err = new Error('ENOSPC');
          err.code = 'ENOSPC';
          throw err;
        };
        assert.throws(
          () => environment.setWallet(wallet, true, { password: 'test-pass-ok!' }),
          (err) => err && err.code === 'ENOSPC'
        );
        assert.strictEqual(fs.existsSync(walletPath), false);
        assert.ok(!environment.wallet);
        delete environment._writeWalletDocument;
        environment.setWallet(wallet, false, { password: 'test-pass-ok!' });
        assert.strictEqual(fs.existsSync(walletPath), true);
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('wallet writes survive chmodSync failures on the temporary file', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-chmod-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      const originalChmod = fs.chmodSync;
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        process.env.NODE_ENV = 'production';
        const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        environment.start();
        fs.chmodSync = function (target) {
          if (String(target).includes('.tmp')) {
            const err = new Error('EPERM');
            err.code = 'EPERM';
            throw err;
          }
          return originalChmod.apply(fs, arguments);
        };
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), false, { password: 'test-pass-ok!' });
        assert.strictEqual(fs.existsSync(walletPath), true);
      } finally {
        fs.chmodSync = originalChmod;
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('does not auto-unlock from a generic PASSWORD environment variable', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD,
        PASSWORD: process.env.PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-pwd-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      const password = 'test-pass-ok!';
      try {
        delete process.env.FABRIC_SEED;
        delete process.env.FABRIC_MNEMONIC;
        delete process.env.FABRIC_XPRV;
        delete process.env.FABRIC_XPUB;
        delete process.env.FABRIC_PASSWORD;
        process.env.NODE_ENV = 'production';
        const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password });
        environment.lockWallet();
        process.env.PASSWORD = password;
        const reloaded = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
        reloaded.start();
        assert.strictEqual(reloaded.wallet, false);
        assert.strictEqual(reloaded.walletLocked, true);
      } finally {
        for (const k of Object.keys(prev)) {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        }
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('auto-unlocks a sealed wallet from FABRIC_PASSWORD', function () {
      const iso = withIsolatedHome('fabric-env-fabpass-');
      const password = 'test-pass-ok!';
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password });
        environment.lockWallet();
        process.env.FABRIC_PASSWORD = password;
        const reloaded = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        reloaded.start();
        assert.ok(reloaded.wallet && reloaded.wallet.key);
        assert.strictEqual(reloaded.walletLocked, false);
        reloaded.lockWallet();
      } finally {
        iso.restore();
      }
    });

    it('encryptWallet seals a loaded plaintext file', function () {
      const iso = withIsolatedHome('fabric-env-encrypt-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { encrypt: false });
        assert.strictEqual(JSON.parse(fs.readFileSync(iso.walletPath, 'utf8')).passwordProtected, false);
        environment.encryptWallet('test-pass-ok!');
        const doc = JSON.parse(fs.readFileSync(iso.walletPath, 'utf8'));
        assert.strictEqual(doc.passwordProtected, true);
        assert.ok(doc.seal && doc.seal.ciphertext);
        assert.ok(!JSON.stringify(doc.object).includes('xprv'));
        environment.lockWallet();
        environment.unlockWallet('test-pass-ok!');
        assert.ok(environment.wallet && environment.wallet.key);
      } finally {
        iso.restore();
      }
    });

    it('rejects plaintext unlock and a wrong sealed password', function () {
      const iso = withIsolatedHome('fabric-env-badunlock-');
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { encrypt: false });
        assert.throws(() => environment.unlockWallet('test-pass-ok!'), /not password-protected/);
        environment.encryptWallet('test-pass-ok!');
        environment.lockWallet();
        assert.throws(
          () => environment.unlockWallet('wrong-pass-ok!'),
          (err) => err && err.code === 'FABRIC_SEAL_DECRYPT'
        );
        assert.strictEqual(environment.wallet, false);
        assert.strictEqual(environment.walletLocked, true);
      } finally {
        iso.restore();
      }
    });

    it('idle-locks an unlocked sealed wallet', function (done) {
      const iso = withIsolatedHome('fabric-env-idle-');
      let restored = false;
      const finish = (err) => {
        if (restored) return;
        restored = true;
        iso.restore();
        done(err);
      };
      try {
        iso.clearIdentityEnv();
        process.env.NODE_ENV = 'production';
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMs: 25
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password: 'test-pass-ok!' });
        environment.lockSession.once('lock', () => {
          try {
            assert.strictEqual(environment.wallet, false);
            assert.strictEqual(environment.walletLocked, true);
            finish();
          } catch (exception) {
            finish(exception);
          }
        });
      } catch (exception) {
        finish(exception);
      }
    });

    describe('bitcoin.conf helpers', function () {
      it('_parseConfigValue unwraps quotes and coerces primitives', function () {
        const e = new Environment();
        assert.strictEqual(e._parseConfigValue('"rpcuser"'), 'rpcuser');
        assert.strictEqual(e._parseConfigValue('8332'), 8332);
        assert.strictEqual(e._parseConfigValue('1.5'), 1.5);
        assert.strictEqual(e._parseConfigValue('true'), true);
        assert.strictEqual(e._parseConfigValue('false'), false);
        assert.strictEqual(e._parseConfigValue('0'), 0);
        assert.strictEqual(e._parseConfigValue('plain'), 'plain');
      });

      it('_defaultRPCPortForNetwork matches Bitcoin defaults', function () {
        const e = new Environment();
        assert.strictEqual(e._defaultRPCPortForNetwork('mainnet'), 8332);
        assert.strictEqual(e._defaultRPCPortForNetwork('regtest'), 18443);
        assert.strictEqual(e._defaultRPCPortForNetwork('testnet'), 18332);
        assert.strictEqual(e._defaultRPCPortForNetwork('testnet4'), 48332);
        assert.strictEqual(e._defaultRPCPortForNetwork('signet'), 38332);
      });

      it('_normalizeRPCHost strips trailing :port for IPv4', function () {
        const e = new Environment();
        assert.strictEqual(e._normalizeRPCHost(null), '127.0.0.1');
        assert.strictEqual(e._normalizeRPCHost(''), '127.0.0.1');
        assert.strictEqual(e._normalizeRPCHost('127.0.0.1:8332'), '127.0.0.1');
      });

      it('_extractRPCPort parses trailing port from host:port', function () {
        const e = new Environment();
        assert.strictEqual(e._extractRPCPort(null), null);
        assert.strictEqual(e._extractRPCPort('127.0.0.1'), null);
        assert.strictEqual(e._extractRPCPort('127.0.0.1:18443'), 18443);
      });

      it('_getChainSubdirectory maps network to datadir folder', function () {
        const e = new Environment();
        assert.strictEqual(e._getChainSubdirectory('mainnet'), '');
        assert.strictEqual(e._getChainSubdirectory('regtest'), 'regtest');
        assert.strictEqual(e._getChainSubdirectory('testnet4'), 'testnet4');
      });

      it('_readBitcoinConf parses regtest RPC, flags, and comments', function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-btc-conf-'));
        try {
          const confPath = path.join(dir, 'bitcoin.conf');
          fs.writeFileSync(confPath, [
            '# rpc',
            '; also comment',
            '',
            'regtest=1',
            'server=1',
            'rpcuser=testuser',
            'rpcpassword=secret',
            'txindex'
          ].join('\n'), 'utf8');
          const e = new Environment();
          const cfg = e._readBitcoinConf(confPath);
          assert.strictEqual(cfg.found, true);
          assert.strictEqual(cfg.network.active, 'regtest');
          assert.strictEqual(cfg.rpc.rpcport, 18443);
          assert.strictEqual(cfg.rpc.rpcuser, 'testuser');
          assert.strictEqual(cfg.rpc.rpcpassword, 'secret');
          assert.strictEqual(cfg.general.txindex, true);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it('_readBitcoinConf returns found false for a missing path', function () {
        const e = new Environment();
        const cfg = e._readBitcoinConf(path.join(os.tmpdir(), `missing-bitcoin-${Date.now()}.conf`));
        assert.strictEqual(cfg.found, false);
      });

      it('_toFabricSettings returns {} when conf was not found', function () {
        const e = new Environment();
        assert.deepStrictEqual(e._toFabricSettings({ found: false }), {});
      });

      it('bitcoinSettings reflects parsed bitcoinConfig', function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-btc-conf-'));
        try {
          const confPath = path.join(dir, 'bitcoin.conf');
          fs.writeFileSync(confPath, 'signet=1\nrpcuser=a\nrpcpassword=b\n', 'utf8');
          const e = new Environment();
          e.bitcoinConfig = e._readBitcoinConf(confPath);
          const s = e.bitcoinSettings;
          assert.strictEqual(s.network, 'signet');
          assert.strictEqual(s.rpcport, 38332);
          assert.strictEqual(s.username, 'a');
          assert.strictEqual(s.password, 'b');
          assert.ok(/http:\/\/127\.0\.0\.1:38332/.test(s.authority));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it('getBitcoinRPCCandidates honors explicit host and port in baseSettings', function () {
        const e = new Environment();
        const list = e.getBitcoinRPCCandidates({
          host: '10.0.0.2',
          rpcport: 7777,
          network: 'regtest'
        });
        assert.ok(list.some((c) => c.source === 'settings' && c.host === '10.0.0.2' && c.rpcport === 7777));
      });

      it('getBitcoinRPCCandidates includes bitcoin.conf source when bitcoinConfig is set', function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-btc-conf-'));
        try {
          const confPath = path.join(dir, 'bitcoin.conf');
          fs.writeFileSync(confPath, 'regtest=1\nrpcuser=u\nrpcpassword=p\n', 'utf8');
          const e = new Environment();
          e.bitcoinConfig = e._readBitcoinConf(confPath);
          const list = e.getBitcoinRPCCandidates({});
          assert.ok(list.some((c) => c.source === 'bitcoin.conf'));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it('_readAuthCookie reads username:password from .cookie', function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-btc-cookie-'));
        try {
          const reg = path.join(dir, 'regtest');
          fs.mkdirSync(reg, { recursive: true });
          fs.writeFileSync(path.join(reg, '.cookie'), '__cookie__:deadbeef\n', 'utf8');
          const e = new Environment();
          const auth = e._readAuthCookie(dir, 'regtest');
          assert.ok(auth);
          assert.strictEqual(auth.username, '__cookie__');
          assert.strictEqual(auth.password, 'deadbeef');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it('_normalizeRPCHost strips port after bracketed IPv6', function () {
        const e = new Environment();
        assert.strictEqual(e._normalizeRPCHost('[::1]:8332'), '[::1]');
      });

      it('_extractRPCPort reads port after bracketed IPv6', function () {
        const e = new Environment();
        assert.strictEqual(e._extractRPCPort('[::1]:8332'), 8332);
      });

      it('_normalizeRPCHost leaves bare IPv6 literals intact (no false host:port)', function () {
        const e = new Environment();
        assert.strictEqual(e._normalizeRPCHost('::1'), '::1');
        assert.strictEqual(e._normalizeRPCHost('2001:db8::1'), '2001:db8::1');
      });

      it('_extractRPCPort does not parse port from bare IPv6', function () {
        const e = new Environment();
        assert.strictEqual(e._extractRPCPort('::1'), null);
        assert.strictEqual(e._extractRPCPort('2001:db8::1'), null);
      });

      it('_normalizeRPCHost keeps unterminated bracketed IPv6 prefix', function () {
        const e = new Environment();
        assert.strictEqual(e._normalizeRPCHost('[::1'), '[::1');
      });

      it('_extractRPCPort returns null for bracketed host without closing bracket', function () {
        const e = new Environment();
        assert.strictEqual(e._extractRPCPort('[::1:8332'), null);
      });
    });
  });
});

const bip39 = require('../functions/bip39');
const {
  parseRawSeedHex,
  classifyFabricKeyMaterial,
  keySettingsFromEnv,
  MIN_SEED_BYTES,
  MAX_SEED_BYTES
} = require('../functions/fabricKeyMaterial');

const SAMPLE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('@fabric/core/functions/fabricKeyMaterial', function () {
  it('parses raw BIP32 seed hex (optional 0x) within 16–64 bytes', function () {
    const hex = 'aa'.repeat(32);
    const a = parseRawSeedHex(hex);
    const b = parseRawSeedHex('0x' + hex);
    assert.ok(Buffer.isBuffer(a));
    assert.strictEqual(a.length, 32);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(parseRawSeedHex('aa'.repeat(MIN_SEED_BYTES - 1)), null);
    assert.strictEqual(parseRawSeedHex('aa'.repeat(MAX_SEED_BYTES + 1)), null);
    assert.strictEqual(parseRawSeedHex('not-hex'), null);
  });

  it('classifies xprv, seed hex, and mnemonic', function () {
    assert.strictEqual(classifyFabricKeyMaterial('xprv1example').kind, 'xprv');
    assert.strictEqual(classifyFabricKeyMaterial('aa'.repeat(32)).kind, 'seedHex');
    assert.strictEqual(classifyFabricKeyMaterial(SAMPLE_MNEMONIC).kind, 'mnemonic');
    assert.strictEqual(classifyFabricKeyMaterial('???').kind, 'unknown');
  });

  it('keySettingsFromEnv prefers FABRIC_XPRV then FABRIC_SEED then FABRIC_MNEMONIC', function () {
    const seedHex = bip39.mnemonicToSeedSync(SAMPLE_MNEMONIC).toString('hex');
    assert.deepStrictEqual(keySettingsFromEnv({
      FABRIC_XPRV: 'xprv1example',
      FABRIC_SEED: seedHex,
      FABRIC_MNEMONIC: SAMPLE_MNEMONIC
    }), { xprv: 'xprv1example' });
    assert.deepStrictEqual(keySettingsFromEnv({
      FABRIC_SEED: seedHex,
      FABRIC_MNEMONIC: SAMPLE_MNEMONIC
    }), { seed: seedHex });
    assert.deepStrictEqual(keySettingsFromEnv({
      FABRIC_MNEMONIC: SAMPLE_MNEMONIC
    }), { mnemonic: SAMPLE_MNEMONIC });
    assert.strictEqual(keySettingsFromEnv({}), null);
  });
});

const {
  parseDotEnvText,
  loadDotEnvFile,
  loadFabricHomeEnv,
  mintHubAdminToken,
  writeHubAdminToken,
  readHubAdminToken,
  upsertFabricHomeEnv,
  HOME_ENV_KEYS
} = require('../functions/fabricHomeEnv');

describe('@fabric/core/functions/fabricHomeEnv', function () {
  it('parses KEY=VALUE lines and ignores comments', function () {
    const parsed = parseDotEnvText([
      '# comment',
      'FABRIC_XPRV=xprv1example',
      "FABRIC_SEED='aabbcc'",
      'NOT A LINE',
      'FABRIC_MNEMONIC="one two three"'
    ].join('\n'));
    assert.strictEqual(parsed.FABRIC_XPRV, 'xprv1example');
    assert.strictEqual(parsed.FABRIC_SEED, 'aabbcc');
    assert.strictEqual(parsed.FABRIC_MNEMONIC, 'one two three');
  });

  it('fills missing env keys from ~/.fabric/env without overriding process env', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-home-env-'));
    try {
      upsertFabricHomeEnv({
        FABRIC_XPRV: 'xprv-from-file',
        FABRIC_SEED: 'aa'.repeat(32)
      }, { store: dir });
      const env = { FABRIC_XPRV: 'xprv-already-set' };
      const n = loadFabricHomeEnv(env, { store: dir });
      assert.ok(n >= 1);
      assert.strictEqual(env.FABRIC_XPRV, 'xprv-already-set');
      assert.strictEqual(env.FABRIC_SEED, 'aa'.repeat(32));
      assert.ok(HOME_ENV_KEYS.has('FABRIC_XPRV'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readHubAdminToken prefers env over a token file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-admin-token-'));
    try {
      const file = path.join(dir, 'hub-admin-token');
      fs.writeFileSync(file, 'file-token\n', { encoding: 'utf8', mode: 0o600 });
      const fromEnv = readHubAdminToken({ FABRIC_HUB_ADMIN_TOKEN: 'env-token' }, { store: dir });
      assert.strictEqual(fromEnv.token, 'env-token');
      assert.strictEqual(fromEnv.source, 'env');
      const fromFile = readHubAdminToken({}, { tokenPath: file, store: dir });
      assert.strictEqual(fromFile.token, 'file-token');
      assert.strictEqual(fromFile.source, 'adminTokenFile');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadDotEnvFile ignores keys outside the allow list', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-dotenv-allow-'));
    try {
      const file = path.join(dir, 'env');
      fs.writeFileSync(file, 'FABRIC_XPRV=ok\nSECRET_OTHER=nope\n');
      const env = {};
      loadDotEnvFile(file, env, { allowKeys: HOME_ENV_KEYS });
      assert.strictEqual(env.FABRIC_XPRV, 'ok');
      assert.strictEqual(env.SECRET_OTHER, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const {
  sealJson,
  openSealedJson,
  isSealedEnvelope,
  isPasswordProtectedDocument,
  SEAL_SCHEME,
  PASSWORD_MIN_LENGTH
} = require('../functions/sealedBlob');

describe('@fabric/core/functions/sealedBlob', function () {
  const password = 'test-pass-ok!';
  const secret = { seed: 'abandon abandon', xprv: 'xprv-test', note: 'keep me' };

  it('round-trips JSON through AES-256-GCM', function () {
    const envelope = sealJson(secret, password);
    assert.strictEqual(envelope.type, 'FabricSealedBlob');
    assert.strictEqual(envelope.encryption, SEAL_SCHEME);
    assert.ok(envelope.ciphertext);
    assert.ok(envelope.iv);
    assert.ok(envelope.kdf && envelope.kdf.salt);
    assert.strictEqual(envelope.kdf.iterations, 210000);
    const opened = openSealedJson(envelope, password);
    assert.deepStrictEqual(opened, secret);
  });

  it('opens a nested seal field (wallet document shape)', function () {
    const envelope = sealJson(secret, password);
    const document = {
      type: 'FabricWallet',
      format: SEAL_SCHEME,
      passwordProtected: true,
      object: { id: 'public', xpub: 'xpub1' },
      seal: envelope
    };
    assert.strictEqual(isPasswordProtectedDocument(document), true);
    assert.deepStrictEqual(openSealedJson(document, password), secret);
  });

  it('opens a Hub backup v2-shaped envelope (ciphertext + kdf + iv)', function () {
    const core = sealJson(secret, password);
    const hubShaped = {
      format: SEAL_SCHEME,
      kdf: core.kdf,
      iv: core.iv,
      ciphertext: core.ciphertext
    };
    assert.strictEqual(isSealedEnvelope(hubShaped), true);
    assert.deepStrictEqual(openSealedJson(hubShaped, password), secret);
  });

  it('rejects a short password and a wrong password', function () {
    assert.throws(() => sealJson(secret, 'short'), (err) => err.code === 'FABRIC_PASSWORD_POLICY');
    const envelope = sealJson(secret, password);
    assert.throws(() => openSealedJson(envelope, 'wrong-pass-ok!'), (err) => err.code === 'FABRIC_SEAL_DECRYPT');
  });

  it('does not treat plaintext wallets as sealed', function () {
    assert.strictEqual(PASSWORD_MIN_LENGTH, 8);
    assert.strictEqual(isPasswordProtectedDocument({
      type: 'FabricWallet',
      format: 'plaintext',
      object: { xprv: 'xprv1', seed: 'words' }
    }), false);
    assert.strictEqual(isSealedEnvelope({ object: { xprv: 'xprv1' } }), false);
  });
});

const Token = require('../types/token');
const { loadIdentityFromWalletFile } = require('../functions/fabricWalletIdentity');

describe('@fabric/core operator env (seed hex + home admin token)', function () {
  it('classifies xprv, raw seed hex, and mnemonic', function () {
    const key = new Key({ mnemonic: FIXTURE_SEED });
    const hex = bip39.mnemonicToSeedSync(FIXTURE_SEED).toString('hex');
    assert.strictEqual(classifyFabricKeyMaterial(key.xprv).kind, 'xprv');
    assert.strictEqual(classifyFabricKeyMaterial(hex).kind, 'seedHex');
    assert.strictEqual(classifyFabricKeyMaterial(FIXTURE_SEED).kind, 'mnemonic');
    assert.ok(parseRawSeedHex(hex));
    assert.strictEqual(parseRawSeedHex(FIXTURE_SEED), null);
  });

  it('keySettingsFromEnv prefers XPRV then SEED hex then MNEMONIC', function () {
    const key = new Key({ mnemonic: FIXTURE_SEED });
    const hex = bip39.mnemonicToSeedSync(FIXTURE_SEED).toString('hex');
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_XPRV: key.xprv, FABRIC_SEED: hex }), { xprv: key.xprv });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_SEED: hex }), { seed: hex });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_MNEMONIC: FIXTURE_SEED }), { mnemonic: FIXTURE_SEED });
    assert.strictEqual(keySettingsFromEnv({}), null);
  });

  it('loads identity from a plaintext wallet.json when env is empty', function () {
    const iso = withIsolatedHome('fabric-wallet-id-');
    try {
      iso.clearIdentityEnv();
      process.env.NODE_ENV = 'production';
      const environment = new Environment({
        home: iso.home,
        path: iso.walletPath,
        store: iso.store
      });
      environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { encrypt: false });
      const loaded = loadIdentityFromWalletFile({
        home: iso.home,
        store: iso.store,
        walletPath: iso.walletPath
      });
      assert.ok(loaded);
      assert.ok(loaded.xprv);
      const expected = new Key({ mnemonic: FIXTURE_SEED });
      assert.strictEqual(loaded.xprv, expected.xprv);
    } finally {
      iso.restore();
    }
  });

  it('loads identity from a sealed wallet.json with FABRIC_PASSWORD', function () {
    const iso = withIsolatedHome('fabric-wallet-seal-');
    try {
      iso.clearIdentityEnv();
      process.env.NODE_ENV = 'production';
      const password = 'correct-horse-battery';
      const environment = new Environment({
        home: iso.home,
        path: iso.walletPath,
        store: iso.store
      });
      environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password, encrypt: true });
      assert.strictEqual(loadIdentityFromWalletFile({
        home: iso.home,
        store: iso.store,
        walletPath: iso.walletPath
      }), null);
      const loaded = loadIdentityFromWalletFile({
        home: iso.home,
        store: iso.store,
        walletPath: iso.walletPath,
        password
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.xprv, new Key({ mnemonic: FIXTURE_SEED }).xprv);
    } finally {
      iso.restore();
    }
  });

  it('loads wallet.json even when FABRIC_SEED is invalid nonempty text', function () {
    const iso = withIsolatedHome('fabric-wallet-fromfile-');
    try {
      iso.clearIdentityEnv();
      process.env.NODE_ENV = 'test';
      process.env.FABRIC_SEED = 'not-a-seed-or-mnemonic';
      const environment = new Environment({
        home: iso.home,
        path: iso.walletPath,
        store: iso.store
      });
      environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { encrypt: false });
      const loaded = loadIdentityFromWalletFile({
        home: iso.home,
        store: iso.store,
        walletPath: iso.walletPath
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.xprv, new Key({ mnemonic: FIXTURE_SEED }).xprv);
    } finally {
      iso.restore();
    }
  });

  it('mints a Hub admin token and reads it from ~/.fabric/hub-admin-token', function () {
    const iso = withIsolatedHome('fabric-home-token-');
    try {
      iso.clearIdentityEnv();
      const key = new Key({ mnemonic: FIXTURE_SEED });
      const token = mintHubAdminToken(key);
      assert.ok(Token.verifySigned(token, key));
      const tokenPath = writeHubAdminToken(token, { home: iso.home, store: iso.store });
      const envPath = upsertFabricHomeEnv({
        FABRIC_HUB_ADMIN_TOKEN_FILE: tokenPath
      }, { home: iso.home, store: iso.store });
      assert.ok(fs.existsSync(envPath));
      const env = {};
      loadFabricHomeEnv(env, { home: iso.home, store: iso.store });
      const got = readHubAdminToken(env, { home: iso.home, store: iso.store });
      assert.strictEqual(got.token, token);
      assert.ok(got.source === 'adminTokenFile' || got.source === 'home');
    } finally {
      iso.restore();
    }
  });
});

const SetupTui = require('../types/setup');
const fabricSetup = require('../functions/fabricSetup');

const TEST_PASSWORD = 'test-pass-ok!';

function isolatedEnv () {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-setup-'));
  const store = path.join(home, '.fabric');
  const walletPath = path.join(store, 'wallet.json');
  const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
  environment.start();
  return { home, store, walletPath, environment };
}

function withEnv (overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe('@fabric/core/functions/fabricSetup', function () {
  this.timeout(20000);

  let prevNodeEnv;
  let prevSeed;
  let prevMnemonic;
  let prevXprv;
  let prevXpub;

  beforeEach(function () {
    prevNodeEnv = process.env.NODE_ENV;
    prevSeed = process.env.FABRIC_SEED;
    prevMnemonic = process.env.FABRIC_MNEMONIC;
    prevXprv = process.env.FABRIC_XPRV;
    prevXpub = process.env.FABRIC_XPUB;
    process.env.NODE_ENV = 'production';
    delete process.env.FABRIC_SEED;
    delete process.env.FABRIC_MNEMONIC;
    delete process.env.FABRIC_XPRV;
    delete process.env.FABRIC_XPUB;
  });

  afterEach(function () {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevSeed === undefined) delete process.env.FABRIC_SEED;
    else process.env.FABRIC_SEED = prevSeed;
    if (prevMnemonic === undefined) delete process.env.FABRIC_MNEMONIC;
    else process.env.FABRIC_MNEMONIC = prevMnemonic;
    if (prevXprv === undefined) delete process.env.FABRIC_XPRV;
    else process.env.FABRIC_XPRV = prevXprv;
    if (prevXpub === undefined) delete process.env.FABRIC_XPUB;
    else process.env.FABRIC_XPUB = prevXpub;
  });

  describe('resolveSetupPath', function () {
    it('rejects empty, null-byte, and oversize paths', function () {
      assert.strictEqual(fabricSetup.resolveSetupPath(''), null);
      assert.strictEqual(fabricSetup.resolveSetupPath('foo\0bar'), null);
      assert.strictEqual(fabricSetup.resolveSetupPath('x'.repeat(fabricSetup.SETUP_PATH_MAX_LEN + 1)), null);
    });

    it('resolves relative paths against cwd', function () {
      const cwd = os.tmpdir();
      const abs = fabricSetup.resolveSetupPath('wallet-backup.json', { cwd });
      assert.strictEqual(abs, path.normalize(path.join(cwd, 'wallet-backup.json')));
    });

    it('accepts absolute paths', function () {
      const abs = path.join(os.tmpdir(), 'fabric-usb', 'wallet.json');
      assert.strictEqual(fabricSetup.resolveSetupPath(abs), path.normalize(abs));
    });
  });

  describe('shouldLaunchTui', function () {
    const tty = { isTTY: true };

    it('is true on a TTY without one-shot flags', function () {
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: tty }), true);
      });
    });

    it('is false without a TTY', function () {
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: { isTTY: false } }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: {} }), false);
      });
    });

    it('is false for json, force, backup, restore, --no-tui, and CI', function () {
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({ json: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ force: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ backup: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ backup: '/tmp/w.json' }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ unlock: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ lock: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ timeout: '15' }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ noTui: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ tui: false }, { stdout: tty }), false);
      });
      withEnv({ CI: '1', FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: tty }), false);
      });
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: '0' }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: tty }), false);
      });
    });
  });

  describe('snapshot / generate / backup / restore', function () {
    it('snapshots a missing wallet without secrets', function () {
      const { home, environment } = isolatedEnv();
      try {
        const snapshot = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(snapshot.status, 'missing');
        assert.strictEqual(snapshot.walletLoaded, false);
        assert.strictEqual(snapshot.identity, null);
        const text = fabricSetup.formatSnapshot(snapshot);
        assert.ok(text.includes('missing'));
        assert.ok(!/xprv[A-Za-z0-9]{20,}/i.test(text), 'snapshot text must not contain an xprv payload');
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('generates, snapshots public fields, and refuses a second generate without force', function () {
      const { home, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { passphrase: '', password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        assert.ok(created.seed && created.seed.split(' ').length >= 12);
        assert.ok(environment.walletExists());

        const snapshot = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(snapshot.status, 'unlocked');
        assert.strictEqual(snapshot.passwordProtected, true);
        assert.ok(snapshot.identity && snapshot.identity.startsWith('id'));
        assert.ok(snapshot.pubkey);
        assert.ok(snapshot.xpub && snapshot.xpub.startsWith('xpub'));
        const text = fabricSetup.formatSnapshot(snapshot);
        assert.ok(!text.includes(created.seed));
        assert.ok(!/xprv[A-Za-z0-9]/i.test(text));

        const blocked = fabricSetup.generateWallet(environment);
        assert.strictEqual(blocked.ok, false);
        assert.ok(/already configured/i.test(blocked.error));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('backs up and restores a wallet file', function () {
      const { home, store, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        const identity = fabricSetup.snapshotEnvironment(environment).identity;
        const backupPath = path.join(store, 'backups', 'roundtrip.json');
        const backed = fabricSetup.backupWallet(environment, backupPath);
        assert.strictEqual(backed.ok, true);
        assert.ok(fs.existsSync(backupPath));

        environment.destroyWallet();
        environment.wallet = false;
        environment.walletLocked = false;
        environment.walletPublic = null;

        const restored = fabricSetup.restoreWalletFromFile(environment, backupPath, { password: TEST_PASSWORD });
        // file is gone so restore should succeed without force
        assert.strictEqual(restored.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).identity, identity);

        environment.destroyWallet();
        environment.wallet = false;
        environment.walletLocked = false;
        environment.walletPublic = null;
        const badPassword = fabricSetup.restoreWalletFromFile(environment, backupPath, {
          force: true,
          password: 'wrong-password-xx'
        });
        assert.strictEqual(badPassword.ok, false);
        assert.ok(badPassword.error);

        const again = fabricSetup.restoreWalletFromFile(environment, backupPath);
        assert.strictEqual(again.ok, false);

        const forced = fabricSetup.restoreWalletFromFile(environment, backupPath, { force: true, password: TEST_PASSWORD });
        assert.strictEqual(forced.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).identity, identity);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('restores from a seed phrase', function () {
      const { home, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        const phrase = created.seed;
        const identity = fabricSetup.snapshotEnvironment(environment).identity;

        environment.destroyWallet();
        environment.wallet = false;
        environment.walletLocked = false;
        environment.walletPublic = null;

        const restored = fabricSetup.restoreWalletFromSeed(environment, phrase, { password: TEST_PASSWORD });
        assert.strictEqual(restored.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).identity, identity);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('rejects plaintext restore when the encryption password is missing', function () {
      const { home, store, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { encrypt: false });
        assert.strictEqual(created.ok, true);
        const backupPath = path.join(store, 'backups', 'plaintext.json');
        const backed = fabricSetup.backupWallet(environment, backupPath);
        assert.strictEqual(backed.ok, true);

        environment.destroyWallet();
        environment.wallet = false;
        environment.walletLocked = false;
        environment.walletPublic = null;

        const missing = fabricSetup.restoreWalletFromFile(environment, backupPath);
        assert.strictEqual(missing.ok, false);
        assert.match(String(missing.error), /at least/i);
        assert.strictEqual(environment.walletExists(), false);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('does not print the master xprv even when FABRIC_DEBUG is set', function () {
      const warnings = [];
      const logs = [];
      const origWarn = console.warn;
      const origLog = console.log;
      console.warn = (...args) => warnings.push(args.join(' '));
      console.log = (...args) => logs.push(args.join(' '));
      try {
        withEnv({ FABRIC_DEBUG: '1' }, () => {
          fabricSetup.printGeneratedWallet('abandon ability able', {
            walletId: 'id1',
            xpub: 'xpubPUBLIC',
            xprv: 'xprvTESTSECRET'
          });
        });
      } finally {
        console.warn = origWarn;
        console.log = origLog;
      }
      const text = warnings.concat(logs).join('\n');
      assert.ok(!/xprvTESTSECRET/.test(text));
      assert.ok(/abandon ability able/.test(text));
    });

    it('rejects an invalid seed phrase', function () {
      const { home, environment } = isolatedEnv();
      try {
        const result = fabricSetup.restoreWalletFromSeed(environment, 'not a mnemonic at all');
        assert.strictEqual(result.ok, false);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('reveals seed only on demand', function () {
      const { home, environment } = isolatedEnv();
      try {
        assert.strictEqual(fabricSetup.revealSecrets(environment).ok, false);
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        const secrets = fabricSetup.revealSecrets(environment);
        assert.strictEqual(secrets.ok, true);
        assert.strictEqual(secrets.seed, created.seed);
        assert.ok(secrets.xprv && secrets.xprv.startsWith('xprv'));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('refuses generate without an encryption password', function () {
      const { home, environment } = isolatedEnv();
      try {
        const result = fabricSetup.generateWallet(environment);
        assert.strictEqual(result.ok, false);
        assert.ok(/password/i.test(result.error));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('locks, unlocks, and persists idle timeout', function () {
      const { home, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).status, 'unlocked');

        environment.lockWallet();
        const locked = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(locked.status, 'locked');
        assert.strictEqual(locked.passwordProtected, true);
        assert.ok(locked.xpub && locked.xpub.startsWith('xpub'));
        assert.strictEqual(fabricSetup.revealSecrets(environment).ok, false);

        environment.unlockWallet(TEST_PASSWORD);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).status, 'unlocked');
        assert.strictEqual(fabricSetup.revealSecrets(environment).seed, created.seed);

        environment.setLockTimeoutMinutes(15);
        const snap = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(snap.lockTimeoutMinutes, 15);
        const doc = JSON.parse(fs.readFileSync(environment.WALLET_FILE, 'utf8'));
        assert.strictEqual(doc.lockTimeoutMinutes, 15);
        assert.ok(doc.seal && doc.seal.ciphertext);
        assert.ok(!JSON.stringify(doc.object).includes('xprv'));
      } finally {
        environment.setLockTimeoutMinutes(0);
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('runSetupCli', function () {
    it('prints JSON snapshot for --json', async function () {
      const { home, environment } = isolatedEnv();
      const logs = [];
      const orig = console.log;
      console.log = function () { logs.push(Array.from(arguments).join(' ')); };
      try {
        const result = await fabricSetup.runSetupCli(environment, { json: true });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.snapshot.status, 'missing');
        const parsed = JSON.parse(logs.join('\n'));
        assert.strictEqual(parsed.status, 'missing');
        assert.ok(!parsed.seed);
        assert.ok(!parsed.xprv);
      } finally {
        console.log = orig;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('writes a backup via --backup', async function () {
      const { home, store, environment } = isolatedEnv();
      const origLog = console.log;
      console.log = function () {};
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        const dest = path.join(store, 'cli-backup.json');
        const result = await fabricSetup.runSetupCli(environment, { backup: dest });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.path, dest);
        assert.ok(fs.existsSync(dest));
      } finally {
        console.log = origLog;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('rejects a non-numeric --timeout', async function () {
      const { home, environment } = isolatedEnv();
      const origErr = console.error;
      console.error = function () {};
      try {
        const result = await fabricSetup.runSetupCli(environment, { timeout: 'abc' });
        assert.strictEqual(result.ok, false);
        assert.match(result.error, /integer/i);
      } finally {
        console.error = origErr;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('accepts integer --timeout including 0', async function () {
      const { home, environment } = isolatedEnv();
      const origLog = console.log;
      console.log = function () {};
      try {
        fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        const zero = await fabricSetup.runSetupCli(environment, { timeout: '0' });
        assert.strictEqual(zero.ok, true);
        assert.strictEqual(environment.lockSession.timeoutMinutes, 0);
        const fifteen = await fabricSetup.runSetupCli(environment, { timeout: 15 });
        assert.strictEqual(fifteen.ok, true);
        assert.strictEqual(environment.lockSession.timeoutMinutes, 15);
      } finally {
        console.log = origLog;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('applyWalletFileOption', function () {
    it('fails closed on an invalid path', function () {
      const { home, environment } = isolatedEnv();
      try {
        const result = fabricSetup.applyWalletFileOption(environment, 'bad\0path.json');
        assert.strictEqual(result.ok, false);
        assert.match(result.error, /Invalid --wallet path/i);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });
});

describe('@fabric/core/types/setup', function () {
  this.timeout(20000);

  it('returns a public snapshot when render is false', async function () {
    const prev = {
      NODE_ENV: process.env.NODE_ENV,
      FABRIC_SEED: process.env.FABRIC_SEED,
      FABRIC_MNEMONIC: process.env.FABRIC_MNEMONIC,
      FABRIC_XPRV: process.env.FABRIC_XPRV,
      FABRIC_XPUB: process.env.FABRIC_XPUB
    };
    process.env.NODE_ENV = 'production';
    delete process.env.FABRIC_SEED;
    delete process.env.FABRIC_MNEMONIC;
    delete process.env.FABRIC_XPRV;
    delete process.env.FABRIC_XPUB;
    const { home, environment } = isolatedEnv();
    try {
      fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
      const ui = new SetupTui(environment, { render: false });
      const snapshot = await ui.start();
      assert.strictEqual(snapshot.status, 'unlocked');
      assert.ok(snapshot.identity && snapshot.identity.startsWith('id'));
      assert.ok(!snapshot.seed);
    } finally {
      for (const k of Object.keys(prev)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('compares encryption passwords in constant time', function () {
    assert.ok(fabricSetup.passwordsMatch('same-secret', 'same-secret'));
    assert.ok(!fabricSetup.passwordsMatch('same-secret', 'same-secreT'));
    assert.ok(!fabricSetup.passwordsMatch('short', 'longer-than-short'));
    assert.ok(!fabricSetup.passwordsMatch(null, 'x'));
    assert.ok(fabricSetup.passwordsMatch(null, null));
  });

  it('fails closed on an invalid --wallet path before opening the TUI', async function () {
    const { home, environment } = isolatedEnv();
    try {
      const ui = new SetupTui(environment, { render: false, walletFile: 'bad\0path.json' });
      await assert.rejects(() => ui.start(), /Invalid --wallet path/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
