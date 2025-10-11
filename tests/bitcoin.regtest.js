'use strict';

const assert = require('assert');
const Bitcoin = require('../services/bitcoin');
const Key = require('../types/key');

describe('@fabric/core/bitcoin/regtest', function () {
  this.timeout(120000); // 2 minutes timeout for regtest operations

  const defaults = {
    network: 'regtest',
    mode: 'fabric',
    port: 18444,
    rpcport: 18443,
    zmqport: 18445,
    managed: true,
    debug: false,
    username: 'bitcoinrpc',
    password: 'password',
    datadir: './stores/bitcoin-regtest-test'
  };

  let bitcoin;
  let key;

  async function resetChain (chain) {
    const height = await chain._makeRPCRequest('getblockcount', []);
    if (height > 0) {
      const secondblock = await chain._makeRPCRequest('getblockhash', [1]);
      await chain._makeRPCRequest('invalidateblock', [secondblock]);
      const after = await chain._makeRPCRequest('getblockcount', []);
    }
  }

  before(async function () {
    // Initialize Bitcoin service
    bitcoin = new Bitcoin(defaults);

    // Create a key for regtest network
    key = new Key({
      network: 'regtest',
      purpose: 44,
      account: 0,
      index: 0
    });

    // Set the key on the Bitcoin service
    bitcoin.settings.key = { xpub: key.xpub };

    // Start bitcoin and reset chain
    await bitcoin.start();
    await resetChain(bitcoin);
    await bitcoin.stop();
  });

  afterEach(async function () {
    if (bitcoin) {
      try {
        await bitcoin.stop();
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
    }
  });

  describe('Network Assumptions', function () {
    it('should start with empty blockchain', async function () {
      await bitcoin.start();
      await resetChain(bitcoin);
      const height = await bitcoin._makeRPCRequest('getblockcount', []);
      assert.strictEqual(height, 0, 'New regtest chain should start at height 0');
    });

    it('should mine blocks with no difficulty', async function () {
      await bitcoin.start();
      await resetChain(bitcoin);
      const address = await bitcoin.getUnusedAddress();
      const blocks = await bitcoin._makeRPCRequest('generatetoaddress', [1, address]);
      assert.strictEqual(blocks.length, 1, 'Should successfully mine 1 block');
      
      const height = await bitcoin._makeRPCRequest('getblockcount', []);
      assert.strictEqual(height, 1, 'Chain height should be 1 after mining');
    });

    it('should receive block rewards immediately', async function () {
      await bitcoin.start();
      await resetChain(bitcoin);
      const address = await bitcoin.getUnusedAddress();
      await bitcoin._makeRPCRequest('generatetoaddress', [101, address]); // Mine 101 blocks to mature coinbase
      
      const balance = await bitcoin._makeRPCRequest('getbalance', []);
      assert.ok(balance > 0, 'Balance should be positive after mining');
      assert.strictEqual(balance, 50, 'First block reward should be 50 BTC');
    });

    it('should allow instant confirmation of transactions', async function () {
      await bitcoin.start();
      await resetChain(bitcoin);
      
      // Generate initial balance
      const minerAddress = await bitcoin.getUnusedAddress();
      await bitcoin._makeRPCRequest('generatetoaddress', [101, minerAddress]);
      
      // Create a transaction
      const recipientAddress = await bitcoin.getUnusedAddress();
      const txid = await bitcoin._makeRPCRequest('sendtoaddress', [recipientAddress, 1]);
      assert.ok(txid, 'Transaction should be created');
      
      // Mine one block to confirm
      await bitcoin._makeRPCRequest('generatetoaddress', [1, minerAddress]);
      
      // Check recipient balance
      await bitcoin._loadWallet();
      const recipientBalance = await bitcoin._makeRPCRequest('getreceivedbyaddress', [recipientAddress]);
      assert.strictEqual(recipientBalance, 1, 'Recipient should receive exactly 1 BTC');
    });

    it('should maintain separate UTXO set from other networks', async function () {
      await bitcoin.start();
      await resetChain(bitcoin);
      const address = await bitcoin.getUnusedAddress();
      
      // Generate some blocks
      await bitcoin._makeRPCRequest('generatetoaddress', [101, address]);
      
      // Verify UTXO set
      const utxos = await bitcoin._makeRPCRequest('listunspent', []);
      assert.ok(utxos.length > 0, 'Should have UTXOs after mining');
      
      // Verify all UTXOs are on regtest
      for (const utxo of utxos) {
        assert.ok(utxo.address.startsWith('bcrt1') || utxo.address.startsWith('2') || utxo.address.startsWith('m') || utxo.address.startsWith('n'), 
          'All UTXOs should use regtest address format');
      }
    });
  });
});
