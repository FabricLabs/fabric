'use strict';

// Settings
const settings = require('../settings/local');

// Fabric Types
const CLI = require('../types/cli');

// Program Definition
async function OP_SHELL () {
  if (!this.environment.wallet) {
    throw new Error('[FABRIC:SHELL] No wallet found. Run `fabric setup` first.');
  }

  // Merge CLI context settings into local settings
  const merged = Object.assign({}, settings, this.settings || {});
  const shell = new CLI(merged);

  shell.on('error', (error) => {
    console.error('[FABRIC:SHELL]', '[ERROR]', error);
  });

  shell.attachWallet(this.environment.wallet);
  shell.assumeIdentity(this.environment.wallet.settings.key);

  await shell.start();

  return JSON.stringify({
    id: shell.id,
    wallet: this.environment.wallet.id
  });
}

module.exports = OP_SHELL;
