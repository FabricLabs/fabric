'use strict';

// Settings
const PORT = process.env.PORT;

// Fabric Types
const CLI = require('../types/cli');

const hubs = [
  // 'localhost:7777',
  'rpg.verse.im:7777',
  'forge.fabric.pub:7777',
  'hub.fabric.pub:7777'
];

async function main () {
  const chat = new CLI({ peers: hubs });
  await chat.start();
}

main().catch((exception) => {
  console.error('[SCRIPTS:CHAT]', 'Main process threw Exception:', exception);
});