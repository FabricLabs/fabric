'use strict';

const Ledger = require('./ledger');
const State = require('./state');
const Storage = require('./storage');

const MerkleTree = require('merkletreejs');

/**
 * Chain.
 * @property {String} name Current name.
 * @property {Map} indices
 * @property {Ledger} ledger
 * @property {Storage} storage
 */
class Chain extends Ledger {
  /**
   * Holds an immutable chain of events.
   * @param       {Vector} genesis Initial state for the chain of events.
   */
  constructor (origin) {
    super(origin);

    this.name = (origin) ? origin.name : 'playnet';
    this.config = Object.assign({
      name: this.name,
      type: 'sha256'
    }, origin);

    this.genesis = new State(this.config);
    this.state['@data'] = this.genesis['@data'];

    // TODO: set this up via define?
    this.indices = {
      blocks: '/blocks',
      transactions: '/transactions'
    };

    this.ledger = new Ledger();
    this.storage = new Storage({
      path: './data/chain'
    });

    this.mast = new MerkleTree([
      Buffer.from(this.genesis.id)
    ], this.sha256, {
      isBitcoinTree: true
    });

    Object.defineProperty(this, 'ledger', {
      enumerable: false,
      writable: false
    });

    Object.defineProperty(this, 'storage', {
      enumerable: false,
      writable: false
    });

    return this;
  }

  static fromObject (data) {
    return new Chain(data);
  }

  get tip () {
    return this.ledger.tip;
  }

  get root () {
    return this.mast.getRoot();
  }

  get blocks () {
    return this.state.blocks || [];
  }

  get leaves () {
    return this.blocks.map(x => Buffer.from(x['@id'], 'hex'));
  }

  get _tree () {
    return new MerkleTree(this.leaves, this.sha256, {
      isBitcoinTree: true
    });
  }

  async start () {
    let chain = this;

    await chain.storage.open();
    await chain.ledger.start();

    // TODO: define all state transitions
    chain.state.blocks = [chain.genesis];

    // blindly bind all events
    this.trust(chain.ledger);

    // before returning, ensure a commit
    await chain.commit();

    return chain;
  }

  async stop () {
    await this.commit();
    await this.ledger.stop();
    await this.storage.close();

    return this;
  }

  async open () {
    return this.storage.open();
  }

  async close () {
    return this.storage.close();
  }

  async _load () {
    let chain = this;

    let query = await chain.storage.get('/blocks');
    let response = new State(query);

    this.log('query:', query);
    this.log('response:', response);
    this.log('response id:', response.id);

    return chain;
  }

  async append (block) {
    if (!block['@id'] || !block['@data']) {
      block = new State(block);
    }

    let self = this;
    let path = [self.indices.blocks, block.id].join('/');

    // Chains always have a genesis.
    if (self.blocks.length === 0 && !self.genesis) {
      self.genesis = block['@id'];
    }

    await self.ledger.append(block['@data']);
    await self.storage._PUT(path, block);

    self.state.blocks.push(block);

    self['@tree'] = new MerkleTree(this.leaves, this.sha256, {
      isBitcoinTree: true
    });

    self.emit('block', block['@id'], block['@data']);

    await self.commit();

    return self;
  }

  async _listBlocks () {
    let self = this;
    let blocks = await self.storage.get(self.indices.blocks);

    return blocks;
  }

  async mine () {
    let block = new State({
      parent: this.id
    });
    return block.commit();
  }

  async commit () {
    let input = this.ledger.pages;
    let state = new State(input);
    let commit = await state.commit();
    let script = []; // validation

    this['@data'] = input;
    this['@id'] = state.id;

    script.push(`${state['@id']}`);
    script.push(`OP_PUSH32`);
    script.push(`OP_ALLOC`);
    script.push(`${JSON.stringify(state['@data'])}`);
    script.push(`OP_SHA256`);
    script.push(`${state.id}`);
    script.push(`OP_EQUALVERIFY`);

    if (commit['@changes']) {
      this.emit('state', state['@data']);
      this.emit('changes', commit['@changes']);
    }

    return commit['@changes'];
  }

  async verify (level = 4, depth = 6) {
    this.log(`Verification Level ${level} running from -${depth}...`);
    console.log('root:', this.root);
    return (this['@id'] === this.root);
  }

  render () {
    return `<Chain id="${this.id}" />`;
  }
}

module.exports = Chain;
