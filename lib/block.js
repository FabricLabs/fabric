'use strict';

const State = require('./state');

class Block extends State {
  constructor (data) {
    super(data);

    this['@data'] = Object.assign({}, data);
    this['@data']['@type'] = 'Block';

    this['@id'] = this.id;

    return this;
  }

  validate () {
    this.log('[BLOCK]', 'validate', this['@data']);
    this.log('Not yet implemented: Block.validate()');
  }
}

module.exports = Block;
