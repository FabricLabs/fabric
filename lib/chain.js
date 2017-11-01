'use strict';

var util = require('util');
var crypto = require('crypto');

var jsonpatch = require('fast-json-patch');
var level = require('level');
var async = require('async');

var StateMachine = require('javascript-state-machine');
var StateMachineHistory = require('javascript-state-machine/lib/history')
var Digraph = require('javascript-state-machine/lib/visualize');

var Ledger = require('./ledger');
var Block = require('./block');
var Store = require('./store');
var Challenge = require('./challenge');

function Chain (genesis) {
  this['@data'] = [];

  this.clock = 0;
  this.stack = [];
  this.known = {};
  this.store = new Store();
  this.blocks = [];
  
  this.genesis = null;
  this.tip = null;
  
  this.indexes = {
    blocks: '/blocks'
  };

  this.ledger = new Ledger();
  this.init();
}

util.inherits(Chain, require('./vector'));

Chain.prototype._load = async function () {
  var self = this;
  var blocks = await self.store.get(self.indexes.blocks);
  
  self['@data'] = JSON.parse(blocks);
  
  self._sign();
  
  return self;
};

Chain.prototype._flush = async function () {
  var self = this;
  self['@data'] = [];
  await self.store.set(self.indexes.blocks, []);
  
  return self;
};

Chain.prototype._listBlocks = async function listBlocks () {
  var self = this;
  var blocks = await self.store.get(self.indexes.blocks);
  console.log(blocks);
};

Chain.prototype._produceBlock = function mine () {
  var block = new Block();
  return block.compute();
};

Chain.prototype.identify = function register (identity) {
  this.identity = identity;
};

Chain.prototype.append = async function add (block) {
  var self = this;

  if (self['@data'].length === 0 && !self.genesis) {
    self.genesis = block['@id'];
  }

  var key = '/blocks/' + block['@id'];
  // TODO: use async.waterfall (for now)
  // TODO: define rule: max depth 2 callbacks before flow control
  var err = await self.store.set(key, block['@data']);

  self.stack.push(['validate', block['@id']]);
  self.known[block['@id']] = block['@data'];

  self['@data'].push(block);
  //console.log('[CHAIN]', 'chain stack (now):', self.stack);
  var list = self['@data'].map(function (block) {
    return block['@id'];
  });

  await self.store.set(self.indexes.blocks, list);

  self.blocks.push(block);
  self.emit('block', block['@id'], block['@data']);
}

Chain.prototype.test = function validate (proof) {
  var self = this;
  if (proof['@id'] !== self['@id']) return false;
  return true;
};

Chain.prototype.patch = function apply (patchset) {
  var self = this;
  var test = jsonpatch.applyPatch(self['@data'], patchset).newDocument;
  return self;
}

Chain.prototype.render = function serialize () {
  var self = this;

  return self;
}

module.exports = Chain;
