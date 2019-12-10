'use strict';

require('debug-trace')({ always: true });

const Fabric = require('../');
const Bitcoin = require('../services/bitcoin');
const Wallet = require('../types/wallet');

async function main () {
  let fabric = new Fabric();
  let bitcoin = new Bitcoin({ network: 'regtest' });
  // let wallet = new Wallet();

  bitcoin.on('message', function (msg) {
    console.log('[DEVELOP]', 'Bitcoin emitted message:', msg);
  });

  // fabric.use(bitcoin);
  await bitcoin.start();
  // await wallet.start();

  // TODO: import these into core process logic
  // await wallet._scanChainForTransactions(bitcoin.blockchain);

  // console.log('fabric:', fabric);
  console.log('bitcoin state:', bitcoin.state);
  // console.log('wallet state:', wallet.state);
}

module.exports = main();