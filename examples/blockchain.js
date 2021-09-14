'use strict';

const MAX_BLOCK_COUNT = 9;

const Block = require('../types/block');
const Chain = require('../types/chain');

const genesis = require('../assets/genesis');

async function main () {
  const chain = new Chain(genesis);

  for (let i = 0; i < MAX_BLOCK_COUNT; i++) {
    // Mine a block
    await chain.mine();
  }

  return chain.toString();
}

main().catch((exception) => {
  console.error('[EXAMPLES:BLOCKCHAIN]', exception);
}).then((output) => {
  console.log('[EXAMPLES:BLOCKCHAIN]', 'Output:', output);
});
