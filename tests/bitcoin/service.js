'use strict';

// Dependencies
const assert = require('assert');

// Fabric Types
const Bitcoin = require('../../services/bitcoin');
const Key = require('../../types/key');

describe('@fabric/core/services/bitcoin', function () {
  this.timeout(120000);

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
    afterEach(async function() {
      // Ensure any local bitcoin instance is stopped
      if (this.currentTest.ctx.local) {
        try {
          await this.currentTest.ctx.local.stop();
        } catch (e) {
          console.warn('Cleanup error:', e);
        }
      }
    });

    it('is available from @fabric/core', function () {
      assert.equal(Bitcoin instanceof Function, true);
    });

    it('provides reasonable defaults', function () {
      const local = new Bitcoin();
      assert.equal(local.UAString, 'Fabric Core 0.1.0 (@fabric/core#v0.1.0-RC1)');
      assert.equal(local.supply, 0);
      assert.equal(local.network, 'mainnet');
      // assert.equal(local.addresses, []);
      assert.equal(local.balance, 0);
      assert.equal(local.height, 0);
      assert.equal(local.best, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
      // assert.equal(local.headers, []);
    });

    it('provides createRPCAuth method', function () {
      const auth = bitcoin.createRPCAuth({
        username: 'bitcoinrpc',
        password: 'password'
      });

      assert.ok(auth);
      assert.ok(auth.username);
      assert.ok(auth.password);
      assert.ok(auth.content);
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

    it('can manage a local bitcoind instance', async function () {
      const local = new Bitcoin({
        debug: false,
        listen: 0,
        network: 'regtest',
        managed: true,
        datadir: `${process.cwd()}/stores/bitcoin-regtest-${Date.now()}` // Unique directory
      });

      this.test.ctx.local = local;
      await local.start();
      await local.stop();
      assert.ok(local);
    });

    it('can generate regtest balances', async function () {
      const local = new Bitcoin({
        debug: false,
        listen: 0,
        network: 'regtest',
        managed: true,
        mode: 'rpc',
        datadir: `${process.cwd()}/stores/bitcoin-regtest-${Date.now()}` // Unique directory
      });

      this.test.ctx.local = local;

      await local.start();

      // Create a descriptor wallet
      const created = await local._makeRPCRequest('createwallet', [
        'testwallet',
        false, // disable private keys
        false, // blank
        null,  // passphrase
        true,  // avoid reuse
        true   // descriptor wallet
      ]);
      await local._makeRPCRequest('unloadwallet', ['testwallet']);

      const loaded = await local._makeRPCRequest('loadwallet', ['testwallet']);
      const address = await local._makeRPCRequest('getnewaddress', []);
      const generated = await local._makeRPCRequest('generatetoaddress', [101, address]);
      const wallet = await local._makeRPCRequest('getwalletinfo', []);
      const balance = await local._makeRPCRequest('getbalance', []);
      const blockchain = await local._makeRPCRequest('getblockchaininfo', []);

      await local.stop();

      assert.ok(local);
      assert.equal(local.supply, 5050);
      assert.ok(balance);
      assert.equal(balance, 50);
    });

    it('can create unsigned transactions', async function () {
      const local = new Bitcoin({
        debug: false,
        listen: 0,
        network: 'regtest',
        managed: true,
        mode: 'rpc',
        datadir: `${process.cwd()}/stores/bitcoin-regtest-${Date.now()}`
      });

      this.test.ctx.local = local;

      await local.start();
      // Create a descriptor wallet
      const created = await local._makeRPCRequest('createwallet', [
        'testwallet',
        false, // disable private keys
        false, // blank
        null,  // passphrase
        true,  // avoid reuse
        true   // descriptor wallet
      ]);
      await local._makeRPCRequest('unloadwallet', ['testwallet']);

      await local._makeRPCRequest('loadwallet', ['testwallet']);
      const address = await local._makeRPCRequest('getnewaddress', []);
      const generated = await local._makeRPCRequest('generatetoaddress', [101, address]);
      const wallet = await local._makeRPCRequest('getwalletinfo', []);
      const balance = await local._makeRPCRequest('getbalance', []);
      const blockchain = await local._makeRPCRequest('getblockchaininfo', []);
      const transaction = await local._makeRPCRequest('createrawtransaction', [[], { [address]: 1 }]);
      const decoded = await local._makeRPCRequest('decoderawtransaction', [transaction]);
      const signed = await local._makeRPCRequest('signrawtransactionwithwallet', [transaction]);
      // const broadcast = await local._makeRPCRequest('sendrawtransaction', [signed.hex]);
      const confirmation = await local._makeRPCRequest('generatetoaddress', [1, address]);
      await local._makeRPCRequest('unloadwallet', ['testwallet']);
      await local.stop();

      assert.ok(transaction);
      assert.strictEqual(transaction.length, 82);
    });

    it('can complete a payment', async function () {
      const local = new Bitcoin({
        debug: false,
        listen: 0,
        network: 'regtest',
        managed: true,
        mode: 'rpc',
        datadir: `${process.cwd()}/stores/bitcoin-regtest-${Date.now()}`
      });

      this.test.ctx.local = local;

      await local.start();

      // Create a descriptor wallet
      const wallet1 = await local._makeRPCRequest('createwallet', [
        'testwallet1',
        false, // disable private keys
        false, // blank
        null,  // passphrase
        true,  // avoid reuse
        true   // descriptor wallet
      ]);
      await local._makeRPCRequest('unloadwallet', ['testwallet1']);

      await local._makeRPCRequest('loadwallet', ['testwallet1']);
      const miner = await local._makeRPCRequest('getnewaddress', []);
      const generated = await local._makeRPCRequest('generatetoaddress', [101, miner]);
      await local._makeRPCRequest('unloadwallet', ['testwallet1']);

      // Send a payment from wallet1 to wallet2
      const wallet2 = await local._makeRPCRequest('createwallet', [
        'testwallet2',
        false, // disable private keys
        false, // blank
        null,  // passphrase
        true,  // avoid reuse
        true   // descriptor wallet
      ]);

      await local._makeRPCRequest('loadwallet', ['testwallet2']);
      const destination = await local._makeRPCRequest('getnewaddress', []);
      await local._makeRPCRequest('unloadwallet', ['testwallet2']);

      await local._makeRPCRequest('loadwallet', ['testwallet1']);
      const payment = await local._makeRPCRequest('sendtoaddress', [destination, 1]);
      const confirmation = await local._makeRPCRequest('generatetoaddress', [1, miner]);
      await local._makeRPCRequest('unloadwallet', ['testwallet1']);

      await local._makeRPCRequest('loadwallet', ['testwallet2']);
      const wallet = await local._makeRPCRequest('getwalletinfo', []);
      const balance = await local._makeRPCRequest('getbalance', []);
      await local._makeRPCRequest('unloadwallet', ['testwallet2']);

      await local.stop();

      assert.ok(local);
      assert.ok(balance);
      assert.equal(balance, 1);
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
