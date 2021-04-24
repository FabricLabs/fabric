'use strict';

// Fabric Types
const CLI = require('../types/cli');

// Program Definition
async function OP_CHAT () {
  // Configure Earning
  if (this.earn) {
    console.log('learning enabled');
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
