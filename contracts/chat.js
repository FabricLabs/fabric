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
  // Configure Earning
  if (this.earn) {
    console.log('learning enabled');
  }

  if (this.seed) {
    settings.key.seed = this.seed;
  } else if (process.env.FABRIC_SEED) {
    settings.key.seed = this.seed;
  }

  // Fabric CLI
  const chat = new CLI(settings);

  // ## Services
  // TODO: reconcile API wth @fabric/doorman as appears at: https://github.com/FabricLabs/doorman
  // chat._registerService('matrix', Matrix);
  // chat._registerService('rpg', RPG);

  await chat.start();
}

// Module
module.exports = OP_CHAT;
