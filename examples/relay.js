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
      peers: ['localhost:7778'],
      wallet: {
        seed: 'frown equal zero tackle relief shallow leisure diet roast festival good plunge pencil virus vote property blame random bacon rich ecology major survey slice'
      }
    })
  };

  // Core functionality (wait for peer, send message)
  swarm.origin.on('peer', async function (peer) {
    console.log('[EXAMPLES:RELAY]', 'Origin Peer emitted "peer" event:', peer);

    // Send Message
    console.warn('[EXAMPLES:RELAY]', 'Generating and sending initial message...');
    let message = Message.fromVector(['Generic', 'Hello, world!']);
    await swarm.origin.broadcast(message);
  });

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
  console.warn('[EXAMPLES:RELAY]', 'Starting origin Peer...');
  await swarm.origin.start();
  console.log('[EXAMPLES:RELAY]', 'Origin Peer started!');

  console.warn('[EXAMPLES:RELAY]', 'Starting relayer Peer...');
  await swarm.relayer.start();
  console.log('[EXAMPLES:RELAY]', 'Relayer Peer started!');

  console.warn('[EXAMPLES:RELAY]', 'Starting destinaton Peer...');
  await swarm.destination.start();
  console.log('[EXAMPLES:RELAY]', 'Destinaton Peer started!');
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:RELAY]', 'Main process threw Exception:', exception);
});