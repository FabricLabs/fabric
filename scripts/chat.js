'use strict';

// Settings
const PORT = process.env.PORT;
const SEED = process.env.SEED;

// Fabric Types
const CLI = require('../types/cli');
const settings = {
  seed: SEED,
  peers: [
    // 'localhost:7777',
    // 'antipode:7777',
    'rpg.verse.im:7777',
    'forge.fabric.pub:7777',
    'hub.fabric.pub:7777'
  ],
  listen: true
};

async function main () {
  const chat = new CLI(settings);
  await chat.start();
}

main().catch((exception) => {
  console.error('[SCRIPTS:CHAT]', 'Main process threw Exception:', exception);
});