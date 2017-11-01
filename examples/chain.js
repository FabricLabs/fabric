var namespace = 'playnet';

var Block = require('../lib/block');
var Chain = require('../lib/chain');
var Transaction = require('../lib/transaction');

var block = new Block(); // linked list
var chain = new Chain(); // secured tree
var ledger = chain.ledger; // simple list

/*
var Challenge = require('../lib/challenge');
var validator = new Challenge({
  state: 'closed'
});
var validator = new Challenge();

//chain.pre('patch', validator.validate);
function Verify () {}
Verify.prototype.compute = function step (state) {}
require('util').inherits(Verify, require('../lib/vector'));
*/

chain.use('genesis', function genesis (input) {
  var out = 'omega';
  console.log('genesis('+input+') -> ', out);
  return out;
});

chain.use('finalize', function finalize () {
  return 'omega';
});

chain.use('goto', function goto (x) {
  return x;
});

chain.on('transaction', function(tx) {
  console.log('[CHAIN]', 'NOOP', 'TRANSACTION:', tx);
});

chain.on('patch', function(x) {
  console.log('[CHAIN]', 'NOOP',  'event', '"patch"', x.steps[0]);
});

ledger.on('mutation', function(mutation) {
  console.log('[LEDGER]', 'NOOP', 'mutation:', mutation, this._serialize());
});

ledger.on('transaction', function(tx) {
  var self = this;
  tx.compute();
  console.log(tx);
  chain.append(tx);
});

// begin
var tx0 = new Transaction({
  name: 'genesis',
  outputs: ['omega']
});
//var tx1 = new Transaction({ id: 1 });
//var tx2 = new Transaction({ id: 2 });
//var tx3 = new Transaction({ id: 3 });

tx0._sign();
//tx1._sign();
//tx2._sign();
//tx3._sign();

//console.log('tx0:', tx0);
//console.log('tx1:', tx1);
//console.log('tx2:', tx2);
//console.log('tx3:', tx3);

// TODO: uncomment, use
//ledger.append(tx0); // local ledger, consensus chain


//ledger.append(tx1);
//ledger.append(tx2);
//ledger.append(tx3);

//chain.compute();
//chain.compute();
//chain.compute();
//chain.compute();

/*
var block1 = chain._produceBlock().compute();
var block2 = new Block({
  parent: block1['@id']
});
block2.compute();

var block3 = new Block({
  parent: block2['@id']
});
block3.compute();

//chain.append(block1);
//chain.append(block2);
//chain.append(block3);
*/

var output = chain.compute();

//console.log('output (LEDGER):', ledger);
//console.log('output (TXS):', ledger['@data']);

chain.on('mutation', function(ops) {
  //console.log('mutation:', ops);
});


chain._listBlocks(function(err, blocks) {
  console.log('output (CHAIN):', output['@id']);
  console.log('REPLAY:', 'blocks', blocks);

  var known = {};

  blocks.forEach(function(id) {
    chain.store.get('/blocks/' + id, function(err, block) {
      known[block['@id']] = block['@data'];
      
      console.log('known:', known);
    });
  });
  
});
