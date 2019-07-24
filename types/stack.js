'use strict';

const {
  MAX_MEMORY_ALLOC,
  MAX_FRAME_SIZE
} = require('../constants');

const State = require('./state');
const { MerkleTree } = require('merkletreejs');

/**
 * Manage stacks of data.
 */
class Stack extends State {
  /**
   * Create a {@link Stack} instance.
   * @param  {Array}  [list=[]] Genesis state for the {@link Stack} instance.
   * @return {Stack}            Instance of the {@link Stack}.
   */
  constructor (list = []) {
    super(list);

    this.limit = MAX_MEMORY_ALLOC;
    this.frame = Buffer.alloc(MAX_FRAME_SIZE);
    this.config = list || [];

    this['@type'] = this.config['@type'];
    this['@entity'].frames = {};
    this['@entity'].states = {};
    this['@states'] = {};
    this['@data'] = [];

    if (list instanceof Array) {
      for (let i in list) {
        this.push(list[i]);
      }
    }

    this['@entity']['@type'] = this['@type'];
    this['@entity']['@data'] = this['@data'];
    this['@id'] = this.id;

    return this;
  }

  get size () {
    return this['@data'].length;
  }

  /**
   * Push data onto the stack.  Changes the {@link Stack#frame} and
   * {@link Stack#id}.
   * @param  {Mixed} data Treated as a {@link State}.
   * @return {Number}      Resulting size of the stack.
   */
  push (data) {
    let state = new State(data);

    this['@entity'].states[this.id] = this['@data'];
    this['@entity'].states[state.id] = state['@data'];
    this['@entity'].frames[this.id] = this['@data'];
    this['@entity'].frames[state.id] = state['@data'];

    // write the frame
    // NOTE: no garbage collection
    this.frame = Buffer.from(state.id);

    // push frame onto stack
    this['@data'].push(this.frame);
    this['@type'] = 'Stack';
    this['@size'] = this['@data'].length * MAX_FRAME_SIZE;

    this.commit();

    return this['@data'].length;
  }

  dedupe () {
    return new Stack([...new Set(this.asArray())]);
  }

  pop () {
    let element = this['@data'].pop();
    return element;
  }

  asArray () {
    return Array.from(this['@data']);
  }

  asMerkleTree () {
    return new MerkleTree(this.asArray(), this.sha256, {
      isBitcoinTree: true
    });
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
