/**
 * OP_SETUP () : Configures the environment for Fabric.
 */

// Dependencies
const crypto = require('crypto');

// Program Definition
async function OP_SETUP (command = {}) {
  this.start();

  // Report to console
  console.log(`Wallet: [${(this.wallet) ? this.wallet.id : 'unknown' }]:`, this.wallet.export());
  console.log(`Wallet State:`, this.wallet.state);
  console.log(`Wallet Keys:`, this.wallet.state.keys);

  // Success!
  return 1;
}

// Module
module.exports = OP_SETUP;
