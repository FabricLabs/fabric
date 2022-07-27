'use strict';

// Settings
const playnet = require('../settings/playnet');
const local = require('../settings/local');

const settings = {
  authority: local.authority,
  listen: local.listen,
  // sideload playnet
  peers: [].concat(playnet.peers),
  port: process.env.FABRIC_PORT || 7777,
  services: [
    // 'matrix'
  ],
  key: {
    seed: playnet.seed
  }
};

// Fabric Types
const CLI = require('../types/cli');

// Services
// const Matrix = require('@fabric/matrix');

// Program Definition
async function OP_CHAT () {
  // Fabric CLI
  const chat = new CLI(settings); // TODO: this.settings

  if (!this.environment.wallet) {
    console.error('No wallet found!  Set up your Fabric wallet by running:');
    console.error('\tfabric setup');
    process.exit(1);
  }

  chat.attachWallet(this.environment.wallet);

  // ## Services
  // TODO: reconcile API wth @fabric/doorman as appears at: https://github.com/FabricLabs/doorman
  // chat._registerService('matrix', Matrix);
  // chat._registerService('rpg', RPG);

  await chat.start();

  return JSON.stringify({
    id: chat.id,
    wallet: this.environment.wallet.id
  });
}

// Module
module.exports = OP_CHAT;
