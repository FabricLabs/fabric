'use strict';

const Bitcoin = require('../services/bitcoin');
const config = {
  fullnode: true,
  network: 'regtest',
  // network: 'main',
  verbosity: 4
};

async function main () {
  let bitcoin = new Bitcoin(config);

  bitcoin.on('message', async function (msg) {
    console.log('[SCRIPTS:BITCOIN]', 'Received message:', msg);
  });

  await bitcoin.start();
}

main().catch((E) => {
  console.error('[ALERT]', 'Service threw exception:', E);
});
