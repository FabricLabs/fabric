'use strict';

require('debug-trace')({ always: true });

const assert = require('assert');
const Wallet = require('../types/wallet');
const Bitcoin = require('../services/bitcoin');

const message = require('../assets/message');
const settings = require('../settings/test');
const options = Object.assign({}, settings, {
  network: 'regtest',
  // fullnode: true,
  verbosity: 5
});

describe('@fabric/core/types/wallet', function () {
  describe('Wallet', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Wallet instanceof Function, true);
    });

    it('can generate a multisig address', function () {
      async function test () {
        const wallet = new Wallet(options);
        const address = await wallet._createMultisigAddress(2, 3);
        console.log('address generated:', address);
      }

      test();
    });

    xit('can trust an existing chain service', function (done) {
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
