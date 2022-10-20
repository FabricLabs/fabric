'use strict';

const parser = require('dotparser');
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Key = require('./key');
const Service = require('./service');
const Signer = require('./signer');

class Contract extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'TemplateContract',
      balances: {},
      circuit: {},
      constraints: {},
      graphs: {},
      state: {
        name: 'TemplateContract',
        status: 'PAUSED',
        actors: [],
        balances: {},
        constraints: {},
        signatures: []
      },
      witnesses: []
    }, settings);

    // compatibility
    // this['@data'] = settings;

    // tweaked pubkey
    this.key = new Key(this.settings.key);
    this._inner = null;
    this._state = {
      status: 'PAUSED',
      chain: [], // list of block hashes
      events: [], // list of state changes
      value: this.settings.state,
      content: this.settings.state
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

  get contract () {
    const contract = `
      $A = ${this._state.content.signers[0]};
      likely@$A
    `;
    return contract.trim();
  }

  parse (input) {
    return this.parseDot(input);
  }


  /**
   * Start the Contract.
   * @returns {Contract} State "STARTED" iteration of the Contract.
   */
  start () {
    this.state.status = 'STARTING';
    this.state.status = 'STARTED';
    this.commit();
    return this;
  }

  abort () {
    // broadcast L1 transaction
  }

  commit () {
    super.commit();

    const template = {
      state: this.state
    };

    const actor = new Actor(template);

    this.emit('contract:commit', actor.toGenericMessage());

    return {};
  }

  execute () {
    return this.run();
  }

  run () {
    this.signWith(this.settings.identity);
    this.state.status = 'COMPLETED';
    this.commit();
    this.emit('contract', this.toGenericMessage());
    return this;
  }

  signWith (identity) {
    const baseline = this.toGenericMessage();
    const json = JSON.stringify(baseline); // native JSON.stringify
    const buffer = Buffer.from(json, 'utf8');

    const signer = new Signer(identity);
    const signature = signer.sign(buffer);

    return { signature };
  }

  _handleActivity (activity) {
    return new Promise((resolve, reject) => {
      try {
        const actor = new Actor(activity);
        return resolve({
          id: actor.id,
          type: 'Activity',
          object: actor.toGenericMessage()
        });
      } catch (exception) {
        return reject(exception);
      }
    });
  }

  _toUnsignedTransaction () {
    return {
      script: this.contract
    };
  }
}

module.exports = Contract;
