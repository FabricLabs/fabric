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
  setMaxListeners(0);
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

  const stopWithTimeout = async (instance, label, timeoutMs = 1200) => {
    if (!instance || typeof instance.stop !== 'function') return;
    try {
      await Promise.race([
        instance.stop(),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
    } catch (error) {
      console.warn('[EXAMPLES:HEARTBEAT]', `${label} stop warning:`, error.message);
    }
  };

  const shutdown = async () => {
    await stopWithTimeout(swarm, 'Swarm');
    await stopWithTimeout(seeder, 'Seeder');
  };

  // Send a single explicit heartbeat over the current v1 base message type.
  console.warn('[EXAMPLES:HEARTBEAT]', 'Sending heartbeat...');
  const message = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
    type: 'Heartbeat',
    object: { at: Date.now() }
  })]);
  seeder.broadcast(message.toBuffer());

  // Give peers a short window to process, then shut down cleanly.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await shutdown();

  if (require.main === module) process.exit(0);
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:HEARTBEAT]', 'Main process threw Exception:', exception);
});
