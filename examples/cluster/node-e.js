'use strict';

const SEED = process.env.SEED;
const PORT = process.env.PORT || 3339;

// Dependencies
const Peer = require('../../types/peer');
const Message = require('../../types/message');

async function main () {
  const peer = new Peer({
    port: PORT,
    listen: true,
    wallet: {
      seed: SEED
    },
    peers: ['localhost:3337']
  });

  // Core functionality (wait for peer, send message)
  peer.on('peer:candidate', async function (peer) {
    console.log('[EXAMPLES:RELAY]', 'Peer "E" emitted "peer:candidate" event:', peer);

    if (peer.id === PEER_ID) {
      console.warn('[EXAMPLES:RELAY]', 'Peer event was destination peer!');
      console.warn('[EXAMPLES:RELAY]', 'Known peers:', peer.peers);

      // Send Message
      let message = Message.fromVector(['Generic', 'Hello, world!']);
      await peer.broadcast(message);
    }
  });

  // Listeners
  peer.on('message', async function handleHubMessage (msg) {
    console.log('[EXAMPLES:RELAY]', 'Got message on origin:', msg.type, msg.body.toString('utf8'));
  });

  // Start component services
  console.warn('[EXAMPLES:RELAY]', 'Starting Peer "E"...');
  await peer.start();
  console.log('[EXAMPLES:RELAY]', 'Peer "E" started!');
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:RELAY]', 'Main process threw Exception:', exception);
});