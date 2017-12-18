'use strict';

var Block = require('../lib/block');
var Chain = require('../lib/chain');

var genesis = require('../data/block');

var chain = new Chain();
var max = 2;

chain.on('candidate', async function (block) {
  console.log('chain received candidate block:', block);

  var candidate = new Block(block['@data']);
  var isValid = candidate.validate();

  candidate.compute();

  console.log('isValid:', isValid);

  if (!isValid) {
    // TODO: disconnect peers
    return false;
  }

  await chain.append(candidate);

  console.log('chain length:', chain['@data'].length);

  if (typeof heapdump !== 'undefined') {
    heapdump.writeSnapshot(function (err, filename) {
      console.log('dump written to', filename);
    });
  }

  if (chain['@data'].length < max) {
    await chain.mine();
  } else {
    console.log('Chain filled!');
    console.log('Chain:', chain);
  }
});

main();

async function main () {
  var start = new Block(genesis);

  start.compute();

  await chain.append(start);

  console.log('computing... stack:', chain.stack);
  chain.compute();
  console.log('compute done.');

  console.log('starting... chain:', chain['@id']);
  console.log('mining...');

  await chain.mine();

  console.log('chain id:', chain['@id']);
}
