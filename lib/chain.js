'use strict';

const Block = require('./block');
const Ledger = require('./ledger');
const Storage = require('./storage');
const Vector = require('./vector');
const Worker = require('./worker');

const monitor = require('fast-json-patch');

class Chain extends Vector {
  /**
   * Holds an immutable chain of events.
   * @param       {Vector} genesis Initial state for the chain of events.
   * @constructor
   */
  constructor (genesis) {
    super(genesis);

    this.blocks = [];
    this['@data'] = [];

    this.genesis = null;
    this.tip = null;

    // TODO: set this up via define?
    this.indexes = {
      blocks: '/blocks',
      transactions: '/transactions'
    };

    this.ledger = new Ledger();
    this.storage = new Storage({ path: './data/chain' });

    this.init();

    return this;
  }

  async stop () {
    await this.storage.close();
    return this;
  }
}

Chain.prototype._load = async function () {
  let self = this;

  let query = await this.storage.get('/blocks');
  let response = new Vector(query)._sign();

  self['@data'] = response['@data'];
  self._sign();

  return self;
};

Chain.prototype._flush = async function () {
  let self = this;
  self['@data'] = [];
  await self.storage.set(self.indexes.blocks, []);
  return self;
};

Chain.prototype._listBlocks = async function listBlocks () {
  let self = this;
  let blocks = await self.storage.get(self.indexes.blocks);

  return blocks;
};

Chain.prototype._produceBlock = function mine () {
  let block = new Block();
  return block.compute();
};

Chain.prototype.identify = function register (identity) {
  this.identity = identity;
};

Chain.prototype.append = async function add (block) {
  let self = this;

  if (!block['@id'] && !block['@data']) {
    block = new Vector(block);
    block._sign();
  }

  if (self['@data'].length === 0 && !self.genesis) {
    self.genesis = block['@id'];
    self.tip = block['@id'];
  }

  let key = [self.indexes.blocks, block['@id']].join('/');
  // TODO: use async.waterfall (for now)
  // TODO: define rule: max depth 2 callbacks before flow control
  let err = await self.storage.set(key, block['@data']);

  self.stack.push(['validate', block['@id']]);
  self.known[block['@id']] = block['@data'];

  self['@data'].push(block['@id']);

  await self.storage.set(self.indexes.blocks, self['@data']);

  self.blocks.push(block);
  self.tip = block['@id'];

  self.emit('block', block['@id'], block['@data']);
}

Chain.prototype.mine = async function grind () {
  if (!this.worker) this.worker = new Worker();
  if (!this.worker.behaviors.mine) this.worker.define('mine', miner);

  function miner (state) {
    let candidate = null;
    let difficulty = 0;

    for (let i = 0; difficulty < state[1]; i++) {
      let block = new Block(state[0]);
      let bits = 0;

      block._sign();

      for (let bit in block['@id']) {
        if (bit !== '0') continue;
        bits++;
      }
    }

    this.emit('candidate', candidate);
  }

  this.worker.route('mine', [this.tip, 2]);

  return this.worker;
};

Chain.prototype.test = function validate (proof) {
  let self = this;
  if (proof['@id'] !== self['@id']) return false;
  return true;
};

Chain.prototype.patch = function apply (patchset) {
  let self = this;
  let test = monitor.applyPatch(self['@data'], patchset).newDocument;
  return self;
}

Chain.prototype.render = function serialize () {
  let self = this;

  return self;
}

Chain.prototype.close = async function () {
  await this.storage.close();
}

module.exports = Chain;
