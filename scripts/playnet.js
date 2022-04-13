'use strict';

const Bitcoin = require('../services/bitcoin');
const Environment = require('../types/environment');

const environment = new Environment();

const INTERVAL = 60000;
const settings = {
  seed: environment.readVariable('FABRIC_SEED'),
  bitcoin: {
    authority: 'http://ahp7iuGhae8mooBahFaYieyaixei6too:naiRe9wo5vieFayohje5aegheenoh4ee@localhost:20444'
  }
};

async function main (input = {}) {
  const bitcoin = new Bitcoin(input.bitcoin);
  await bitcoin.start();

  async function report () {
    const height = await bitcoin.getChainHeight();
    const balances = await bitcoin.getBalances();
    console.log('[FABRIC:PLAYNET] Current block height:', height);
    console.log('[FABRIC:PLAYNET] Current address:', bitcoin.addresses[0]);
    console.log('[FABRIC:PLAYNET] Spendable balance:', balances.trusted);
  }

  async function generate () {
    const block = await bitcoin.generateBlock(bitcoin.addresses[0].address);
    report();
  }

  await report();
  const agent = setInterval(generate, INTERVAL);
  return { id: bitcoin.id };
}

const safe = Object.assign({}, settings);
safe.seed = '*********************';
console.log('[FABRIC:PLAYNET] Settings:', safe);

main(settings).catch((exception) => {
  console.error('[FABRIC:PLAYNET] Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:PLAYNET] Main Process Output:', output);
});
