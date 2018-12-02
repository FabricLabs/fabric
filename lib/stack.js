'use strict';

const crypto = require('crypto');
const State = require('./state');

const MAX_STACK_HEIGHT = 32; // max height of stack (number of elements)
const MAX_FRAME_SIZE = 32; // max size of a stack frame in bytes
const MAX_MEMORY_ALLOC = MAX_STACK_HEIGHT * MAX_FRAME_SIZE;

class Stack extends State {
  constructor (config) {
    super(config);

    this.limit = MAX_MEMORY_ALLOC;
    this.frame = Buffer.alloc(MAX_FRAME_SIZE);
    this.config = Object.assign({}, config);

    this['@type'] = this.config['@type'];
    this['@data'] = [];

    if (config instanceof Array) {
      for (let i in config) {
        this.push(config[i]);
      }
    }

    // this['@id'] = this.id;

    return this;
  }

  /**
   * Push data onto the stack.  Changes the {@link Stack#frame} and
   * {@link Stack#id}.
   * @param  {Mixed} data Treated as a {@link State}.
   * @return {Number}      Resulting size of the stack.
   */
  push (data) {
    let state = new State(data);

    // console.log('[STACK]', 'push()', 'input data:', `<${data.constructor.name}>`, data, `[${state.id}]`);
    // console.log('[STACK]', 'push()', 'writing frame:', Buffer.from(state.id, 'hex'));

    // write the frame
    // NOTE: no garbage collection
    this.frame.write(state.id, 'hex');

    // push frame onto stack
    this['@data'].push(this.frame);
    this['@type'] = 'Stack';
    this['@size'] = this['@data'].length * MAX_FRAME_SIZE;
    this['@pure'] = Buffer.concat(this['@data']);

    this.commit();

    return this['@data'].length;
  }

  pop () {
    return this['@data'].pop().toString('hex');
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
