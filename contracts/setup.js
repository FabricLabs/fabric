/**
 * OP_SETUP () : Configures the environment for Fabric.
 */

// Dependencies
const Wallet = require('../types/wallet');

// Program Definition
async function OP_SETUP (command = {}) {
  // TODO: replicate this program in C / ASM
  if (this.environment.wallet && !this.program.force) {
    console.warn('[FABRIC:CLI]', 'Wallet file exists, no data will be written.  Use --force to override.');
    console.warn('[FABRIC:CLI]', '[WARNING]', '--force DESTROYS ALL DATA: DOUBLE-CHECK YOUR BACKUPS!');
    console.warn('[FABRIC:CLI]', 'EXISTING_XPUB_PUBLIC', '=', this.environment.wallet.key.xpub);
  } else {
    console.log('[FABRIC:CLI]', 'No wallet found!  Generating new seed...');

    const seed = Wallet.createSeed(this.program.passphrase);
    const wallet = Wallet.fromSeed(seed);

    console.warn('[FABRIC:CLI]', '---');
    console.warn('[FABRIC:CLI]', '[!!!]', 'WARNING!', 'TOXIC WASTE BELOW', '[!!!]');
    console.warn('[FABRIC:CLI]', '[!!!]', 'The below is PRIVATE KEY MATERIAL, which can be used to');
    console.warn('[FABRIC:CLI]', '[!!!]', 'spend funds from this wallet & deanonymize historical transactions.');
    console.warn('[FABRIC:CLI]', '[!!!]', 'DO NOT DISTRIBUTE', '[!!!]');
    console.warn('[FABRIC:CLI]', '---');

    // ### [!!!] Toxic Waste [!!!]
    // TODO: remove from log output...
    console.warn('[FABRIC:CLI]', `Your seed phrase:\n\n${seed.phrase}\n`);
    console.warn('[FABRIC:CLI]', `Your master key: ${seed.master}`);
    console.warn('[FABRIC:CLI]', `Your master xprv: ${seed.xprv}`);

    // Save file
    this.environment.setWallet(wallet, true);

    console.warn('[FABRIC:CLI]', `The private key for your seed phrase has been saved to your wallet: ${wallet.WALLET_FILE}`);
    console.warn('[FABRIC:CLI]', 'All done!  You can now run the `fabric` command to launch your node.');

    // Report to console
    // Load Keys, etc.
    wallet.start();

    // Debug output
    console.debug(`Wallet: [${(wallet) ? wallet.id : 'unknown' }]:`, wallet.export());
    console.debug(`Wallet State:`, wallet.state);
    console.debug(`Wallet Keys:`, wallet.state.keys);
  }

  // Success!
  return JSON.stringify({ wallet: this.environment.wallet.id });
}

// Module
module.exports = OP_SETUP;
