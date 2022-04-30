'use strict';

const settings = require('../settings/local');

const BTCA = require('../settings/node-a');
const BTCB = require('../settings/node-b');

const Chain = require('../types/chain');
const Node = require('../types/node');
const Bitcoin = require('../services/bitcoin');

async function main (input = {}) {
  const chain = new Chain();

  const btca = new Bitcoin(BTCA);
  const btcb = new Bitcoin(BTCB);

  await btca.start();
  await btcb.start();

  await chain.start();

  return {
    assets: {
      BTCA: btca.id,
      BTCB: btcb.id
    },
    chain: chain
  };
}

main(settings).catch((exception) => {
  console.error('[SCRIPTS:METACHAIN]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:METACHAIN]', 'Main Process Output:', output);
});
