'use strict';

var util = require('util');
var Validator = require('./validator');

function Block (data) {
  this['@data'] = data || {};

  this.clock = 0;
  this.stack = [];

  this.validator = new Validator({
    type: 'object',
    properties: {
      parent: { type: 'string' }
    },
    required: ['parent']
  });

  this.init();
}

Block.prototype.validate = function () {
  console.log('[BLOCK]', 'validate', this['@data']);
  var isValid = this.validator.validate(this['@data']);

  if (!isValid) {
    console.error('[BLOCK]', 'invalid', 'object', this['@data'], 'errors:', this.validator.functor.errors);
  }

  return isValid;
};

util.inherits(Block, require('./vector'));

module.exports = Block;
