'use strict';

// Generics
const crypto = require('crypto');

// Dependencies
// const Template = require('@babel/template');
// const Generate = require('@babel/generator');
// const t = require('@babel/types');
const parser = require('dotparser');
const monitor = require('fast-json-patch');

// Fabric Types
const Actor = require('./actor');
const Key = require('./key');
const Message = require('./message');
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
    this.messages = {};

    this._inner = null;
    this._state = {
      status: 'PAUSED',
      chain: [], // list of block hashes
      events: [], // list of state changes
      value: this.settings.state,
      content: this.settings.state
    };

    this.observer = monitor.observe(this._state.content);

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

  static fromJavaScript (js) {
    const buildAST = Template.template(js);
    const ast = buildAST({});
    return new Contract({ ast });
  }

  static fromGraph (graphs) {
    const circuit = {
      stack: [],
      nodes: []
    };

    for (let i = 0; i < graphs.length; i++) {
      const graph = graphs[i];
      const node = {
        name: graph.id
      };

      circuit.nodes.push(node);

      if (!graph.children.length) continue;
      for (let j = 0; j < graph.children.length; j++) {
        const child = graph.children[j];
        switch (child.type) {
          default:
            console.warn(`Unhandled type: "${child.type}'" on child:`, child);
            break;
          case 'node_stmt':
            circuit.nodes.push({
              name: child.node_id.id
            });
            break;
        }
      }
    }

    return circuit;
  }

  get contract () {
    const contract = `
      $A = ${this._state.content.signers[0]};
      likely@$A
    `;
    return contract.trim();
  }

  /**
   * Deploys the contract.
   * @returns {String} Message ID.
   */
  deploy () {
    // Attest to local time
    const now = (new Date()).toISOString();
    const input = {
      clock: 0,
      validators: []
    };

    // First message (genesis)
    const PACKET_CONTRACT_GENESIS = Message.fromVector(['CONTRACT_GENESIS', JSON.stringify({
      type: 'CONTRACT_GENESIS',
      object: {
        input: input
      }
    })])._setSigner(this.key).sign().toBuffer();

    // Get hash of message
    const hash = crypto.createHash('sha256').update(PACKET_CONTRACT_GENESIS).digest('hex');

    // Store locally
    this.messages[hash] = PACKET_CONTRACT_GENESIS.toString('hex');

    // Contract template
    const template = {
      author: this.signer.pubkey,
      bond: null, // BTC transaction which is spent
      checksum: '',
      created: now,
      genesis: hash,
      history: [ hash ], // most recent first
      messages: this.messages,
      name: this.settings.name,
      signature: '',
      state: input,
      version: 1
    };

    // Track our contract by Actor ID
    this.actor = new Actor(template);
    this.emit('log', `Deploying Contract [0x${this.actor.id}] (${PACKET_CONTRACT_GENESIS.byteLength} bytes): ${this.messages[hash]}`);

    // Network publish message (contract)
    const PACKET_CONTRACT_PUBLISH = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify({
      type: 'CONTRACT_PUBLISH',
      object: template
    })]);

    const signed = PACKET_CONTRACT_PUBLISH._setSigner(this.signer).sign();
    const pubhash = crypto.createHash('sha256').update(signed.toBuffer()).digest('hex');

    this.messages[pubhash] = PACKET_CONTRACT_PUBLISH.toString('hex');
    this.emit('message', signed);

    return this;
  }

  toDot () {
    const tokens = [];
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
    const now = new Date();
    const changes = monitor.generate(this.observer);

    if (changes.length) {
      const message = Message.fromVector(['CONTRACT_MESSAGE', {
        type: 'CONTRACT_MESSAGE',
        object: {
          contract: this.id,
          ops: changes
        }
      }]);

      this.emit('changes', changes);
      this.emit('message', message);
    }

    this.emit('commit', {
      created: now.toISOString(),
      state: this.state
    });

    return this;
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

  _handleBitcoinTransaction () {
    // TODO: parse on-chain transaction for update to contract balance
    // Does this transaction pay to this contract?
  }

  _toUnsignedTransaction () {
    return {
      script: this.contract
    };
  }
}

module.exports = Contract;
