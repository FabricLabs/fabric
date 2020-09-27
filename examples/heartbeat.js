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

  // Listeners
  seeder.on('message', async function handleHubMessage (msg) {
    console.log('[EXAMPLES:HEARTBEAT]', 'Got message on Seed node:', msg.raw);
  });

  swarm.on('message', async function handleSwarmMessage (msg) {
    console.log('[EXAMPLES:HEARTBEAT]', 'Got message on Swarm:', msg.raw);
  });

  // Start component services
  console.log('[EXAMPLES:HEARTBEAT]', 'Starting seeder Peer...');
  await seeder.start();
  console.log('[EXAMPLES:HEARTBEAT]', 'Seeder peer started!');

  console.log('[EXAMPLES:HEARTBEAT]', 'Starting Swarm...');
  await swarm.start();
  console.log('[EXAMPLES:HEARTBEAT]', 'Swarm started!');

  // Send Regular Updates (outside of internal ping/pong)
  const heartbeat = setInterval(function () {
    console.warn('[EXAMPLES:HEARTBEAT]', 'Starting to send interval message...');
    const message = Message.fromVector(['Generic', Date.now().toString()]);
    console.log('[EXAMPLES:HEARTBEAT]', 'Sending :', message.raw);

    // Send interval message through seed node
    seeder.broadcast(message);

    // Send interval message through swarm agent
    // swarm.broadcast(message);
  }, 5000);
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:HEARTBEAT]', 'Main process threw Exception:', exception);
});