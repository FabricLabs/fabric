'use strict';

const Vector = require('./vector');

class Block extends Vector {
  constructor (data) {
    super(data);
    this['@data'] = data || {};

    this.clock = 0;
    this.stack = [];

    /* this.validator = new Validator({
      type: 'object',
      properties: {
        parent: { type: 'string' }
      },
      required: ['parent']
    }); */

    this.init();
  }
}

Block.prototype.validate = function () {
  console.log('[BLOCK]', 'validate', this['@data']);
  this.log('Not yet implemented: Block.validate()');
};

module.exports = Block;
