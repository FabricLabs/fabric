'use strict';

// Dependencies
const merge = require('lodash.merge');
const Service = require('./service');
const Actor = require('./actor');
const Tree = require('./tree');

/**
 * Aggregates a set of balances (inputs).
 */
class Aggregator extends Service {
  /**
   * Create a new Aggregator.
   * @param {Object} [settings] Map of configuration values.
   * @param {Array} [settings.inputs] Array of {@link AnchorBalance} instances.
   * @returns {Aggregator} Instance of the {@link Aggregator}.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      inputs: [],
      version: 0
    }, this.settings, settings);

    this.actor = new Actor({ inputs: this.settings.inputs });
    this._tree = new Tree();
    this._state = {
      balances: {
        total: 0,
        confirmed: 0,
        unconfirmed: 0
      },
      inputs: this.settings.inputs,
      history: []
    };

    return this;
  }

  get id () {
    return this.actor.id;
  }

  get balances () {
    return Object.assign({}, this._state.balances);
  }

  /**
   * Import a list of {@link AnchorBalance} instances.
   * @param {Array} list List of inputs to add.
   */
  _importBalances (list = []) {
    for (let i = 0; i < list.length; i++) {
      this._state.inputs.push(list[i]);
    }
  }

  /**
   * Updates the state to reflect balances from current inputs.
   */
  _sumBalances () {
    this._state.balances = this._state.inputs.reduce((o, e) => {
      o.total += e.total;
      o.confirmed += e.confirmed;
      o.unconfirmed += e.unconfirmed;
      return o;
    }, {
      total: 0,
      confirmed: 0,
      unconfirmed: 0
    });
  }

  /**
   * Commits the balance of all input.
   * @fires Aggregator#tree
   * @returns {AggregatorCommit} Commit instance.
   */
  commit () {
    this._sumBalances();

    const actor = new Actor(this._state);
    const signature = actor.sign().signature;
    const message = {
      id: actor.id,
      type: 'AggregatorCommit',
      actor: this.id,
      object: actor.toObject(),
      target: '/commits',
      signature: signature,
      version: this.settings.version
    };

    this._tree.addLeaf(actor.id);
    this._state.history.push(this._tree.root);

    /**
     * Tree event.
     * @event Aggregator#tree
     * @type {Object}
     * @property {Uint8Array} root {@link MerkleRoot} of the {@link Tree}.
     */
    this.emit('tree', this._tree);
    this.emit('commit', message);

    return message;
  }
}

module.exports = Aggregator;
