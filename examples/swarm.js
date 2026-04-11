'use strict';

// Dependencies
const { setMaxListeners } = require('events');
const Peer = require('../types/peer');
const { Swarm } = require('../types/peer');
const Message = require('../types/message');

// Configuration
const settings = {
  seeds: ['localhost:7777']
};

async function main () {
  // Swarm demos fan out listeners during NOISE handshakes.
  setMaxListeners(0);
  // Create a Hub (seeder peer) and a Swarm (peer cluster)
  let seeder = new Peer({ listen: true });
  let swarm = new Swarm(settings);
  let downstream = new Peer();

  // Listeners
  seeder.on('message', async function handleHubMessage (msg) {
    console.log('[EXAMPLES:SWARM]', 'Got message on Seed node:', msg.raw);
  });

  swarm.on('message', async function handleSwarmMessage (msg) {
    console.log('[EXAMPLES:SWARM]', 'Got message on Swarm:', msg.raw);
  });

  // Start component services
  console.log('[EXAMPLES:SWARM]', 'Starting seeder Peer...');
  await seeder.start();
  console.log('[EXAMPLES:SWARM]', 'Seeder peer started!');

  console.log('[EXAMPLES:SWARM]', 'Starting Swarm...');
  await swarm.start();
  console.log('[EXAMPLES:SWARM]', 'Swarm started!');

  console.log('[EXAMPLES:SWARM]', 'Starting downstream Peer...');
  await downstream.start();
  console.log('[EXAMPLES:SWARM]', 'Downstream started!');

  // Connect downstream "client" Peer
  // console.log('[EXAMPLES:SWARM]', 'Connecting downstream Peer to Swarm...');
  // await downstream._connect('localhost:7777');

  // TODO: create entities on seed node
  // TODO: receive entities from seed node
  // TODO: create entities on swarm instance

  const stopWithTimeout = async (instance, label, timeoutMs = 1200) => {
    if (!instance || typeof instance.stop !== 'function') return;
    try {
      await Promise.race([
        instance.stop(),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
    } catch (error) {
      console.warn('[EXAMPLES:SWARM]', `${label} stop warning:`, error.message);
    }
  };

  const shutdown = async () => {
    await stopWithTimeout(downstream, 'Downstream');
    await stopWithTimeout(swarm, 'Swarm');
    await stopWithTimeout(seeder, 'Seeder');
  };

  console.warn('[EXAMPLES:SWARM]', 'Sending one swarm message...');
  const message = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
    type: 'SwarmExample',
    object: { at: Date.now() }
  })]);
  seeder.broadcast(message.toBuffer());

  await new Promise((resolve) => setTimeout(resolve, 1500));
  await shutdown();

  // Some peer transports may keep sockets around briefly in demos.
  if (require.main === module) process.exit(0);
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:SWARM]', 'Main process threw Exception:', exception);
});
