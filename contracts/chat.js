'use strict';

// Settings
const defaults = require('../settings/default');
const playnet = require('../settings/playnet');

const settings = {
  listen: true,
  // sideload playnet
  peers: [].concat(playnet.peers),
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
const Bitcoin = require('../services/bitcoin');
const Matrix = require('../services/matrix');

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
  chat._registerService('bitcoin', Bitcoin);
  // chat._registerService('matrix', Matrix);
  // chat._registerService('rpg', RPG);

  await chat.start();
}

// Module
module.exports = OP_CHAT;
