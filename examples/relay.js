'use strict';

require('debug-trace')({ always: true });

const PEER_SEED = 'frown equal zero tackle relief shallow leisure diet roast festival good plunge pencil virus vote property blame random bacon rich ecology major survey slice';
const PEER_ID = 'mt4Wm6TW4ejU51iviiD73ECNCfRsjiBhQf';

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
        seed: PEER_SEED
      }
    })
  };

  // Core functionality (wait for peer, send message)
  swarm.origin.on('peer:candidate', async function (peer) {
    console.log('[EXAMPLES:RELAY]', 'Origin Peer emitted "peer:candidate" event:', peer);

    if (peer.id === PEER_ID) {
      console.warn('[EXAMPLES:RELAY]', 'Peer event was destination peer!');
      console.warn('[EXAMPLES:RELAY]', 'Origin node peers:', swarm.origin.peers);
      console.warn('[EXAMPLES:RELAY]', 'Relay node peers:', swarm.relayer.peers);
      console.warn('[EXAMPLES:RELAY]', 'Destination node peers:', swarm.destination.peers);

      // Send Message
      let message = Message.fromVector(['Generic', 'Hello, world!']);
      await swarm.origin.broadcast(message);
    }
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
    console.log('[EXAMPLES:RELAY]', 'Got message on origin:', msg.type, msg.body.toString('utf8'));
  });

  swarm.relayer.on('message', async function handleSwarmMessage (msg) {
    console.log('[EXAMPLES:RELAY]', 'Got message on relayer:', msg.type, msg.body);
  });

  swarm.destination.on('message', async function handleSwarmMessage (msg) {
    console.log('[EXAMPLES:RELAY]', 'Got message on destination:', msg.type, msg.body);
  });

  // Start component services
  console.warn('[EXAMPLES:RELAY]', 'Starting origin Peer...');
  await swarm.origin.start();
  console.log('[EXAMPLES:RELAY]', 'Origin Peer started!');

  console.warn('[EXAMPLES:RELAY]', 'Starting relayer Peer...');
  await swarm.relayer.start();
  console.log('[EXAMPLES:RELAY]', 'Relayer Peer started!');

  console.warn('[EXAMPLES:RELAY]', 'Starting destination Peer...');
  await swarm.destination.start();
  console.log('[EXAMPLES:RELAY]', 'Destination Peer started!');
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:RELAY]', 'Main process threw Exception:', exception);
});