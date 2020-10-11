#!/usr/bin/env node
'use strict';

// Configuration
const PORT = process.env.PORT;
const SEED = process.env.SEED;

// Fabric Types
const CLI = require('../types/cli');

// Services
const Matrix = require('../services/matrix');

// Settings
const settings = {
  listen: true,
  peers: [
    '027cac525e934dd777a944565f114b7babdb73412e37f568a0115d241d3da6ba08@antipode:7777',
    '02e8da26206354565edf7ddefe13325ac83a03f4ff4a903d75c81a05173e841e91@174.129.128.216:7777',
    '02de546951cee477c90c36d38615a338123a7e1fe190f3c117b028f60359b5bc7e@hub.fabric.pub:7777',
    '02512b88b368b43c93eeb725439df33fa6e30a2b40e22bba7844bc22f675afc76a@54.193.117.227:7777',
    '02a1933ff21f2d588285f4dc759402e02ae2ad15840243ce79fbb213eaca2b3724@95.217.115.29:7777'
  ],
  services: [
    'matrix'
  ],
  port: PORT,
  seed: SEED,
  // TODO: remove Wallet-specfic configuration
  wallet: {
    seed: SEED
  }
};

// Main Program
async function main () {
  const chat = new CLI(settings);

  // ## Services
  // TODO: reconcile API wth @fabric/doorman as appears at: https://github.com/FabricLabs/doorman
  chat._registerService('matrix', Matrix);
  // chat._registerService('rpg', RPG);

  await chat.start();
}

main().catch((exception) => {
  console.error('[SCRIPTS:CHAT]', 'Main process threw Exception:', exception);
});
