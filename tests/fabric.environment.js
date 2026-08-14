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
const { withIsolatedHome } = require('./helpers/isolatedHome');

describe('@fabric/core/types/environment', function () {
  describe('Environment', function () {
    it('is a constructor', function () {
      assert.equal(Environment instanceof Function, true);
    });

    it('can start and stop smoothly', async function () {
      const environment = new Environment();
      await environment.start();
      await environment.stop();
      assert.ok(environment);
    });

    it('wipes in-memory wallet keys on stop', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-stop-wipe-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
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
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        cwd: process.cwd()
      };
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-cwd-seed-'));
      try {
        delete process.env.FABRIC_SEED;
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
        for (const k of ['NODE_ENV', 'FABRIC_SEED', 'FABRIC_XPRV', 'FABRIC_XPUB']) {
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
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
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

    it('does not emit fatal error events when wallet file is empty or invalid JSON', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };

      try {
        delete process.env.FABRIC_SEED;
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
      const environment = new Environment({ seed: FIXTURE_SEED });
      await environment.start();
      await environment.stop();
      assert.ok(environment);
      // assert.strictEqual(environment.xprv, FIXTURE_XPRV);
      // assert.strictEqual(environment.xpub, FIXTURE_XPUB);
    });

    it('can instantiate from an xpub', async function () {
      const environment = new Environment({ xpub: FIXTURE_XPUB });
      await environment.start();
      await environment.stop();
      assert.ok(environment);
      // assert.strictEqual(environment.xprv, undefined);
      // assert.strictEqual(environment.xpub, FIXTURE_XPUB);
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
      const environment = new Environment({
        path: `./stores/test-wallet.json`
      });

      const wallet = new Wallet({
        type: 'FabricWallet',
        format: 'aes-256-cbc',
        version: 1
      });

      environment.setWallet(wallet, false, { encrypt: false });
      assert.ok(environment);
      environment.destroyWallet();
    });

    it('can check for store', async function () {
      const environment = new Environment();
      const exists = environment.storeExists();
      assert.ok(environment);
      assert.equal(typeof exists, 'boolean');
    });

    it('can check for wallet', async function () {
      const environment = new Environment();
      const exists = environment.walletExists();

      assert.ok(environment);
      assert.equal(typeof exists, 'boolean');
    });

    it('can touch the wallet', async function () {
      if (process.env.FABRIC_ALLOW_WALLET_TOUCH !== '1') {
        // Avoid failures in environments without permission to write to $HOME
        return;
      }

      const environment = new Environment();
      environment.touchWallet();
      assert.ok(environment);
    });

    it('can load the wallet', async function () {
      const environment = new Environment();
      environment.loadWallet();
      assert.ok(environment);
    });

    it('can read the wallet', async function () {
      const environment = new Environment();
      if (!environment.walletExists()) {
        // Wallet file only exists after `fabric setup`; skip in CI and fresh envs
        return;
      }
      environment.readWallet();
      assert.ok(environment);
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
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-lock-l-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
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
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB,
        FABRIC_PASSWORD: process.env.FABRIC_PASSWORD
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-clamp-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
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
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-policy-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
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
        FABRIC_XPRV: process.env.FABRIC_XPRV,
        FABRIC_XPUB: process.env.FABRIC_XPUB
      };
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-env-write-'));
      const store = path.join(home, '.fabric');
      const walletPath = path.join(store, 'wallet.json');
      try {
        delete process.env.FABRIC_SEED;
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

    it('does not auto-unlock from a generic PASSWORD environment variable', function () {
      const prev = {
        NODE_ENV: process.env.NODE_ENV,
        FABRIC_SEED: process.env.FABRIC_SEED,
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
