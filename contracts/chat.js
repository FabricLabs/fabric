'use strict';

// Settings
const settings = require('../settings/local');

// Fabric Types
const CLI = require('../types/cli');

// Services
// const Matrix = require('@fabric/matrix');

// Program Definition
async function OP_CHAT () {
  if (!this.environment.wallet) {
    console.error('[FABRIC:OP_CHAT] No wallet found!  Set up your Fabric wallet by running:');
    console.error('\tfabric setup');
    process.exit(1);
  }

  // Merge CLI context settings into local settings
  const merged = Object.assign({}, settings, this.settings || {});
  const chat = new CLI(merged);

  chat.on('error', (error) => {
    console.error('[FABRIC:CHAT]', '[ERROR]', error);
  });

  chat.attachWallet(this.environment.wallet);
  chat.assumeIdentity(this.environment.wallet.settings.key);

  await chat.start();

  // ## Services
  // TODO: reconcile API wth @fabric/doorman as appears at: https://github.com/FabricLabs/doorman
  // chat._registerService('matrix', Matrix);
  // chat._registerService('rpg', RPG);

  return JSON.stringify({
    id: chat.id,
    wallet: this.environment.wallet.id
  });
}

// Module
module.exports = OP_CHAT;
