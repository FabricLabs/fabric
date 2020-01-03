'use strict';

const assert = require('assert');
const Wallet = require('../types/wallet');

const message = require('../assets/message');

describe('@fabric/core/types/wallet', function () {
  describe('Wallet', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Wallet instanceof Function, true);
    });

    it('can use _SET', async function () {
      let wallet = new Wallet();

      await wallet.start();
      await wallet._SET('sample', message['@data']);
      await wallet.stop();

      assert.ok(wallet);
    });

    xit('can store a string value', async function () {
      let wallet = new wallet();

      await wallet.start();
      let set = await wallet._SET('sample', message['@data']);
      let get = await wallet._GET('sample');
      await wallet.stop();

      assert.ok(wallet);
      assert.equal(typeof get, 'string');
    });
  });
});
