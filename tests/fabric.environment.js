'use strict';

// Constants
const {
  FIXTURE_SEED,
  FIXTURE_XPUB,
  FIXTURE_XPRV
} = require('../constants');

// Dependencies
const assert = require('assert');

// Fabric Types
const Environment = require('../types/environment');
const Wallet = require('../types/wallet');

describe('@fabric/core/types/environment', function () {
  describe('Environment', function () {
    it('is a constructor', function () {
      assert.equal(Environment instanceof Function, true);
    });

    it('can start and stop smoothly', async function () {
      const environment = new Environment();
      await environment.start();
      await environment.stop()
      assert.ok(environment);
    });

    it('can instantiate from a seed', async function () {
      const environment = new Environment({ xpub: FIXTURE_SEED });
      await environment.start();
      await environment.stop()
      assert.ok(environment);
      // assert.strictEqual(environment.xprv, FIXTURE_XPRV);
      // assert.strictEqual(environment.xpub, FIXTURE_XPUB);
    });

    it('can instantiate from an xpub', async function () {
      const environment = new Environment({ xpub: FIXTURE_XPUB });
      await environment.start();
      await environment.stop()
      assert.ok(environment);
      // assert.strictEqual(environment.xprv, undefined);
      // assert.strictEqual(environment.xpub, FIXTURE_XPUB);
    });

    it('can instantiate from an xprv', async function () {
      const environment = new Environment({ xprv: FIXTURE_XPRV });
      await environment.start();
      await environment.stop()
      assert.ok(environment);
      assert.strictEqual(environment.xprv, FIXTURE_XPRV);
      // assert.strictEqual(environment.xub, FIXTURE_XPUB);
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

      environment.setWallet(wallet);
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
    });
  });
});
