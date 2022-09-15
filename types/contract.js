'use strict';

const parser = require('dotparser');
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Key = require('./key');
const Service = require('./service');

class Contract extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'TemplateContract',
      balances: {},
      circuit: {},
      constraints: {},
      graphs: {},
      witnesses: []
    }, settings);

    // compatibility
    this['@data'] = settings;

    // tweaked pubkey
    this.key = new Key(this.settings.key);
    this._inner = null;
    this._state = {
      status: 'PAUSED',
      chain: [], // list of block hashes
      events: [], // list of state changes
      value: {
        name: this.settings.name,
        balances: this.settings.balances,
        constraints: this.settings.constraints,
        witnesses: this.settings.witnesses
      }
    };

    return this;
  }

  static fromDot (input) {
    const graphs = parser(input);
    const circuit = Contract.fromGraph(graphs);
    const contract = new Contract({
      graphs: graphs,
      circuit: circuit
    });

    // monkey
    contract.graphs = graphs;

    return contract;
  };

  static fromGraph (graphs) {
    const circuit = {
      stack: [],
      nodes: []
    };

    return circuit;
  }

  parse (input) {
    return this.parseDot(input);
  }

  abort () {
    // broadcast L1 transaction
  }
}

module.exports = Contract;
