'use strict';

// Dependencies
const parser = require('dotparser');

// Fabric Types
const Actor = require('./actor');
const Key = require('./key');
const Message = require('/./message');
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
    })])._setSigner(this.signer).sign().toBuffer();

    // Get hash of message
    const hash = crypto.createHash('sha256').update(PACKET_CONTRACT_GENESIS).digest('hex');

    // Store locally
    this.messages[hash] = PACKET_CONTRACT_GENESIS.toString('hex');

    // Contract template
    const template = {
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

    // Return contract ID
    return this.actor.id;
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

  _toUnsignedTransaction () {
    return {
      script: this.contract
    };
  }
}

module.exports = Contract;
