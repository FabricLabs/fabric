'use strict';

const Chain = require('../lib/chain');
const chain = new Chain();

async function main () {
  await chain.storage.open();

  chain.on('block', function (block) {
    console.log('[CHAIN]', 'new block:', block);
    console.log('[CHAIN]', 'chain:', chain);
  });

  chain.append({ test: 'foo' });
  chain.append({ test: 'bar' });

  await chain.storage.close();

  return this;
}

main();
