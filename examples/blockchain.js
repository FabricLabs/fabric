var Block = require('../lib/block');
var Chain = require('../lib/chain');

var genesis = require('../data/block');

var chain = new Chain();
var block = new Block(genesis);

chain.append(block);

chain.mine();

chain.compute();

console.log('chain:', chain);
