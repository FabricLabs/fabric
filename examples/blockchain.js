'use strict';

const Block = require('../types/block');
const Chain = require('../types/chain');

const genesis = require('../assets/block');

async function main () {
  let chain = new Chain();

  chain.on('candidate', async function (block) {
    console.log('chain received candidate block:', block);

    let candidate = new Block(block);
    let isValid = candidate.validate();

    candidate.compute();

    console.log('isValid:', isValid);

    if (!isValid) {
      // TODO: disconnect peers
      return false;
    }

    await chain.append(candidate);

    console.log('chain length:', chain['@data'].length);

    if (chain['@data'].length < max) {
      await chain.mine();
    } else {
      console.log('Chain filled!');
      console.log('Chain:', chain);
    }
  });

  let start = new Block(genesis);
  await chain.append(start);

  console.log('starting... chain:', chain['@id']);
  console.log('mining...');

  await chain.mine();

  console.log('chain id:', chain['@id']);
}

main();
