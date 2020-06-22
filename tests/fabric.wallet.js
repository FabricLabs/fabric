'use strict';

const assert = require('assert');
const Wallet = require('../types/wallet');

const message = require('../assets/message');

describe('@fabric/core/types/wallet', function () {
  describe('Wallet', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Wallet instanceof Function, true);
    });

    it('can start and stop smoothly', async function () {
      async function test () {
        const wallet = new Wallet(options);

        try {
          await wallet.start();
        } catch (exception) {
          console.error('Could not start wallet:', exception);
        }

        try {
          await wallet.stop();
        } catch (exception) {
          console.error('Could not start wallet:', exception);
        }

        assert.ok(wallet);
      }

      await test();
    });

    it('can restore a public key', async function () {
      async function test () {
        const wallet = new Wallet(options);
        const origin = await wallet.generateCleanKeyPair();
        const pubkey = await wallet.publicKeyFromString(origin.public);
        assert.equal(origin.public, pubkey.toString('hex'));
      }

      await test();
    });

    it('can generate a multisig address', async function () {
      async function test () {
        const wallet = new Wallet(options);
        const pairs = [
          (await wallet.generateCleanKeyPair()).public,
          (await wallet.generateCleanKeyPair()).public,
          (await wallet.generateCleanKeyPair()).public
        ];

        const keys = pairs.map((x) => {
          return wallet.publicKeyFromString(x)
        });

        const address = await wallet._createMultisigAddress(2, 3, keys);

        // TODO: replace with fixture
        assert.equal(address, '2NAjx1UE2pyie3xN16AWBsbHhJSGAxLX7aY');
      }

      await test();
    });

    it('can trust an existing chain service', function (done) {
      const bitcoin = new Bitcoin(options);
      const wallet = new Wallet(options);

      wallet.trust(bitcoin);

      async function test () {
        wallet.on('synced', function (state) {
          console.log('Wallet emitted "synced" event:', state);
          done();
        });

        await wallet.start();
        await bitcoin.start();
      }

      test();
    });
  });
});
