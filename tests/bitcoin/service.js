'use strict';

const assert = require('assert');
const Bitcoin = require('../../services/bitcoin');
const Key = require('../../types/key');

describe('@fabric/core/services/bitcoin', function () {
  this.timeout(30000); // Increase timeout for integration tests

  let bitcoin;
  let key;

  before(async function () {
    // Initialize Bitcoin service first
    bitcoin = new Bitcoin({
      network: 'regtest',
      mode: 'fabric',
      port: 18444,
      rpcport: 18443,
      zmqport: 18445,
      managed: false,
      debug: false,
      username: 'bitcoinrpc',
      password: 'password',
      rpc: {
        host: 'localhost',
        port: 18443,
        username: 'bitcoinrpc',
        password: 'password'
      }
    });

    // Now create the key with the correct network configuration
    key = new Key({
      network: 'regtest',
      purpose: 44,
      account: 0,
      index: 0
    });

    // Set the key on the Bitcoin service
    bitcoin.settings.key = key;

    // Initialize RPC client
    const config = {
      host: 'localhost',
      port: 18443,
      timeout: 300000
    };

    const auth = `${bitcoin.settings.username}:${bitcoin.settings.password}`;
    config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };

    bitcoin.rpc = require('jayson/lib/client').http(config);
  });

  describe('Bitcoin', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Bitcoin instanceof Function, true);
    });

    it('can start and stop smoothly', async function () {
      await bitcoin.start();
      await bitcoin.stop();
      assert.ok(bitcoin);
      assert.equal(bitcoin.settings.network, 'regtest');
      assert.equal(bitcoin.settings.port, 18444);
      assert.equal(bitcoin.settings.rpcport, 18443);
    });

    it('can generate addresses', async function () {
      const address = await bitcoin.getUnusedAddress();
      assert.ok(address);
      assert.ok(bitcoin.validateAddress(address));
    });

    it('can validate an address', async function () {
      const address = await bitcoin.getUnusedAddress();
      const valid = bitcoin.validateAddress(address);
      assert.ok(valid);
    });

    xit('can generate blocks', async function () {
      const address = await bitcoin.getUnusedAddress();
      const blocks = await bitcoin.generateBlocks(1, address);
      assert.equal(blocks.length, 1);
    });

    it('can create a psbt', async function () {
      const address = await bitcoin.getUnusedAddress();
      const psbt = await bitcoin._buildPSBT({
        inputs: [],
        outputs: [{
          address: address,
          value: 10000
        }]
      });
      assert.ok(psbt);
    });

    it('can create PSBTs', async function () {
      const address = await bitcoin.getUnusedAddress();
      const psbt = await bitcoin._createTX({
        inputs: [],
        outputs: [{
          address: address,
          value: 10000
        }]
      });
      assert.ok(psbt);
    });
  });
});
