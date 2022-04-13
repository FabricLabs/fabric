'use strict';

const BN = require('bn.js');
const merge = require('lodash.merge');
const Actor = require('./actor');
const Label = require('./label');
const Key = require('./key');
const Tree = require('./tree');

class Weave extends Actor {
  constructor (settings = {}) {
    super(settings);

    // Allow constructor to use Array input
    if (settings instanceof Array) settings = { inputs: settings };

    // Assign defaults
    this.settings = merge({
      inputs: [],
      outputs: [],
      key: {
        seed: null,
        private: null,
        public: null
      },
      depth: 1
    }, this.settings, settings);

    this.key = new Key(this.settings.key);
    this._tree = new Tree(this.settings.inputs);
    this._state = {
      status: 'initialized',
      root: this._tree.root.toString('hex'),
      gates: [],
      layers: [],
      outputs: [],
      keys: {}
    };

    // Stores cryptographic signature
    this.signature = null;

    return this;
  }

  get status () {
    return this._state.status;
  }

  get root () {
    return this._tree.root;
  }

  async commit () {
    this._state.root = this._tree.root.toString('hex');
    this.signature = await this.key._sign(this._state.root);

    // Create commitment
    const commit = {
      type: 'Commit',
      data: this._state.root,
      signature: this.signature
    };

    // Notify listeners
    this.emit('commit', commit);

    // Not chainable (returns commit)
    return commit;
  }

  _createThread (state = {}) {
    const actor = new Actor(state);
    const label = new Label(`actors/${actor.id}`);
    const ephemeral = new Key();
    const key = {
      private: ephemeral.private,
      public: ephemeral.public
    };

    // Store in state
    this._state.keys[ephemeral.id] = key;

    return {
      actor: actor.id,
      label: label._id,
      pubkey: ephemeral.id
    };
  }

  async _generateLayer () {
    const gates = [];

    for (let i = 0; i < this.settings.inputs.length; i++) {
      const input = this.settings.inputs[i];
      const label = new Label(`gates/${input}`);
      const gate = this._createThread({ input });
      const actor = new Actor({ label: label._id, gate });
      gates.push(actor.id);
    }

    if (!gates.length) throw new Error('No gates created.  Did you provide any inputs?');

    const layer = new Weave(gates);
    this._state.layers.push(layer);

    const commit = await this.commit();

    return {
      type: 'WeaveLayer',
      data: layer,
      gates: gates,
      commit: commit
    };
  }
}

module.exports = Weave;
