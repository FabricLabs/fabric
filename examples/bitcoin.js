'use strict';

require('debug-trace')({ always: true });

const Fabric = require('../');
const Bitcoin = require('../services/bitcoin');

async function main () {
  const fabric = new Fabric();
  const bitcoin = new Bitcoin({ network: 'regtest' });

  // Listen for messages from the Bitcoin service
  bitcoin.on('message', function (msg) {
    console.log('[DEVELOP]', 'Bitcoin emitted message:', msg);
  });

  // Use the Bitcoin service in the Fabric instance
  fabric.use(bitcoin);

  // Start the Bitcoin service
  await bitcoin.start();

  // TODO: import these into core process logic
  // await wallet._scanChainForTransactions(bitcoin.blockchain);

  // console.log('fabric:', fabric);
  console.log('bitcoin state:', bitcoin.state);
  // console.log('wallet state:', wallet.state);

  await bitcoin.stop();
}

if (require.main === module) {
  main().catch((exception) => {
    console.error('[EXAMPLES:BITCOIN]', 'Main Process Exception:', exception);
    process.exitCode = 1;
  });
}
