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
    });

    it('can instantiate from an xpub', async function () {
      const environment = new Environment({ xpub: FIXTURE_XPUB });
      await environment.start();
      await environment.stop()
      assert.ok(environment);
    });

    it('can instantiate from an xprv', async function () {
      const environment = new Environment({ xprv: FIXTURE_XPRV });
      await environment.start();
      await environment.stop()
      assert.ok(environment);
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
      const environment = new Environment();
      environment.touchWallet();
      assert.ok(environment);
    });

    it('can load the wallet', async function () {
      const environment = new Environment();
      environment.loadWallet();
      assert.ok(environment);
    });
  });
});
