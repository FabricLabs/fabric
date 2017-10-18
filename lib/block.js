'use strict';

var util = require('util');
var crypto = require('crypto');

function Block (data) {
  this['@data'] = data || {};

  this.clock = 0;
  this.stack = [];

  this.init();
}

/*Block.prototype.compute = function mine () {
  this.clock += 1;
  var self = this;

  self['@data']['type'] = 'Block';
  self['@data']['proof'] = crypto.randomBytes(256).toString('hex'); // lol

  self._sign();

  return self;
};*/

util.inherits(Block, require('./vector'));

module.exports = Block;
