'use strict';

require('debug-trace')({ always: true });
const { setMaxListeners } = require('events');

const SEEDS = {
  origin: 'unknown burger engine plug teach spot squeeze fringe ethics skate riot brand hurry melody double then trumpet impulse lesson inflict enlist eager region ride',
  relayer: 'salmon asthma decorate oxygen relief excite lamp huge bunker tennis spread chase liar glass shoe giant crane drama media step crack decline ring stay',
  destination: 'frown equal zero tackle relief shallow leisure diet roast festival good plunge pencil virus vote property blame random bacon rich ecology major survey slice'
};

const DESTINATION_ID = 'mt4Wm6TW4ejU51iviiD73ECNCfRsjiBhQf';

// Dependencies
const Peer = require('../types/peer');
const Message = require('../types/message');

async function main () {
  setMaxListeners(0);
  const swarm = {
    origin: new Peer({
      listen: true,
      wallet: {
        seed: SEEDS.origin
      }
    }),
    relayer: new Peer({
      port: 7778,
      peers: ['localhost:7777'],
      listen: true,
      wallet: {
        seed: SEEDS.relayer
      }
    }),
    destination: new Peer({
      peers: ['localhost:7778'],
      wallet: {
        seed: SEEDS.destination
      }
    })
  };

  // Core functionality (wait for peer, send message)
  swarm.origin.on('peer:candidate', async function (peer) {
    console.log('[EXAMPLES:RELAY]', 'Origin Peer emitted "peer:candidate" event:', peer);
    if (peer.id === DESTINATION_ID) {
      console.warn('[EXAMPLES:RELAY]', 'Destination candidate discovered.');
    }
  });

  swarm.destination.on('message', async function handleSwarmMessage (msg) {
    console.log('[EXAMPLES:RELAY]', 'Got message on destination:', msg);
  });

  // Start component services
  console.log('[EXAMPLES:RELAY]', 'Starting origin Peer...');
  await swarm.origin.start();
  console.log('[EXAMPLES:RELAY]', 'Origin Peer started!');

  console.log('[EXAMPLES:RELAY]', 'Starting relayer Peer...');
  await swarm.relayer.start();
  console.log('[EXAMPLES:RELAY]', 'Relayer Peer started!');

  console.log('[EXAMPLES:RELAY]', 'Starting destination Peer...');
  await swarm.destination.start();
  console.log('[EXAMPLES:RELAY]', 'Destination Peer started!');

  // Allow peering to settle before broadcasting.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const message = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
    type: 'RelayExample',
    object: { text: 'Hello, world!' }
  })]);
  await swarm.origin.broadcast(message.toBuffer());

  await new Promise((resolve) => setTimeout(resolve, 1500));

  await swarm.destination.stop();
  await swarm.relayer.stop();
  await swarm.origin.stop();
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:RELAY]', 'Main process threw Exception:', exception);
});