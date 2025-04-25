'use strict';

const {
  GENESIS_HASH,
  BLOCK_ONE,
  BLOCK_ONE_COINBASE,
  BLOCK_ONE_PRIVKEY,
  BLOCK_ONE_PRIVKEY_BASE58,
  REMOTE_FUNDING_PUBKEY,
  FUNDING_WITNESS_SCRIPT,
  FUNDING_INPUT_TXID,
  FUNDING_INPUT_INDEX,
  FUNDING_INPUT_SATOSHIS,
  FUNDING_INPUT_FUNDING_SATOSHIS,
  FUNDING_INPUT_WITNESS_SCRIPT,
  FUNDING_FEERATE_PER_KW,
  FUNDING_CHANGE_SATOSHIS,
  FUNDING_OUTPUT_INDEX,
  FUNDING_TX,
  FUNDING_TXID,
  LOCAL_FUNDING_PRIVKEY,
  LOCAL_FUNDING_PUBKEY,
  LOCAL_PRIVKEY,
  LOCALPUBKEY,
  LIGHTNING_TEST_HEADER,
  LIGHTNING_BMM_HEADER,
  LIGHTNING_SIDECHAIN_NUM,
  LIGHTNING_SIDEBLOCK_HASH,
  LIGHTNING_PARENT_SIDEBLOCK_HASH,
  REMOTEPUBKEY,
  LOCAL_DELAYEDPUBKEY,
  LOCAL_REVOCATION_PUBKEY
} = require('./fixtures/lightning');

// Testing
const assert = require('assert');

const Message = require('../types/message');
const Bitcoin = require('../services/bitcoin');
const Lightning = require('../services/lightning');

const config = require('../settings/test');
const handler = require('../functions/handleException');

describe('@fabric/core/services/lightning', function () {
  // Store node references for cleanup
  let bitcoinNode = null;
  let lightningNode = null;
  let bitcoin = null;
  let lightning = null;

  // Cleanup hook to ensure nodes are stopped
  afterEach(async function () {
    if (lightningNode) {
      try {
        lightningNode.kill();
        await new Promise(resolve => {
          lightningNode.on('close', () => resolve());
        });
      } catch (e) {
        console.error('Error stopping Lightning node:', e);
      }
      lightningNode = null;
    }

    if (bitcoinNode) {
      try {
        bitcoinNode.kill();
        await new Promise(resolve => {
          bitcoinNode.on('close', () => resolve());
        });
      } catch (e) {
        console.error('Error stopping Bitcoin node:', e);
      }
      bitcoinNode = null;
    }

    // Additional cleanup - remove test directories
    try {
      const fs = require('fs');
      const path = require('path');
      const testDirs = [
        './stores/bitcoin-regtest',
        './stores/lightning-regtest'
      ];

      for (const dir of testDirs) {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    } catch (e) {
      console.error('Error cleaning up test directories:', e);
    }
  });

  describe('Lightning', function () {
    xit('can create an instance', async function provenance () {
      let lightning = new Lightning({
        name: 'Test'
      });

      assert.ok(lightning);
    });

    xit('can create a message', async function provenance () {
      let lightning = new Lightning({
        name: 'Test'
      });

      let entropy = await lightning.machine.sip();
      let message = Message.fromVector(['Cycle', entropy.toString(8)]);
      let next = await lightning.machine.sip();
      let prediction = Message.fromVector(['Cycle', next.toString(8)]);

      assert.ok(lightning);
      assert.ok(message);
      assert.ok(prediction);
    });

    it('can create and start a local Lightning node', async function () {
      this.timeout(30000); // Increase timeout to 30 seconds

      try {
        // First create and start a Bitcoin node
        bitcoin = new Bitcoin({
          name: 'TestBitcoinNode',
          network: 'regtest',
          fullnode: true,
          debug: true
        });

        // Start the Bitcoin node
        bitcoinNode = await bitcoin.createLocalNode();
        assert.ok(bitcoinNode, 'Bitcoin node should be created');
        assert.ok(bitcoinNode.pid, 'Bitcoin node should have a process ID');

        // Wait for Bitcoin node to start
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Now create the Lightning node using Bitcoin node's configuration
        lightning = new Lightning({
          name: 'TestLightningNode',
          network: 'regtest',
          fullnode: true,
          debug: true,
          bitcoin: {
            datadir: bitcoin.settings.path,
            username: bitcoin.settings.username,
            password: bitcoin.settings.password,
            host: '127.0.0.1',
            port: bitcoin.settings.port
          }
        });

        // Create the Lightning node
        lightningNode = await lightning.createLocalNode();

        // Verify the Lightning node was created
        assert.ok(lightningNode, 'Lightning node should be created');
        assert.ok(lightningNode.pid, 'Lightning node should have a process ID');

        // Wait for Lightning node to start
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify the Lightning node is running
        assert.strictEqual(lightningNode.killed, false, 'Lightning node should be running');
      } catch (error) {
        console.error('Test failed:', error);
        throw error; // Re-throw to fail the test
      }
    });
  });
});
