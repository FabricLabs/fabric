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
  const chat = new CLI(settings);

  if (this.wallet) chat.attachWallet(this.wallet);

  // ## Services
  // TODO: reconcile API wth @fabric/doorman as appears at: https://github.com/FabricLabs/doorman
  // chat._registerService('matrix', Matrix);
  // chat._registerService('rpg', RPG);

  await chat.start();
}

// Module
module.exports = OP_CHAT;
