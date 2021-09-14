'use strict';

const {
  MAX_TX_PER_BLOCK
} = require('../constants');

const monitor = require('fast-json-patch');

const Actor = require('./actor');
const Block = require('./block');
const Ledger = require('./ledger');
const Stack = require('./stack');
const State = require('./state');

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
  constructor (origin = {}) {
    super(origin);

    this.name = (origin) ? origin.name : '@fabric/playnet';
    this.settings = Object.assign({
      name: this.name,
      type: 'sha256',
      validator: this.validate.bind(this)
    }, origin);

    // Internal State
    this._state = {
      blocks: {},
      genesis: null,
      consensus: null,
      transactions: {},
      mempool: [],
      ledger: []
    };

    return this;
  }

  static fromObject (data) {
    return new Chain(data);
  }

  get consensus () {
    return this.tip;
  }

  get tip () {
    return this._state.consensus;
  }

  get root () {
    return this.mast.getRoot();
  }

  get blocks () {
    return this._state.ledger;
  }

  get leaves () {
    return this.blocks.map(x => Buffer.from(x, 'hex'));
  }

  get subsidy () {
    return 50;
  }

  get mempool () {
    return this._state.mempool;
  }

  get _tree () {
    const stack = new Stack(this.leaves);
    return stack.asMerkleTree();
  }

  trust (source) {
    const self = this;

    source.on('message', function TODO (message) {
      self.emit('debug', `Message from trusted source: ${message}`);
    });

    return self;
  }

  async start () {
    const chain = this;

    // Monitor changes
    this.observer = monitor.observe(this._state);

    // before returning, ensure a commit
    await chain.commit();

    return chain;
  }

  async stop () {
    await this.commit();
    return this;
  }

  async attach (application) {
    if (!application.store) {
      this.emit('error', `Application has no "store" property.`);
    } else {
      this.store = application.store;
    }

    return this;
  }

  async open () {
    return this.storage.open();
  }

  async close () {
    return this.storage.close();
  }

  async _load () {
    const chain = this;

    const query = await chain.storage.get('/blocks');
    const response = new State(query);

    this.log('query:', query);
    this.log('response:', response);
    this.log('response id:', response.id);

    return chain;
  }

  async append (block) {
    if (!block) throw new Error('Must provide a block.');
    if (!(block instanceof Block)) {
      block = new Block(block);
    }

    if (this.blocks.length <= 0) {
      this._state.genesis = block.id;
    }

    this._state.blocks[block.id] = block;
    this._state.ledger.push(block.id);
    this._state.consensus = block.id;

    await this.commit();

    this.emit('block', block);

    return this;
  }

  async _listBlocks () {
    return this.blocks;
  }

  async proposeTransaction (transaction) {
    const actor = new Actor(transaction);

    this._state.transactions[actor.id] = actor;
    this._state.mempool.push(actor.id);

    return actor;
  }

  async generateBlock () {
    const proposal = {
      parent: this.consensus,
      transactions: []
    };

    // TODO: _sortFees
    if (this.mempool.length) {
      for (let i = 0; i < MAX_TX_PER_BLOCK; i++) {
        const candidate = this.mempool.shift();
        if (candidate) {
          proposal.transactions.push(candidate);
        }
      }
    }

    const block = new Block(proposal);
    await this.append(block);

    return block;
  }

  async generateBlocks (count = 1) {
    const blocks = [];

    for (let i = 0; i < count; i++) {
      const block = await this.generateBlock();
      blocks.push(block);
    }

    return blocks;
  }

  async commit () {
    let changes = null;

    if (this.observer) {
      changes = monitor.generate(this.observer);
    }

    if (changes) {
      this.emit('changes', {
        type: 'StateChanges',
        data: changes
      });
    }

    const state = new Actor(this._state);
    return state.id;
  }

  async verify (level = 4, depth = 6) {
    this.log(`Verification Level ${level} running from -${depth}...`);
    console.log('root:', this.root);
    return (this['@id'] === this.root);
  }

  validate (chain) {
    let valid = false;
    for (let i = 0; i < chain.height; i++) {
      let block = chain.blocks[i];
    }
    return valid;
  }

  render () {
    console.log('[CHAIN]', '[RENDER]', this);
    return `<Chain id="${this.id}" />`;
  }
}

module.exports = Chain;
