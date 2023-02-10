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
    console.error('No wallet found!  Set up your Fabric wallet by running:');
    console.error('\tfabric setup');
    process.exit(1);
  }

  // Fabric CLI
  const chat = new CLI(settings); // TODO: this.settings

  // Use local wallet
  chat.attachWallet(this.environment.wallet);

  // Assume identity
  // TODO: remove, re-work Peer and Wallet key import in CLI
  chat.assumeIdentity(this.environment.wallet.settings.key);

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
