'use strict';

var namespace = 'playnet';

var crypto = require('crypto');

var Block = require('../lib/block');
var Chain = require('../lib/chain');
var Ledger = require('../lib/ledger');
var Transaction = require('../lib/transaction');

var block = new Block(); // linked list
var chain = new Chain(); // secured tree
var ledger = new Ledger(); // simple list

var proof = {};
var output = chain.compute();


//console.log('output (LEDGER):', ledger);
//console.log('output (TXS):', ledger['@data']);

output.on('mutation', function (ops) {
  console.log('mutation:', ops);
  output.patch(ops);
});

output.on('block', function validateBlock (id, block) {
  console.log('[EVENT]', '[BLOCK]', 'incoming:', id, block);
  console.log('chain height (before):', output['@data'].length);

  proof[id] = block;
  console.log('proof', proof);
  
  chain.compute();
  
  console.log('chain height (after):', output['@data'].length);

});

output.on('mutation', function (mutation) {
  console.log('[EXAMPLE]', 'mutated:', mutation);
  
  ledger.patch(mutation);
  ledger.compute();
  
  console.log('[EXAMPLE]', ledger);
  
  console.log('tests:', proof, output.test(proof));
});


/* blocks.forEach(function (id) {
  output.store.get('/blocks/' + id, function (err, block) {
    known[block['@id']] = block['@data'];
    //console.log('known block:', known);
  });
}); */


async function init () {
  var known = {};
  var genesis = new Block({
    name: 'genesis',
    entropy: crypto.randomBytes(8).toString('hex')
  });
  
  genesis.compute();
  await chain.append(genesis);

  /*/var num = 0;

  /**/
  var num = 3;
  var last = genesis['@id'];
  for (var i = 0; i < num; i++) {
    var block = new Block({
      parent: last,
      entropy: crypto.randomBytes(8).toString('hex')
    });
    block.compute();
    last = block['@id'];
    await chain.append(block);
  }/**/

  chain.compute();

  chain._listBlocks();

  console.log('chain:', chain);
}

init();
