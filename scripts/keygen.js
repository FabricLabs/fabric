'use strict';

const Wallet = require('../types/wallet');

async function main () {
  const wallet = new Wallet();
  const seed = await wallet._createFromFreshSeed();
  const keypair = await wallet.generateCleanKeyPair();
  console.warn('[FABRIC:KEYGEN]', 'Key generated (public):', keypair.public ? keypair.public.toString('hex') : keypair);
  console.warn('[FABRIC:KEYGEN]', 'SEED PHRASE:', seed.phrase);
  process.exit();
}

main().catch((E) => {
  console.error('[FABRIC:KEYGEN]', 'Key generator threw Exception:', E);
});
