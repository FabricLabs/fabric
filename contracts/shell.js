'use strict';

const { loadLocalSettings } = require('../functions/loadLocalSettings');
const settings = loadLocalSettings();

// Fabric Types
const CLI = require('../types/cli');

// Program Definition
async function OP_SHELL () {
  if (!this.environment.wallet && !this.environment.walletLocked) {
    throw new Error('[FABRIC:SHELL] No wallet found. Run `fabric setup` first.');
  }

  // Merge CLI context settings into local settings
  const merged = Object.assign({}, settings, this.settings || {});
  const shell = new CLI(merged);

  shell.on('error', (error) => {
    console.error('[FABRIC:SHELL]', '[ERROR]', error);
  });

  shell.operatorEnvironment = this.environment;
  if (this.environment.wallet) {
    shell.attachWallet(this.environment.wallet);
    shell.assumeIdentity(this.environment.wallet.settings.key);
  } else if (this.environment.walletPublic && this.environment.walletPublic.xpub) {
    const Key = require('../types/key');
    shell.assumeIdentity(new Key({ xpub: this.environment.walletPublic.xpub }));
  }

  this.environment.lockSession.on('lock', () => {
    shell._appendWarning('Identity locked after idle timeout. Use /unlock to continue.');
  });
  this.environment.lockSession.on('unlock', () => {
    if (this.environment.wallet) {
      shell.attachWallet(this.environment.wallet);
      shell.assumeIdentity(this.environment.wallet.settings.key);
    }
  });

  await shell.start();

  return JSON.stringify({
    id: shell.id,
    wallet: this.environment.wallet && this.environment.wallet.id,
    locked: !!this.environment.walletLocked
  });
}

module.exports = OP_SHELL;
