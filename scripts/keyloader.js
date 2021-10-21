'use strict';

const Wallet = require('../types/wallet');
const SEED = process.env.FABRIC_SEED;

async function main () {
  const wallet = new Wallet();
  const seed = await wallet._importSeed(SEED);
  const keypair = await wallet.generateCleanKeyPair();
  console.warn('[FABRIC:KEYLOADER]', 'Key imported:', keypair);
  console.warn('[FABRIC:KEYLOADER]', 'SEED:', seed);
  process.exit();
}

main().catch((E) => {
  console.error('[FABRIC:KEYLOADER]', 'Key loader threw Exception:', E);
});
