'use strict';

const assert = require('assert');
const Bitcoin = require('../../services/bitcoin');

const settings = require('../../settings/test');
const options = Object.assign({}, settings, {
  network: 'testnet',
  fullnode: false,
  mode: 'full',
  verbosity: 2
});

describe('@fabric/core/services/bitcoin', function () {
  describe('Bitcoin', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Bitcoin instanceof Function, true);
    });

    it('can start and stop smoothly', async function () {
      async function test () {
        const bitcoin = new Bitcoin(options);

        try {
          await bitcoin.start();
        } catch (exception) {
          console.error('Could not start bitcoin:', exception);
        }

        try {
          await bitcoin.stop();
        } catch (exception) {
          console.error('Could not start bitcoin:', exception);
        }

        assert.ok(bitcoin);
        // assert.equal(bitcoin.tip, '06226e46111a0b59caaf126043eb5bbf28c34f3a5e332a1fc7b2b73cf188910f');
      }

      await test();
    });

    it('can generate an address', async function () {
      async function test () {
        const bitcoin = new Bitcoin(options);
        const address = await bitcoin.getUnusedAddress();

        assert.ok(bitcoin);
        assert.ok(address);
        assert.strictEqual(address, '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
      }

      await test();
    });

    xit('can validate an address', async function () {
      async function test () {
        const bitcoin = new Bitcoin(options);
        const address = await bitcoin.getUnusedAddress();
        const valid = bitcoin.validateAddress(address);

        assert.ok(bitcoin);
        assert.ok(address);

        console.log('address:', address);
        assert.strictEqual(address, '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
        assert.ok(valid);
      }

      await test();
    });

    xit('can handle a spend request', async function () {
      async function test () {
        const bitcoin = new Bitcoin(options);

        try {
          await bitcoin.start();
        } catch (exception) {
          console.error('Could not start bitcoin:', exception);
        }

        const address = await bitcoin.getUnusedAddress();
        const request = { amount: 1, destination: address };
        const output = await bitcoin.processSpendMessage(request);

        try {
          await bitcoin.stop();
        } catch (exception) {
          console.error('Could not start bitcoin:', exception);
        }

        assert.ok(bitcoin);
        assert.ok(output);
      }

      await test();
    });

    xit('can generate a block', async function () {
      async function test () {
        const bitcoin = new Bitcoin(options);
        let block = null;

        try {
          await bitcoin.start();
        } catch (exception) {
          console.error('Could not start bitcoin:', exception);
        }

        try {
          block = await bitcoin.generateBlock();
        } catch (exception) {
          console.error('Could not generate block:', exception);
        }

        try {
          await bitcoin.stop();
        } catch (exception) {
          console.error('Could not start bitcoin:', exception);
        }

        assert.ok(bitcoin);
        assert.ok(block);

        assert.equal(bitcoin.tip, block.hash('hex'));
        assert.equal(bitcoin.height, 1);
      }

      try {
        await test();
      } catch (exception) {
        console.error('Exception in test:', exception);
      }
    });

    it('can create a psbt', async function () {
      async function test () {
        const bitcoin = new Bitcoin(options);
        const psbt = await bitcoin._buildPSBT();

        assert.ok(bitcoin);
        assert.ok(psbt);
      }

      await test();
    });
  });
});
