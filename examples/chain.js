'use strict';

// Fabric Dependencies
const Chain = require('../types/chain');
const chain = new Chain();

async function main () {
  await chain.start();

  chain.on('block', function (block) {
    console.log('[CHAIN]', 'new block:', block);
    console.log('[CHAIN]', 'chain:', chain);
  });

  await chain.append({ test: 'foo' });
  await chain.append({ test: 'bar' });

  await chain.stop();

  return chain;
}

main().catch((exception) => {
  console.error('[EXAMPLES:CHAIN]', 'Main Process Exception:', exception);
});
