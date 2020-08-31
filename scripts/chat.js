'use strict';

// Settings
const PORT = process.env.PORT;
const SEED = process.env.SEED;

// Fabric Types
const CLI = require('../types/cli');
const Matrix = require('../services/matrix');

// Settings
const settings = {
  listen: true,
  port: PORT,
  peers: [
    '027cac525e934dd777a944565f114b7babdb73412e37f568a0115d241d3da6ba08@antipode:7777',
    '02e8da26206354565edf7ddefe13325ac83a03f4ff4a903d75c81a05173e841e91@174.129.128.216:7777',
    '034a53b1fb50e794db9c859aed9851c543a6618f55a2e597a821e8e220f1e02fa9@hub.fabric.pub:7777'
  ],
  wallet: {
    seed: SEED
  }
};

async function main () {
  const chat = new CLI(settings);
  // chat._registerService('matrix', Matrix);
  await chat.start();
}

main().catch((exception) => {
  console.error('[SCRIPTS:CHAT]', 'Main process threw Exception:', exception);
});