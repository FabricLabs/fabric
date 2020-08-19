'use strict';

// Settings
const PORT = process.env.PORT || 7777;
const SEED = process.env.SEED || '';

// Fabric Types
const CLI = require('../types/cli');
const settings = {
  listen: true,
  port: PORT,
  peers: [
    // '25.14.120.36:7777',
    // 'localhost:7777',
    // 'antipode:7777',
    // 'rpg.verse.im:7777',
    // 'forge.fabric.pub:7777',
    'hub.fabric.pub:7777'
  ],
  wallet: {
    seed: SEED
  }
};

async function main () {
  const chat = new CLI(settings);
  await chat.start();
}

main().catch((exception) => {
  console.error('[SCRIPTS:CHAT]', 'Main process threw Exception:', exception);
});