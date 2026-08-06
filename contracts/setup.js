/**
 * OP_SETUP () : Configures the environment for Fabric.
 */

'use strict';

// Dependencies
const Wallet = require('../types/wallet');

function debugEnabled () {
  const v = process.env.FABRIC_DEBUG;
  return v === '1' || v === 'true';
}

// Program Definition
async function OP_SETUP (command = {}) {
  // TODO: replicate this program in C / ASM
  const opts = (this.program && typeof this.program.opts === 'function')
    ? this.program.opts()
    : {};
  const force = !!(this.program && (this.program.force || opts.force));
  const passphrase = (this.program && this.program.passphrase != null)
    ? this.program.passphrase
    : (opts.passphrase || '');

  if ((this.environment.wallet || this.environment.walletExists()) && !force) {
    console.warn('[FABRIC:CLI]', 'Wallet already configured; no data will be written. Use --force to override.');
    console.warn('[FABRIC:CLI]', '[WARNING]', '--force DESTROYS ALL DATA: DOUBLE-CHECK YOUR BACKUPS!');
    if (this.environment.wallet && this.environment.wallet.key) {
      console.warn('[FABRIC:CLI]', 'EXISTING_XPUB_PUBLIC', '=', this.environment.wallet.key.xpub);
    } else {
      console.warn('[FABRIC:CLI]', `Existing wallet file: ${this.environment.WALLET_FILE}`);
    }
  } else {
    console.log('[FABRIC:CLI]', 'Generating a new seed…');

    const seed = Wallet.createSeed(passphrase);
    const wallet = Wallet.fromSeed(seed);

    console.warn('[FABRIC:CLI]', '---');
    console.warn('[FABRIC:CLI]', '[!!!]', 'WARNING!', 'TOXIC WASTE BELOW', '[!!!]');
    console.warn('[FABRIC:CLI]', '[!!!]', 'The seed phrase is PRIVATE KEY MATERIAL.');
    console.warn('[FABRIC:CLI]', '[!!!]', 'Anyone with it can spend funds and deanonymize history.');
    console.warn('[FABRIC:CLI]', '[!!!]', 'Write it down offline. DO NOT DISTRIBUTE.', '[!!!]');
    console.warn('[FABRIC:CLI]', '---');
    console.warn('[FABRIC:CLI]', `Your seed phrase:\n\n${seed.phrase}\n`);

    // Save file
    this.environment.setWallet(wallet, true);
    wallet.start();

    const walletPath = this.environment.WALLET_FILE;
    console.log('[FABRIC:CLI]', 'Wallet id:', wallet.id);
    console.log('[FABRIC:CLI]', 'XPUB (public):', seed.xpub || (wallet.key && wallet.key.xpub));
    console.log('[FABRIC:CLI]', 'Saved to:', walletPath);
    console.log('[FABRIC:CLI]', 'Next: run `fabric` to open the shell.');

    if (debugEnabled()) {
      console.warn('[FABRIC:CLI]', `Your master key: ${seed.master}`);
      console.warn('[FABRIC:CLI]', `Your master xprv: ${seed.xprv}`);
      console.debug('[FABRIC:CLI]', 'Wallet export:', wallet.export());
      console.debug('[FABRIC:CLI]', 'Wallet state:', wallet.state);
      console.debug('[FABRIC:CLI]', 'Wallet keys:', wallet.state.keys);
    }
  }

  // Success!
  return JSON.stringify({ wallet: this.environment.wallet && this.environment.wallet.id });
}

// Module
module.exports = OP_SETUP;
