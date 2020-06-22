'use strict';

const Peer = require('../types/peer');
const Swarm = require('../types/swarm');
const settings = {
  seeds: ['localhost:7777']
};

async function main () {
  let seeder = new Peer({ listen: true });
  let swarm = new Swarm(settings);

  console.log('[EXAMPLES:SWARM]', 'Starting seeder Peer...');
  await seeder.start();
  console.log('[EXAMPLES:SWARM]', 'Seeder peer started!');

  console.log('[EXAMPLES:SWARM]', 'Starting Swarm...');
  await swarm.start();
  console.log('[EXAMPLES:SWARM]', 'Swarm started!');
}

main().catch(function exceptionHandler (exception) {
  console.error('[EXAMPLES:SWARM]', 'Main process threw Exception:', exception);
});