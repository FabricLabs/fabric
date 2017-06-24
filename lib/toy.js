'use strict';
// TODO: switch this to an API
// given a...
var a = require('../data/fabric');
// and new b...
var b = require('../data/z');

var CLI = require('../lib/cli');
var cli = new CLI(a);

var Vector = require('../lib/vector');
var Fabric = require('../lib/fabric');
var Peer = require('../lib/peer');

// compute the next step (sum the vectors using our proof of work)
var truth = new Vector(a);
var proposal = new Vector(b);
var expectation = 0; // zero-sum game

//console.log('[TOY]', 'starting...', truth.id);
//console.log('[TOY]', 'computing +', proposal.id);

var result = truth.compute(proposal);
var data = result['@data'];

//console.log('[TOY]', 'result:', data['@id']);

data['peers'].forEach(function(peer) {
  var channel = new Peer(peer);
  var n = channel.compute();
  //console.log('[TOY]', 'n', n);
});

module.exports = Fabric;
