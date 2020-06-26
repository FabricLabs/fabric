'use strict';

require('debug-trace')({ always: true });

// Dependencies
const Peer = require('../types/peer');
const Message = require('../types/message');

async function main () {
  const swarm = {
    origin: new Peer({ listen: true }),
    relayer: new Peer({
      port: 7778,
      peers: ['localhost:7777'],
      listen: true
    }),
    destination: new Peer({
      peers: ['localhost:7778']
    })
  };

  // Debug Listeners
  // TODO: remove these
  swarm.origin.on('socket:data', async function debugSocketData (data) {
    console.log('[EXAMPLES:RELAY]', 'Origin Peer received data:', data);
  });

  swarm.relayer.on('socket:data', async function debugSocketData (data) {
    console.log('[EXAMPLES:RELAY]', 'Relayer Peer received data:', data);
  });

  swarm.destination.on('socket:data', async function debugSocketData (data) {
    console.log('[EXAMPLES:RELAY]', 'Destination Peer received data:', data);
  });

  // Listeners
  swarm.origin.on('message', async function handleHubMessage (msg) {
    console.log('[EXAMPLES:RELAY]', 'Got message on origin:', msg.raw);
  });

  swarm.relayer.on('message', async function handleSwarmMessage (msg) {
    console.log('[EXAMPLES:RELAY]', 'Got message on relayer:', msg.raw);
  });

  swarm.destination.on('message', async function handleSwarmMessage (msg) {
    console.log('[EXAMPLES:RELAY]', 'Got message on destination:', msg.raw);
  });

  // Start component services
  console.log('[EXAMPLES:RELAY]', 'Starting origin Peer...');
  await swarm.origin.start();
  console.log('[EXAMPLES:RELAY]', 'Origin Peer started!');

  console.log('[EXAMPLES:RELAY]', 'Starting relayer Peer...');
  await swarm.relayer.start();
  console.log('[EXAMPLES:RELAY]', 'Relayer Peer started!');

  console.log('[EXAMPLES:RELAY]', 'Starting destinaton Peer...');
  await swarm.destination.start();
  console.log('[EXAMPLES:RELAY]', 'Destinaton Peer started!');

  // Send Message
  let message = Message.fromVector(['Generic', 'Hello, world!']);
  await swarm.origin.broadcast(message);
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:RELAY]', 'Main process threw Exception:', exception);
});