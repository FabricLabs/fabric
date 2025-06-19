'use strict';

// Dependencies
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const BN = require('bn.js');

// Fabric Types
const Key = require('../../types/key');

// Fabric Services
const Bitcoin = require('../../services/bitcoin');
const Lightning = require('../../services/lightning');

describe('@fabric/core/services/lightning', function () {
  this.timeout(180000);

  const bitcoinDefaults = {
    debug: false,
    network: 'regtest',
    mode: 'fabric',
    host: '127.0.0.1',
    port: 18444,
    rpcport: 18443,
    zmqport: 18445,
    managed: true,
    username: 'bitcoinrpc',
    password: 'password',
    datadir: './stores/bitcoin-regtest-test'
  };

  const lightningDefaults = {
    debug: false,
    bitcoin: {
      rpcport: 18443,
      rpcuser: 'bitcoinrpc',
      rpcpassword: 'password',
      host: '127.0.0.1',
      datadir: './stores/bitcoin-regtest-test'
    },
    datadir: './stores/lightning-regtest-test',
    managed: true,
    socket: 'lightningd.sock',
    mode: 'socket',
    network: 'regtest',
    log_level: 'debug'
  };

  let key;
  let bitcoin;
  let lightning;
  let peer;
  let carol;

  async function resetChain (chain) {
    const height = await chain._makeRPCRequest('getblockcount', []);
    if (height > 0) {
      const secondblock = await chain._makeRPCRequest('getblockhash', [1]);
      await chain._makeRPCRequest('invalidateblock', [secondblock]);
    }
  }

  before(async function () {
    this.timeout(180000); // 3 minutes for setup

    // Clean up test directories
    try {
      const { execSync } = require('child_process');
      const dirs = [
        path.resolve('./stores/bitcoin-regtest-test'),
        path.resolve('./stores/lightning-regtest-test'),
        path.resolve('./stores/lightning-regtest-test-peer'),
        path.resolve('./stores/lightning-regtest-test-carol')
      ];

      dirs.forEach(dir => {
        try {
          if (fs.existsSync(dir)) {
            execSync(`rm -rf "${dir}"`);

            try {
              const stillExists = fs.existsSync(dir);
              if (stillExists) console.warn(`[FABRIC:LIGHTNING] Failed to clean up directory: ${dir}`);
            } catch (error) {
              console.error(`[FABRIC:LIGHTNING] Error checking directory status: ${dir}`, error);
            }
          } else {
            console.debug(`[FABRIC:LIGHTNING] Directory already cleaned up: ${dir}`);
          }
        } catch (error) {
          console.error(`[FABRIC:LIGHTNING] Error cleaning up directory ${dir}:`, error);
        }
      });

      // Verify all directories are cleaned up
      const remainingDirs = dirs.filter(dir => fs.existsSync(dir));
      if (remainingDirs.length > 0) console.warn('[FABRIC:LIGHTNING] Some directories were not cleaned up:', remainingDirs);
    } catch (error) {
      console.error('[FABRIC:LIGHTNING]', 'Error during cleanup:', error);
    }

    // Create the key with the correct network configuration
    key = new Key({
      network: 'regtest',
      purpose: 44,
      account: 0,
      index: 0
    });

    // Initialize Bitcoin service first
    bitcoin = new Bitcoin(bitcoinDefaults);

    // Set the key on the Bitcoin service
    bitcoin.settings.key = { xpub: key.xpub };

    // Start Bitcoin service
    await bitcoin.start();

    // Wait for Bitcoin to be ready
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Initialize Lightning nodes
    lightning = new Lightning(lightningDefaults);

    peer = new Lightning({
      ...lightningDefaults,
      datadir: './stores/lightning-regtest-test-peer',
      // debug: true,
      port: 9888,
      plugins: {
        grpc: {
          port: 9836  // Different port for gRPC
        }
      }
    });

    carol = new Lightning({
      ...lightningDefaults,
      datadir: './stores/lightning-regtest-test-carol',
      // debug: true,
      port: 9890,
      plugins: {
        grpc: {
          port: 9837  // Different port for gRPC
        }
      }
    });
  });

  after(async function () {
    console.debug('[FABRIC:LIGHTNING]', 'Cleaning up test environment...');

    // Clean up first node
    if (carol) {
      try {
        console.debug('[FABRIC:LIGHTNING]', 'Stopping carol node...');
        await carol.stop();
        console.debug('[FABRIC:LIGHTNING]', 'Peer node stopped');
      } catch (error) {
        console.error('[FABRIC:LIGHTNING]', 'Error stopping Peer:', error);
        // Force kill if process exists
        if (carol._child && !carol._child.killed) {
          console.debug('[FABRIC:LIGHTNING]', 'Force killing carol process...');
          carol._child.kill('SIGKILL');
        }
      }
    }

    // Clean up second node
    if (peer) {
      try {
        console.debug('[FABRIC:LIGHTNING]', 'Stopping peer node...');
        await peer.stop();
        console.debug('[FABRIC:LIGHTNING]', 'Peer node stopped');
      } catch (error) {
        console.error('[FABRIC:LIGHTNING]', 'Error stopping Peer:', error);
        // Force kill if process exists
        if (peer._child && !peer._child.killed) {
          console.debug('[FABRIC:LIGHTNING]', 'Force killing peer process...');
          peer._child.kill('SIGKILL');
        }
      }
    }

    // Clean up Lightning
    if (lightning) {
      try {
        console.debug('[FABRIC:LIGHTNING]', 'Stopping main node...');
        await lightning.stop();
        console.debug('[FABRIC:LIGHTNING]', 'Main node stopped');
      } catch (error) {
        console.error('[FABRIC:LIGHTNING]', 'Error stopping Lightning:', error);
        // Force kill if process exists
        if (lightning._child && !lightning._child.killed) {
          console.debug('[FABRIC:LIGHTNING]', 'Force killing main process...');
          lightning._child.kill('SIGKILL');
        }
      }
    }

    // Then clean up Bitcoin
    if (bitcoin) {
      try {
        console.debug('[FABRIC:BITCOIN]', 'Stopping Bitcoin node...');
        await bitcoin.stop();
        console.debug('[FABRIC:BITCOIN]', 'Bitcoin node stopped');
      } catch (error) {
        console.error('[FABRIC:BITCOIN]', 'Error stopping Bitcoin:', error);
        // Force kill if process exists
        if (bitcoin._nodeProcess && !bitcoin._nodeProcess.killed) {
          console.debug('[FABRIC:BITCOIN]', 'Force killing Bitcoin process...');
          bitcoin._nodeProcess.kill('SIGKILL');
        }
      }
    }
  });

  describe('Lightning', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Lightning instanceof Function, true);
    });

    it('can complete a payment (happy path)', async function () {
      resetChain(bitcoin);

      // Create a descriptor wallet
      console.debug('\n[DEBUG] Creating test wallet...');
      const wallet1 = await bitcoin._loadWallet('testwallet1');
      const miner = await bitcoin._makeRPCRequest('getnewaddress', []);
      const generated = await bitcoin._makeRPCRequest('generatetoaddress', [101, miner]);
      // Some funds are now spendable

      // Start the Lightning nodes
      await lightning.start();
      await peer.start();
      await carol.start();

      // Fund nodes
      const fund1 = await lightning.newDepositAddress();
      const fund2 = await peer.newDepositAddress();
      const fund3 = await carol.newDepositAddress();
      const deposit1 = await bitcoin._makeRPCRequest('sendtoaddress', [fund1, 1]);
      const deposit2 = await bitcoin._makeRPCRequest('sendtoaddress', [fund2, 1]);
      const deposit3 = await bitcoin._makeRPCRequest('sendtoaddress', [fund3, 1]);
      const confirmation = await bitcoin._makeRPCRequest('generatetoaddress', [1, miner]);
      await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait for the transaction to be processed

      // Wait for funds to appear in both Lightning nodes and be confirmed
      let funds1 = null;
      let funds2 = null;
      let funds3 = null;
      let attempts = 0;
      const maxAttempts = 30;
      while (attempts < maxAttempts) {
        funds1 = await lightning.listFunds();
        funds2 = await peer.listFunds();
        funds3 = await carol.listFunds();
        console.debug(`Attempt ${attempts + 1}/${maxAttempts} - funds1:`, funds1);
        console.debug(`Attempt ${attempts + 1}/${maxAttempts} - funds2:`, funds2);
        console.debug(`Attempt ${attempts + 1}/${maxAttempts} - funds3:`, funds3);

        if (funds1.outputs && funds1.outputs.length > 0 && 
            funds1.outputs.filter((x) => x.status === 'confirmed').length > 0 &&
            funds2.outputs && funds2.outputs.length > 0 && 
            funds2.outputs.filter((x) => x.status === 'confirmed').length > 0 &&
            funds3.outputs && funds3.outputs.length > 0 && 
            funds3.outputs.filter((x) => x.status === 'confirmed').length > 0) {
          break;
        }

        attempts++;
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      assert.ok(funds1, 'First node funds should be available');
      assert.ok(funds2, 'Second node funds should be available');
      assert.ok(funds1.outputs.length > 0, 'First node should have at least one output');
      assert.ok(funds2.outputs.length > 0, 'Second node should have at least one output');
      assert.ok(funds1.outputs.filter((x) => x.status === 'confirmed').length > 0, 'First node should have at least one confirmed output');
      assert.ok(funds2.outputs.filter((x) => x.status === 'confirmed').length > 0, 'Second node should have at least one confirmed output');
      // both L2 nodes are now funded

      // Connect the peers
      console.debug('peer:', peer.state);
      await lightning.connectTo(`${peer.state.node.id}@127.0.0.1:${peer.settings.port}`);

      // 10000 + 3157 seems to be the minimum, at least for regtest
      const channel = await lightning.createChannel(peer.state.node.id, 200000);
      // const inbound = await peer.createChannel(lightning.state.node.id, 100000);
      const finality = await bitcoin._makeRPCRequest('generatetoaddress', [6, miner]);

      // Wait for the channel to be established
      let channelEstablished = false;
      attempts = 0;
      while (!channelEstablished && attempts < 20) {
        const channels = await lightning._makeRPCRequest('listchannels', []);
        console.debug(`Attempt ${attempts + 1}/20 - channels:`, channels);
        if (channels.channels && channels.channels.length > 0) {
          channelEstablished = true;
          break;
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Connect peer to carol and create channel
      console.debug('Connecting peer to carol...');
      await peer.connectTo(`${carol.state.node.id}@127.0.0.1:${carol.settings.port}`);
      
      // Create channel from peer to carol
      console.debug('Creating channel from peer to carol...');
      const peerToCarolChannel = await peer.createChannel(carol.state.node.id, 100000);
      const peerToCarolFinality = await bitcoin._makeRPCRequest('generatetoaddress', [6, miner]);

      // Wait for both channels to be active
      let allChannelsActive = false;
      attempts = 0;
      while (!allChannelsActive && attempts < 20) {
        const peerInfo = await peer._makeRPCRequest('getinfo', []);
        console.debug(`Attempt ${attempts + 1}/20 - peer info:`, peerInfo);

        if (peerInfo.num_active_channels === 2 && peerInfo.num_pending_channels === 0) {
          allChannelsActive = true;
          break;
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Verify channel states
      const peerChannels = await peer._makeRPCRequest('listchannels', []);
      const carolChannels = await carol._makeRPCRequest('listchannels', []);
      console.debug('Peer channels:', peerChannels);
      console.debug('Carol channels:', carolChannels);

      const invoice = await peer.createInvoice(10000000);
      const unconnected = await carol.createInvoice(10000000);
      const initialPayment = await lightning._makeRPCRequest('pay', [invoice.bolt11]);

      const current1 = await lightning.listFunds();
      const current2 = await peer.listFunds();
      const channels1 = await lightning._makeRPCRequest('listchannels', []);
      const channels2 = await peer._makeRPCRequest('listchannels', []);

      console.debug('channels1:', channels1);
      console.debug('channels2:', channels2);

      const after1 = await lightning._makeRPCRequest('getinfo', []);
      const after2 = await peer._makeRPCRequest('getinfo', []);
      const after3 = await carol._makeRPCRequest('getinfo', []);

      console.debug('after1:', after1);
      console.debug('after2:', after2);
      console.debug('after3:', after3);

      const liq1 = await lightning.computeLiquidity();
      const liq2 = await peer.computeLiquidity();
      const liq3 = await carol.computeLiquidity();
      console.debug('liq1:', liq1);
      console.debug('liq2:', liq2);
      console.debug('liq3:', liq3);

      assert.ok(lightning);
      assert.ok(peer);
      assert.ok(initialPayment);
      assert.ok(initialPayment.payment_preimage, 'Payment should have a preimage');
      assert.ok(initialPayment.payment_hash, 'Payment should have a hash');
      assert.ok(initialPayment.status, 'Payment should have a status');
      assert.equal(initialPayment.status, 'complete', 'Payment status should be complete');
      assert.ok(current1);
      assert.ok(current2);
      assert.ok(current1.outputs.length > 0, 'First node should have at least one output');
      assert.ok(current2.outputs.length > 0, 'Second node should have at least one output');
      assert.ok(current1.outputs.filter((x) => x.status === 'confirmed').length > 0, 'First node should have at least one confirmed output');
      assert.ok(current2.outputs.filter((x) => x.status === 'confirmed').length > 0, 'Second node should have at least one confirmed output');
      assert.ok(channels1);
      assert.ok(channels2);
      assert.ok(channels1.channels.length > 0, 'First node should have at least one channel');
      assert.ok(channels2.channels.length > 0, 'Second node should have at least one channel');
      assert.ok(after1);
      assert.ok(after2);
      assert.ok(after1.id, 'First node should have an ID');
      assert.ok(after2.id, 'Second node should have an ID');
      assert.ok(liq1);
      assert.ok(liq1, 'Liquidity should be computed for the peer node');
      assert.ok(liq1.inbound, 'Liquidity should have an inbound value');
      assert.ok(liq1.outbound, 'Liquidity should have an outbound value');

      assert.ok(liq2.inbound, 'Liquidity should have an inbound value for peer node');
      const inboundBN = new BN(liq1.inbound.replace('.', ''));
      const expectedInboundBN = new BN('100000'); // 0.001 BTC (removed decimal point)
      assert.ok(inboundBN.gt(new BN(0)), 'Inbound liquidity should be greater than 0');

      // Get peer info first
      const peerInfo = await peer._makeRPCRequest('getinfo', []);

      // Verify channel states
      assert.equal(peerInfo.num_active_channels, 2, 'Peer should have 2 active channels');
      assert.equal(peerInfo.num_pending_channels, 0, 'Peer should have no pending channels');
      assert.equal(peerInfo.num_peers, 2, 'Peer should be connected to 2 nodes');

      // Verify channel capacities
      const initialPeerChannels = await peer._makeRPCRequest('listchannels', []);
      const lightningToPeer = initialPeerChannels.channels.find(c => c.source === after1.id && c.destination === after2.id);
      const peerToCarol = initialPeerChannels.channels.find(c => c.source === after2.id && c.destination === after3.id);

      assert.ok(lightningToPeer, 'Channel from lightning to peer should exist');
      assert.ok(peerToCarol, 'Channel from peer to carol should exist');
      assert.equal(lightningToPeer.amount_msat, '200000000', 'Lightning to peer channel should have 0.002 BTC capacity');
      assert.equal(peerToCarol.amount_msat, '100000000', 'Peer to carol channel should have 0.001 BTC capacity');

      // Test routing capabilities
      const route = await lightning._makeRPCRequest('getroute', [after3.id, 10000000, 1, 0]);
      assert.ok(route, 'Should be able to find a route to carol');
      assert.ok(route.route, 'Route should contain path information');
      assert.equal(route.route.length, 2, 'Route should have 2 hops');
      assert.equal(route.route[0].id, after2.id, 'First hop should be peer');
      assert.equal(route.route[1].id, after3.id, 'Second hop should be carol');

      // Test payment through the route
      const carolInvoice = await carol.createInvoice(10000000, 'Test routed payment', 'Payment through peer');
      const routedPayment = await lightning._makeRPCRequest('pay', [carolInvoice.bolt11]);

      // Log payment response for debugging
      console.debug('Payment response:', JSON.stringify(routedPayment, null, 2));

      // Verify that the payment was successful by checking the payment status
      assert.ok(routedPayment, 'Payment response should exist');
      assert.equal(routedPayment.status, 'complete', 'Routed payment should be complete');
      assert.ok(routedPayment.payment_preimage, 'Payment should have a preimage');
      assert.ok(routedPayment.payment_hash, 'Payment should have a hash');

      // Verify that the channels are still active and have the expected capacities
      const finalPeerChannels = await peer._makeRPCRequest('listchannels', []);
      const finalLightningToPeer = finalPeerChannels.channels.find(c => c.source === after1.id && c.destination === after2.id);
      const finalPeerToCarol = finalPeerChannels.channels.find(c => c.source === after2.id && c.destination === after3.id);

      assert.ok(finalLightningToPeer.active, 'Lightning to peer channel should still be active');
      assert.ok(finalPeerToCarol.active, 'Peer to carol channel should still be active');
      assert.equal(finalLightningToPeer.amount_msat, '200000000', 'Lightning to peer channel should maintain 0.002 BTC capacity');
      assert.equal(finalPeerToCarol.amount_msat, '100000000', 'Peer to carol channel should maintain 0.001 BTC capacity');

      // Compute final liquidity values
      const finalLiq1 = await lightning.computeLiquidity();
      const finalLiq2 = await peer.computeLiquidity();
      const finalLiq3 = await carol.computeLiquidity();

      // Verify liquidity values
      console.debug('Initial liquidity:', {
        outbound: liq1.outbound,
        inbound: liq3.inbound
      });
      console.debug('Final liquidity:', {
        outbound: finalLiq1.outbound,
        inbound: finalLiq3.inbound
      });

      // Verify that the payment amount matches the invoice
      assert.equal(routedPayment.amount_msat, '10000000', 'Payment amount should match invoice amount');
      assert.equal(routedPayment.destination, after3.id, 'Payment destination should be carol');

      // Send a payment from wallet1 to wallet2
      /* const wallet2 = await bitcoin._loadWallet('testwallet2');
      const destination = await bitcoin._makeRPCRequest('getnewaddress', []);
      await bitcoin._unloadWallet('testwallet2');

      await bitcoin._loadWallet('testwallet1');
      const payment = await bitcoin._makeRPCRequest('sendtoaddress', [destination, 1]);
      const confirmation = await bitcoin._makeRPCRequest('generatetoaddress', [1, miner]);
      await bitcoin._unloadWallet('testwallet1');

      await bitcoin._loadWallet('testwallet2');
      const wallet = await bitcoin._makeRPCRequest('getwalletinfo', []);
      const balance = await bitcoin._makeRPCRequest('getbalance', []);
      await bitcoin._unloadWallet('testwallet2');

      assert.ok(bitcoin);
      assert.ok(balance);
      assert.equal(balance, 1); */
    });
  });
});
