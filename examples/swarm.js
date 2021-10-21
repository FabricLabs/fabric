'use strict';

// Dependencies
const Peer = require('../types/peer');
const Swarm = require('../types/swarm');
const Message = require('../types/message');

// Configuration
const settings = {
  seeds: ['localhost:7777']
};

async function main () {
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

  // Send Regular Updates (outside of internal ping/pong)
  let heartbeat = setInterval(function () {
    console.warn('[EXAMPLES:SWARM]', 'Starting to send interval message...');
    let message = Message.fromVector(['Generic', Date.now().toString()]);
    console.log('[EXAMPLES:SWARM]', 'Sending :', message.raw);

    // Send interval message through seed node
    seeder.broadcast(message);

    // Send interval message through swarm agent
    // swarm.broadcast(message);
  }, 5000);
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:SWARM]', 'Main process threw Exception:', exception);
});