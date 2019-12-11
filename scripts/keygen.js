'use strict';

const Wallet = require('../types/wallet');

async function main () {
  let wallet = new Wallet();
  let seed = await wallet._createSeed();
  let keypair = await wallet.generateCleanKeyPair();
  console.warn('[FABRIC:KEYGEN]', 'Key generated:', keypair);
  console.warn('[FABRIC:KEYGEN]', 'SEED:', seed);
  process.exit();
}

main().catch((E) => {
  console.error('[FABRIC:KEYGEN]', 'Key generator threw Exception:', E);
});
