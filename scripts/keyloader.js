'use strict';

const Wallet = require('../types/wallet');
const SEED = process.env.FABRIC_SEED;

async function main () {
  let wallet = new Wallet();
  let seed = await wallet._importSeed(SEED);
  let keypair = await wallet.generateCleanKeyPair();
  console.warn('[FABRIC:KEYLOADER]', 'Key imported:', keypair);
  console.warn('[FABRIC:KEYLOADER]', 'SEED:', seed);
  process.exit();
}

main().catch((E) => {
  console.error('[FABRIC:KEYLOADER]', 'Key loader threw Exception:', E);
});
