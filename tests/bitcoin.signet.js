'use strict';

const assert = require('assert');
const Bitcoin = require('../services/bitcoin');
const Key = require('../types/key');
const fs = require('fs');
const path = require('path');

const runSignet = !!process.env.FABRIC_E2E_SIGNET;
if (!runSignet) {
  console.log('[SKIP] Set FABRIC_E2E_SIGNET=1 to run signet network tests');
}

function signetSuite () {
  const defaults = {
    network: 'signet',
    mode: 'fabric',
    port: 38333,      // Signet default port
    rpcport: 38332,   // Signet RPC port
    zmqport: 28335,   // Custom ZMQ port for signet
    managed: true,
    debug: false,
    username: 'bitcoinrpc',
    password: 'password',
    datadir: './stores/bitcoin-signet-test'
  };

  const walletName = 'signet-test-wallet';
  let bitcoin;
  let key;
  let testAddress;

  function cleanupTestDirectory () {
    const testDir = path.resolve(defaults.datadir);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }

  async function initializeWallet () {
    try {
      // Try to load the wallet first
      await bitcoin._makeRPCRequest('loadwallet', [walletName]);
    } catch (error) {
      if (error.code === -18) { // Wallet not found
        // Create a new wallet
        await bitcoin._makeRPCRequest('createwallet', [walletName]);
      } else {
        throw error;
      }
    }

    // Generate a new address in the wallet
    const result = await bitcoin._makeRPCRequest('getnewaddress', ['test']);
    const address = result.result;

    // Store the address for later use
    testAddress = address;
  }

  async function waitForSync(minBlocks = 1000) {
    const maxAttempts = 60;
    let attempts = 0;
    while (attempts < maxAttempts) {
      const info = await bitcoin._makeRPCRequest('getblockchaininfo');
      if (info.blocks >= minBlocks) {
        return true;
      }
      if (bitcoin.settings.debug) {
        console.debug(`[FABRIC:BITCOIN] Waiting for sync... Current height: ${info.blocks}`);
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      attempts++;
    }
    throw new Error(`Failed to sync at least ${minBlocks} blocks after ${maxAttempts} attempts`);
  }

  before(async function () {
    // Clean up test directory before starting
    cleanupTestDirectory();

    // Create a key for signet network
    key = new Key({
      network: 'signet',
      purpose: 44,
      account: 0,
      index: 0
    });

    // Initialize Bitcoin service
    bitcoin = new Bitcoin(defaults);

    // Start the Bitcoin service
    await bitcoin.start();

    // Create and load wallet
    await initializeWallet();

    // Wait for initial sync
    await waitForSync(1000);
  });

  after(async function () {
    if (bitcoin) {
      await bitcoin.stop();
    }
    // Clean up test directory after tests
    cleanupTestDirectory();
  });

  describe('Network Assumptions', function () {
    it('should connect to signet network', async function () {
      const info = await bitcoin._makeRPCRequest('getblockchaininfo');
      assert.strictEqual(info.chain, 'signet', 'Should be connected to signet');
    });

    it('should have non-zero difficulty', async function () {
      const info = await bitcoin._makeRPCRequest('getblockchaininfo');
      assert.ok(info.difficulty > 0, 'Signet should have non-zero difficulty');
    });

    it('should have correct signet genesis block', async function () {
      const blockZero = await bitcoin._makeRPCRequest('getblockhash', [0]);
      assert.strictEqual(
        blockZero,
        '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
        'Should have correct signet genesis block hash'
      );
    });

    it('should generate correct address format', async function () {
      const address = await bitcoin._makeRPCRequest('getnewaddress', ['test', 'bech32']);
      assert.ok(
        address.startsWith('tb1'),
        'Signet addresses should start with tb1'
      );
    });

    it('should maintain separate UTXO set', async function () {
      const utxos = await bitcoin._makeRPCRequest('listunspent', [0, 9999999]);
      assert.ok(Array.isArray(utxos), 'UTXO set should be an array');
      // No assertions about UTXO content since we're starting fresh
    });
  });
}

if (runSignet) {
  describe('@fabric/core/bitcoin/signet', function () {
    this.timeout(300000);
    signetSuite();
  });
} else {
  describe.skip('@fabric/core/bitcoin/signet', function () {
    it('requires FABRIC_E2E_SIGNET=1 and bitcoind signet', function () { this.skip(); });
  });
}
