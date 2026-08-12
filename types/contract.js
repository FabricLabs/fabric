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

/**
 * Service-backed agreement template: DOT graphs, a derived circuit structure, deploy/genesis/publish flows,
 * and JSON-Patch–observed commits. Specialized by {@link Bond}, {@link Federation}, and {@link Distribution}.
 * @class Contract
 * @extends Service
 */
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
    if (typeof js !== 'string') {
      throw new TypeError('JavaScript source must be a string.');
    }

    const source = js.trim();
    const ast = {
      '@type': 'AST',
      '@language': 'JavaScript',
      source
    };

    return new Contract({
      ast,
      state: {
        name: 'TemplateContract',
        status: 'PAUSED',
        actors: [],
        balances: {},
        constraints: {},
        signatures: [],
        source
      }
    });
  }

  static fromGraph (graphs) {
    const circuit = {
      stack: [],
      nodes: [],
      edges: [],
      unhandled: []
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
            circuit.unhandled.push({
              type: child.type,
              child
            });
            break;
          case 'edge_stmt': {
            const list = Array.isArray(child.edge_list) ? child.edge_list : [];
            for (let k = 0; k < list.length - 1; k++) {
              const from = list[k];
              const to = list[k + 1];
              if (!from || !to) continue;
              if (!from.id || !to.id) continue;
              circuit.edges.push({
                from: from.id,
                to: to.id
              });
            }
            break;
          }
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
    })]).signWithKey(this.key).toBuffer();

    // Get hash of message
    const hash = crypto.createHash('sha256').update(PACKET_CONTRACT_GENESIS).digest('hex');

    // Store locally
    this.messages[hash] = PACKET_CONTRACT_GENESIS.toString('hex');

    // Contract template
    const template = {
      author: this.key.pubkey,
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
    })]).signWithKey(this.key);

    const signed = PACKET_CONTRACT_PUBLISH.signWithKey(this.key);
    const pubhash = crypto.createHash('sha256').update(signed.toBuffer()).digest('hex');

    this.messages[pubhash] = PACKET_CONTRACT_PUBLISH.toString('hex');
    this.emit('message', signed);

    return this;
  }

  toDot () {
  }

  parse (input) {
    return this.parseDot(input);
  }

  parseDot (input) {
    const contract = Contract.fromDot(input);
    this.settings.graphs = contract.settings.graphs;
    this.settings.circuit = contract.settings.circuit;
    this.graphs = contract.graphs;
    return this;
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

    const signer = new Key(identity);
    const signature = signer.sign(buffer);

    return { signature };
  }

  _handleActivity (activity) {
    return new Promise((resolve, reject) => {
      try {
        if (activity == null || typeof activity !== 'object') {
          return reject(new TypeError('activity must be a non-null object'));
        }
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

  /**
   * Observe an on-chain transaction for payments to this contract's spend address.
   * On success (and when `apply` is not false), folds matched sats into tip balances.
   *
   * @param {string|object} txInput raw tx hex or bitcoin.Transaction
   * @param {object} [opts]
   * @param {string} [opts.network]
   * @param {string} [opts.address] override spend address
   * @param {number} [opts.amountSats] minimum matched sats
   * @param {boolean} [opts.apply=true] fold into `_state.content` on success
   * @returns {object} observation from {@link module:functions/contractPaymentObserve.observePaymentToAddress}
   */
  _handleBitcoinTransaction (txInput, opts = {}) {
    const {
      observePaymentToAddress,
      applyPaymentObservationToTip
    } = require('../functions/contractPaymentObserve');
    const network = opts.network || this.settings.network;
    if (!network) {
      return {
        ok: false,
        code: 'NETWORK_REQUIRED',
        error: 'Bitcoin network required (set settings.network or opts.network; do not default to regtest)'
      };
    }
    let address = opts.address || null;
    if (!address) {
      try {
        address = this.toAddress(network);
      } catch (e) {
        return {
          ok: false,
          code: 'NO_ADDRESS',
          error: e && e.message ? e.message : 'contract spend address unavailable'
        };
      }
    }
    const observation = observePaymentToAddress({
      tx: txInput,
      address,
      network,
      amountSats: opts.amountSats
    });
    if (observation.ok && opts.apply !== false) {
      const tip = {
        content: (this._state && this._state.content) || this.settings.state || {}
      };
      const next = applyPaymentObservationToTip(tip, observation);
      if (!this._state) this._state = { content: {} };
      // Merge into the observed content object in place — replacing
      // `this._state.content` would detach `this.observer` from monitor.
      if (!this._state.content || typeof this._state.content !== 'object') {
        this._state.content = {};
      }
      const target = this._state.content;
      const incoming = next.content && typeof next.content === 'object' ? next.content : {};
      for (const key of Object.keys(target)) {
        if (!Object.prototype.hasOwnProperty.call(incoming, key)) delete target[key];
      }
      Object.assign(target, incoming);
      if (this.settings) {
        this.settings.state = target;
      }
      observation.applied = true;
      observation.balances = target.balances;
    } else if (observation.ok) {
      observation.applied = false;
    }
    return observation;
  }

  _toUnsignedTransaction () {
    return {
      script: this.contract
    };
  }

  /**
   * Build deterministic P2TR spend tree from settings.spendLadder or synthesized
   * validators / publisher policy.
   * @param {object} [overrides]
   * @returns {object} {@link module:functions/contractTaproot.buildContractTaproot}
   */
  /**
   * Shared spend-policy inputs for {@link Contract#toTaprootContract}.
   * Subclasses (e.g. Federation) may override to supply validators from state.
   * @param {object} [overrides]
   * @returns {object}
   */
  _taprootPolicyInputs (overrides = {}) {
    const tap = require('../functions/contractTaproot');
    const validators = overrides.validators
      || (this.settings.proposedPolicy && this.settings.proposedPolicy.validators)
      || (this.settings.consensus && this.settings.consensus.validators)
      || this.settings.validators
      || [];
    const threshold = overrides.threshold != null
      ? overrides.threshold
      : ((this.settings.proposedPolicy && this.settings.proposedPolicy.threshold)
        || this.settings.threshold
        || 1);
    const publisher = overrides.publisher
      || this.settings.publisher
      || this.settings.creator
      || (validators[0] || null);
    const network = overrides.network
      || this.settings.network
      || null;
    if (!network) {
      throw new Error(
        'Contract Bitcoin network required (set settings.network or pass overrides.network; do not default to regtest)'
      );
    }
    const csvBlocks = overrides.csvBlocks != null
      ? overrides.csvBlocks
      : (this.settings.csvBlocks != null ? this.settings.csvBlocks : tap.DEFAULT_CSV_BLOCKS);
    return { validators, threshold, publisher, network, csvBlocks };
  }

  toTaprootContract (overrides = {}) {
    const tap = require('../functions/contractTaproot');
    const ladder = overrides.spendLadder || this.settings.spendLadder || null;
    if (ladder) {
      const network = overrides.network || this.settings.network || ladder.network;
      if (!network) {
        throw new Error(
          'Contract Bitcoin network required (set settings.network, ladder.network, or overrides.network)'
        );
      }
      return tap.buildContractTaproot({ ...ladder, ...overrides, network });
    }
    const inputs = this._taprootPolicyInputs(overrides);
    return tap.buildContractTaproot(tap.synthesizeDefaultLadder({
      ...inputs,
      ...overrides
    }));
  }

  /**
   * Bech32m P2TR address for this contract's spend policy.
   * @param {string} [network]
   * @returns {string}
   */
  toAddress (network) {
    const built = this.toTaprootContract(network ? { network } : {});
    return built.address;
  }

  /**
   * Resolve tip + genesis spend policy to the public P2TR surface (ARC).
   * @param {object} [opts]
   * @param {object} [opts.tip]
   * @param {object} [opts.genesis] defaults to this.settings
   * @param {object} [opts.overrides]
   * @returns {object} {@link module:functions/contractSpend.resolveSpend}
   */
  resolveSpend (opts = {}) {
    const { resolveSpend } = require('../functions/contractSpend');
    return resolveSpend({
      genesis: opts.genesis || this.settings,
      tip: opts.tip || {
        contractId: this.id || null,
        content: (this._state && this._state.content) || this.settings.state || {},
        stateDigest: opts.stateDigest || null,
        bitcoinBlockHash: opts.bitcoinBlockHash
          || (this.settings.bitcoinAnchor && this.settings.bitcoinAnchor.blockHash)
          || null,
        bitcoinHeight: opts.bitcoinHeight
          || (this.settings.bitcoinAnchor && this.settings.bitcoinAnchor.height)
          || null,
        clock: (this._state && this._state.content && this._state.content.clock) || 0
      },
      contractId: opts.contractId || this.id || null,
      overrides: opts.overrides
    });
  }
}

module.exports = Contract;
