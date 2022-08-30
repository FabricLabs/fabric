'use strict';

// Dependencies
const Environment = require('../types/environment');
const assert = require('assert');

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

    it('can read an environment variable', async function () {
      const environment = new Environment();
      const home = environment.readVariable('HOME');
      assert.ok(home);
    });

    it('can save a valid wallet', async function () {
      const environment = new Environment({
        path: `./stores/fabric-tests`
      });

      environment.setWallet({
        type: 'FabricWallet',
        format: 'aes-256-cbc',
        version: 1
      });

      assert.ok(home);
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
  });
});
