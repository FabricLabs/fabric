'use strict';

const Constants = require('./constants');
const State = require('./state');

class Stack extends State {
  constructor (config) {
    super(config);

    this.limit = Constants.MAX_MEMORY_ALLOC;
    this.frame = Buffer.alloc(Constants.MAX_FRAME_SIZE);
    this.config = config || [];

    this['@type'] = this.config['@type'];
    this['@entity'].frames = {};
    this['@states'] = {};
    this['@data'] = [];

    if (config instanceof Array) {
      for (let i in config) {
        this.push(config[i]);
      }
    }

    this['@entity']['@type'] = this['@type'];
    this['@entity']['@data'] = this['@data'];
    this['@id'] = this.id;

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

    this['@entity'].frames[this.id] = this['@data'];
    this['@entity'].frames[state.id] = state['@data'];

    // write the frame
    // NOTE: no garbage collection
    this.frame = Buffer.from(state.id);

    // push frame onto stack
    this['@data'].push(this.frame);
    this['@type'] = 'Stack';
    this['@size'] = this['@data'].length * Constants.MAX_FRAME_SIZE;

    this.commit();

    return this['@data'].length;
  }

  pop () {
    let element = this['@data'].pop();
    return element;
  }

  asArray () {
    return Array.from(this['@data']);
  }

  snapshot () {
    return this.id || { '@id': `${this.sha256(this.state['@data'])}` };
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
