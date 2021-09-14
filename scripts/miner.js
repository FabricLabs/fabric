'use strict';

const BLOCK_INTERVAL = process.env.BLOCK_INTERVAL || 60000;

const Bitcoin = require('../services/bitcoin');
const settings = require('../settings/local');

async function main (input = {}) {
  const bitcoin = new Bitcoin(input);

  bitcoin.on('message', async function (msg) {
    console.log('[SCRIPTS:BITCOIN]', 'Received message:', msg);
  });

  await bitcoin.start();

  setInterval(() => {
    bitcoin.generateBlock();
  }, BLOCK_INTERVAL);
}

main(settings).catch((E) => {
  console.error('[ALERT]', 'Service threw exception:', E);
});
