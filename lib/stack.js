'use strict';

const crypto = require('crypto');
const State = require('./state');

const MAX_STACK_HEIGHT = 32; // max height of stack (number of elements)
const MAX_FRAME_SIZE = 32; // max size of a stack frame in bytes
const MAX_MEMORY_ALLOC = MAX_STACK_HEIGHT * MAX_FRAME_SIZE;

class Stack extends State {
  constructor (config) {
    super(config);

    this.size = MAX_STACK_HEIGHT;
    this.frame = Buffer.alloc(MAX_FRAME_SIZE);

    this['@data'] = [];
    this['@id'] = this.id;

    return this;
  }

  push (data) {
    let state = new State(data);
    let stack = this['@data'] || [];

    state['@type'] = 'Stack';

    // write the frame
    this.frame.write(state.id);

    // push date into state
    this['@data'].push(this.frame);
    this['@type'] = 'Buffer';
    this['@size'] = stack.length;
    this['@pure'] = Buffer.concat(this['@data']);

    this.commit();

    return state;
  }

  asArray () {
    return Array.from(this['@data']);
  }

  snapshot () {
    return this.id || { '@id': `${crypto.createHash('sha256').update(JSON.stringify(this.state['@data'])).digest('hex')}` };
  }

  commit () {
    let stack = this;
    let changes = super.commit();

    if (changes.length) {
      let data = Object.assign({}, {
        parent: stack.tip,
        changes: changes
      });

      stack.state['@data'] = data;
      stack.history.push(stack.state.id);
    }

    // TODO: return Transaction
    return changes;
  }
}

module.exports = Stack;
