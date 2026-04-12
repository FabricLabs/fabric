'use strict';

// Dependencies
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Fabric Types
const Key = require('../../types/key');
const Message = require('../../types/message');
const Hash256 = require('../../types/hash256');

describe('@fabric/core/types/sidechain', function () {
  this.timeout(60000); // 1 minute for the test

  // Sidechain state
  let sidechainMessages = [];
  let sidechainGenesisBlock;
  let monitoredAddresses = new Map();
  let taprootAddresses = new Map();

  /**
   * Create a Fabric message for sidechain genesis block
   */
  function createSidechainGenesisMessage (bitcoinGenesisHash, participants) {
    const genesisData = {
      type: 'SidechainGenesis',
      timestamp: Date.now(),
      bitcoinGenesisHash: bitcoinGenesisHash,
      participants: participants.map(p => ({
        nodeId: p.nodeId,
        publicKey: p.publicKey,
        lightningNodeId: p.lightningNodeId
      })),
      sidechainId: Hash256.digest(`sidechain-${bitcoinGenesisHash}-${Date.now()}`),
      version: '1.0.0'
    };

    return new Message({
      type: 'P2P_BASE_MESSAGE',
      data: JSON.stringify(genesisData)
    });
  }

  /**
   * Create a Fabric message for Bitcoin deposit observation
   */
  function createDepositObservationMessage (address, txid, amount, blockHeight) {
    const depositData = {
      type: 'BitcoinDeposit',
      timestamp: Date.now(),
      address: address,
      txid: txid,
      amount: amount,
      blockHeight: blockHeight,
      sidechainId: sidechainGenesisBlock?.data ? JSON.parse(sidechainGenesisBlock.data).sidechainId : null
    };

    return new Message({
      type: 'BitcoinTransaction',
      data: JSON.stringify(depositData)
    });
  }

  /**
   * Create a Fabric message for 2-of-2 taproot address creation
   */
  function createTaprootAddressMessage (peer1Key, peer2Key, address) {
    const taprootData = {
      type: 'TaprootAddress',
      timestamp: Date.now(),
      address: address,
      participants: [peer1Key.publicKey, peer2Key.publicKey],
      threshold: 2,
      sidechainId: sidechainGenesisBlock?.data ? JSON.parse(sidechainGenesisBlock.data).sidechainId : null
    };

    return new Message({
      type: 'P2P_BASE_MESSAGE',
      data: JSON.stringify(taprootData)
    });
  }

  /**
   * Store Fabric messages to a flat file in the standardized storage directory
   */
  function storeMessagesToFile (messages, filename) {
    const storageDir = path.resolve('./stores/sidechain-messages');

    // Ensure storage directory exists
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const filePath = path.join(storageDir, filename);

    // Convert messages to newline-delimited format
    const messageData = messages.map(msg => {
      const messageObj = {
        id: msg.id,
        type: msg.type,
        data: msg.data,
        author: msg.author,
        timestamp: Date.now()
      };
      return JSON.stringify(messageObj);
    }).join('\n');

    // Write to file
    fs.writeFileSync(filePath, messageData, 'utf8');

    console.debug(`[SIDECHAIN] Stored ${messages.length} messages to ${filePath}`);
    return filePath;
  }

  /**
   * Load messages from flat file for replay
   */
  function loadMessagesFromFile (filePath) {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');

    return lines.map(line => {
      try {
        const messageObj = JSON.parse(line);
        return new Message({
          type: messageObj.type,
          data: messageObj.data
        });
      } catch (error) {
        console.error(`[SIDECHAIN] Error parsing message: ${error}`);
        return null;
      }
    }).filter(msg => msg !== null);
  }

  before(async function () {
    // Clean up test directories
    try {
      const storageDir = path.resolve('./stores/sidechain-messages');
      if (fs.existsSync(storageDir)) {
        fs.rmSync(storageDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('[FABRIC:LIGHTNING]', 'Error during cleanup:', error);
    }
  });

  after(async function () {
    // Clean up test files
    try {
      const storageDir = path.resolve('./stores/sidechain-messages');
      if (fs.existsSync(storageDir)) {
        fs.rmSync(storageDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('[FABRIC:LIGHTNING]', 'Error during cleanup:', error);
    }
  });

  describe('Lightning Sidechain', function () {
    it('can establish sidechain genesis block with Bitcoin reference and store messages', async function () {
      this.timeout(60000); // 1 minute for the test

      // Create keys for participants
      const key1 = new Key({
        network: 'regtest',
        purpose: 44,
        account: 0,
        index: 0
      });

      const key2 = new Key({
        network: 'regtest',
        purpose: 44,
        account: 0,
        index: 1
      });

      const key3 = new Key({
        network: 'regtest',
        purpose: 44,
        account: 0,
        index: 2
      });

      // Get Bitcoin genesis block hash (regtest)
      const bitcoinGenesisHash = '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206';

      // Create sidechain genesis block message
      const participants = [
        {
          nodeId: 'node1',
          publicKey: key1.publicKey,
          lightningNodeId: 'lightning1'
        },
        {
          nodeId: 'node2',
          publicKey: key2.publicKey,
          lightningNodeId: 'lightning2'
        },
        {
          nodeId: 'node3',
          publicKey: key3.publicKey,
          lightningNodeId: 'lightning3'
        }
      ];

      sidechainGenesisBlock = createSidechainGenesisMessage(bitcoinGenesisHash, participants);
      sidechainGenesisBlock.signWithKey(key1);
      sidechainMessages.push(sidechainGenesisBlock);

      // Create monitored addresses for each participant
      const address1 = key1.deriveAddress(0, 0, 'p2pkh').address;
      const address2 = key2.deriveAddress(0, 0, 'p2pkh').address;
      const address3 = key3.deriveAddress(0, 0, 'p2pkh').address;

      monitoredAddresses.set('node1', address1);
      monitoredAddresses.set('node2', address2);
      monitoredAddresses.set('node3', address3);

      // Create 2-of-2 taproot addresses between peers
      const taproot1 = key1.deriveAddress(0, 0, 'p2tr');
      const taproot2 = key2.deriveAddress(0, 0, 'p2tr');

      taprootAddresses.set('node1-node2', taproot1.address);
      taprootAddresses.set('node2-node3', taproot2.address);

      // Create taproot address messages
      const taprootMsg1 = createTaprootAddressMessage(key1, key2, taproot1.address);
      taprootMsg1.signWithKey(key1);
      sidechainMessages.push(taprootMsg1);

      const taprootMsg2 = createTaprootAddressMessage(key2, key3, taproot2.address);
      taprootMsg2.signWithKey(key2);
      sidechainMessages.push(taprootMsg2);

      // Simulate Bitcoin deposits to monitored addresses
      const depositAmount1 = 0.001;
      const depositAmount2 = 0.002;
      const depositAmount3 = 0.0015;

      const depositTx1 = 'mock_tx_1_' + Hash256.digest(address1).substring(0, 16);
      const depositTx2 = 'mock_tx_2_' + Hash256.digest(address2).substring(0, 16);
      const depositTx3 = 'mock_tx_3_' + Hash256.digest(address3).substring(0, 16);

      const blockHeight = 100;

      // Create deposit observation messages
      const depositMsg1 = createDepositObservationMessage(address1, depositTx1, depositAmount1, blockHeight);
      depositMsg1.signWithKey(key1);
      sidechainMessages.push(depositMsg1);

      const depositMsg2 = createDepositObservationMessage(address2, depositTx2, depositAmount2, blockHeight);
      depositMsg2.signWithKey(key2);
      sidechainMessages.push(depositMsg2);

      const depositMsg3 = createDepositObservationMessage(address3, depositTx3, depositAmount3, blockHeight);
      depositMsg3.signWithKey(key3);
      sidechainMessages.push(depositMsg3);

      // Store all messages to flat file
      const messageFilePath = storeMessagesToFile(sidechainMessages, 'sidechain-genesis.jsonl');

      // Verify the file was created and contains messages
      assert.ok(fs.existsSync(messageFilePath), 'Message file should exist');

      const fileContent = fs.readFileSync(messageFilePath, 'utf8');
      const lines = fileContent.trim().split('\n');
      assert.equal(lines.length, sidechainMessages.length, 'File should contain all messages');

      // Verify each message can be parsed
      lines.forEach((line, index) => {
        const messageObj = JSON.parse(line);
        assert.ok(messageObj.id, `Message ${index} should have an ID`);
        assert.ok(messageObj.type, `Message ${index} should have a type`);
        assert.ok(messageObj.data, `Message ${index} should have data`);
      });

      // Test message replay capability
      const replayedMessages = loadMessagesFromFile(messageFilePath);
      assert.equal(replayedMessages.length, sidechainMessages.length, 'Should be able to replay all messages');

      // Verify replayed messages have correct structure
      replayedMessages.forEach((msg, index) => {
        assert.ok(msg instanceof Message, `Replayed message ${index} should be a Message instance`);
        assert.ok(msg.type, `Replayed message ${index} should have a type`);
        assert.ok(msg.data, `Replayed message ${index} should have data`);
      });

      // Verify sidechain genesis block contains Bitcoin reference
      const genesisData = JSON.parse(sidechainGenesisBlock.data);
      assert.equal(genesisData.bitcoinGenesisHash, bitcoinGenesisHash, 'Genesis should reference Bitcoin genesis block');
      assert.ok(genesisData.participants.length === 3, 'Genesis should have 3 participants');
      assert.ok(genesisData.sidechainId, 'Genesis should have a sidechain ID');
      assert.equal(genesisData.type, 'SidechainGenesis', 'Genesis should have correct type');

      // Verify taproot addresses were created
      assert.ok(taprootAddresses.has('node1-node2'), 'Should have node1-node2 taproot address');
      assert.ok(taprootAddresses.has('node2-node3'), 'Should have node2-node3 taproot address');

      // Verify monitored addresses are tracked
      assert.ok(monitoredAddresses.has('node1'), 'Should monitor node1 address');
      assert.ok(monitoredAddresses.has('node2'), 'Should monitor node2 address');
      assert.ok(monitoredAddresses.has('node3'), 'Should monitor node3 address');

      // Verify deposit messages contain correct information
      const depositMessages = sidechainMessages.filter(msg => {
        try {
          const data = JSON.parse(msg.data);
          return data.type === 'BitcoinDeposit';
        } catch (e) {
          return false;
        }
      });

      assert.equal(depositMessages.length, 3, 'Should have 3 deposit messages');

      depositMessages.forEach((depositMsg, index) => {
        const depositData = JSON.parse(depositMsg.data);
        assert.equal(depositData.type, 'BitcoinDeposit', `Deposit message ${index} should have correct type`);
        assert.ok(depositData.address, `Deposit message ${index} should have address`);
        assert.ok(depositData.txid, `Deposit message ${index} should have txid`);
        assert.ok(depositData.amount, `Deposit message ${index} should have amount`);
        assert.equal(depositData.blockHeight, blockHeight, `Deposit message ${index} should have correct block height`);
      });

      console.debug(`[SIDECHAIN] Successfully created sidechain with ${sidechainMessages.length} messages`);
      console.debug(`[SIDECHAIN] Messages stored to: ${messageFilePath}`);
      console.debug(`[SIDECHAIN] Monitored addresses:`, Array.from(monitoredAddresses.entries()));
      console.debug(`[SIDECHAIN] Taproot addresses:`, Array.from(taprootAddresses.entries()));
    });

    it('can replay sidechain messages to reconstruct state', async function () {
      this.timeout(30000); // 30 seconds for the test

      // Create a new test file with sample messages
      const key1 = new Key({ network: 'regtest', purpose: 44, account: 0, index: 0 });
      const key2 = new Key({ network: 'regtest', purpose: 44, account: 0, index: 1 });

      const testMessages = [
        new Message({
          type: 'P2P_BASE_MESSAGE',
          data: JSON.stringify({
            type: 'SidechainGenesis',
            timestamp: Date.now(),
            bitcoinGenesisHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
            participants: [
              { nodeId: 'node1', publicKey: key1.publicKey },
              { nodeId: 'node2', publicKey: key2.publicKey }
            ],
            sidechainId: 'test-sidechain-id',
            version: '1.0.0'
          })
        }),
        new Message({
          type: 'BitcoinTransaction',
          data: JSON.stringify({
            type: 'BitcoinDeposit',
            timestamp: Date.now(),
            address: key1.deriveAddress(0, 0, 'p2pkh').address,
            txid: 'test-tx-1',
            amount: 0.001,
            blockHeight: 100,
            sidechainId: 'test-sidechain-id'
          })
        })
      ];

      // Sign messages
      testMessages[0].signWithKey(key1);
      testMessages[1].signWithKey(key1);

      // Store messages
      const filePath = storeMessagesToFile(testMessages, 'test-replay.jsonl');

      // Load and verify messages can be replayed
      const replayedMessages = loadMessagesFromFile(filePath);

      assert.equal(replayedMessages.length, testMessages.length, 'Should replay all messages');

      // Verify message content
      const genesisMsg = replayedMessages.find(msg => {
        try {
          const data = JSON.parse(msg.data);
          return data.type === 'SidechainGenesis';
        } catch (e) {
          return false;
        }
      });

      assert.ok(genesisMsg, 'Should find genesis message');

      const genesisData = JSON.parse(genesisMsg.data);
      assert.equal(genesisData.sidechainId, 'test-sidechain-id', 'Should preserve sidechain ID');
      assert.equal(genesisData.participants.length, 2, 'Should preserve participant count');

      const depositMsg = replayedMessages.find(msg => {
        try {
          const data = JSON.parse(msg.data);
          return data.type === 'BitcoinDeposit';
        } catch (e) {
          return false;
        }
      });

      assert.ok(depositMsg, 'Should find deposit message');

      const depositData = JSON.parse(depositMsg.data);
      assert.equal(depositData.amount, 0.001, 'Should preserve deposit amount');
      assert.equal(depositData.blockHeight, 100, 'Should preserve block height');

      console.debug(`[SIDECHAIN] Successfully replayed ${replayedMessages.length} messages`);
    });
  });
});
