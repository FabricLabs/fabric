'use strict';

// external dependencies
const crypto = require('crypto');

// components
const App = require('../types/app');
const Block = require('../types/block');
const Chain = require('../types/chain');
const Circuit = require('../types/circuit');
const Collection = require('../types/collection');
// const Contract = require('./contract');
// const Disk = require('./disk');
const Entity = require('../types/entity');
const Key = require('../types/key');
const Ledger = require('../types/ledger');
const Machine = require('../types/machine');
const Message = require('../types/message');
const Observer = require('../types/observer');
const Opcode = require('../types/opcode');
const Oracle = require('../types/oracle');
// const Peer = require('./peer');
const Program = require('../types/program');
const Remote = require('../types/remote');
const Resource = require('../types/resource');
const Service = require('../types/service');
const Scribe = require('../types/scribe');
const Script = require('../types/script');
const Stack = require('../types/stack');
const State = require('../types/state');
const Store = require('../types/store');
// const Swarm = require('../types/swarm');
// const Transaction = require('./transaction');
const Vector = require('../types/vector');
const Wallet = require('../types/wallet');
const Worker = require('../types/worker');

/**
 * Reliable decentralized infrastructure.
 * @property {Class} Block
 */
class Fabric extends Scribe {
  /**
   * The {@link Fabric} type implements a peer-to-peer protocol for
   * establishing and settling of mutually-agreed upon proofs of
   * work.  Contract execution takes place in the local node first,
   * then is optionally shared with the network.
   *
   * Utilizing
   * @exports Fabric
   * @constructor
   * @param {Vector} config - Initial configuration for the Fabric engine.  This can be considered the "genesis" state for any contract using the system.  If a chain of events is maintained over long periods of time, `state` can be considered "in contention", and it is demonstrated that the outstanding value of the contract remains to be settled.
   * @emits Fabric#thread
   * @emits Fabric#step Emitted on a `compute` step.
   */
  constructor (vector = {}) {
    super(vector);

    // set local config
    this.config = Object.assign({
      path: './stores/fabric',
      persistent: false
    }, vector);

    // start with reference to object
    this.ident = new State(this.config);
    this.state = new State(vector); // State

    // TODO: remove this
    this['@entity'] = {};

    // build maps
    this.agent = {}; // Identity
    this.modules = {}; // List<Class>
    this.opcodes = {}; // Map<id>
    this.peers = {}; // Map<id>
    this.plugins = {}; // Map<id>
    this.services = {}; // Map<id>

    // initialize components
    this.chain = new Chain(this.config);
    this.machine = new Machine(this.config);
    this.store = new Store(this.config);
    // this.script = new Script(this.config);

    // provide instance
    return this;
  }

  static get registry () {
    return {
      local: require('../services/local')
    };
  }

  static get App () { return App; }
  static get Block () { return Block; }
  static get Chain () { return Chain; }
  static get Circuit () { return Circuit; }
  static get Collection () { return Collection; }
  // static get Contract () { return Contract; }
  // static get Disk () { return Disk; }
  static get Entity () { return Entity; }
  static get Key () { return Key; }
  static get Ledger () { return Ledger; }
  static get Machine () { return Machine; }
  static get Message () { return Message; }
  static get Observer () { return Observer; }
  static get Oracle () { return Oracle; }
  // static get Peer () { return Peer; }
  static get Program () { return Program; }
  static get Remote () { return Remote; }
  static get Resource () { return Resource; }
  static get Service () { return Service; }
  static get Scribe () { return Scribe; }
  static get Script () { return Script; }
  static get Stack () { return Stack; }
  static get State () { return State; }
  static get Store () { return Store; }
  static get Swarm () { return Swarm; }
  // static get Transaction () { return Transaction; }
  static get Vector () { return Vector; }
  static get Wallet () { return Wallet; }
  static get Worker () { return Worker; }

  static sha256 (data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static random () {
    // TODO: select random function
    // do not trust keys until this is determined!
    return Math.random();
  }

  async _GET (key) {
    return this.store._GET(key);
  }

  async _SET (key, value) {
    return this.store._SET(key, value);
  }

  async _PUT (key, value) {
    return this.store._SET(key, value);
  }

  async _POST (collection, value) {
    return this.store._POST(collection, value);
  }

  async _PATCH (key, overlay) {
    return this.store._PATCH(key, overlay);
  }

  async _DELETE (key) {
    return this.store._DELETE(key);
  }

  async start () {
    await super.start();

    for (let i in this.config.services) {
      let name = this.config.services[i];
      let service = Service.fromName(name);
      await this.register(service);
      await this.enable(name);
    }

    // identify ourselves to the network
    await this.identify();

    return this;
  }

  async stop () {
    this.log('Stopping...');

    for (let name in this.services) {
      await this.services[name].stop();
    }

    if (this.chain) {
      await this.chain.stop();
    }

    await super.stop();

    this.emit('done');

    return this;
  }

  /**
   * Register an available {@link Service} using an ES6 {@link Class}.
   * @param {Class} service The ES6 {@link Class}.
   */
  async register (service) {
    if (!service) return new Error('Service must be provided.');

    try {
      let name = service.name || service.constructor.name;
      this.modules[name.toLowerCase()] = service;
      this.emit('message', {
        '@type': 'ServiceRegistration',
        '@data': { name: name }
      });
    } catch (E) {
      this.error('Could not register service:', E);
    }

    return this;
  }

  async enable (name) {
    let self = this;
    let Module = null;
    let config = Object.assign({
      name: name,
      path: `./stores/${name}`
    }, this.config[name]);

    if (this.modules[name]) {
      Module = this.modules[name];
    } else {
      return this.error(`Could not enable module ${name}.  Check local registry.`);
    }

    // configure the service
    this.services[name] = new Module(config);
    this.services[name].on('ready', function () {
      self.emit('service:ready', { name });
    });

    // bind all events
    self.trust(this.services[name]);

    try {
      await this.services[name].start();
      this.emit('message', {
        '@type': 'ServiceStartup',
        '@data': { name: name }
      });
    } catch (E) {
      console.error(`exceptioning:`, E);
    }

    return this;
  }

  append (value) {
    return this.chain.append(value);
  }

  set (key, value) {
    return State.pointer.set(this['@entity'], key, value);
  }

  get (key) {
    return State.pointer.get(this['@entity'], key);
  }

  /**
   * Push an instruction onto the stack.
   * @param  {Instruction} value
   * @return {Stack}
   */
  push (value) {
    let name = value.constructor.name;
    if (name !== 'Vector') value = new Vector(value)._sign();
    this.machine.script.push(value);
    return this.machine.script;
  }

  use (name, description) {
    this.log('[FABRIC]', `defining <code>${name}</code> as:`, description);
    this.opcodes[name] = new Opcode(description);
    return this.define(name, description);
  }

  define (name, description) {
    this.log(`Defining resource "${name}":`, description);
    let vector = new Fabric.State(description);
    let resource = new Fabric.Resource(name, description);
    this.log(`Resource:`, resource);
    this.log(`Resource as vector:`, vector);
    return resource;
  }

  identify (vector) {
    if (!vector) vector = {};

    let self = this;
    let key = new Key();

    self.identity = { key };

    // a "vector" is a known truth, something that we've generated ourselves
    // or otherwise derived truth from an origin (a genesis vector
    // TODO: remove lodash
    self['@data'] = Object.assign({}, self['@data'], vector, key); // should be equivalent to `f(x + y)`

    this.emit('auth', {
      key: {
        public: key.public
      }
    });

    return this;
  }

  send (target, message) {
    // console.log('sending:', target, message);
    return this.emit('message', {
      'target': target,
      'object': message
    });
  }

  broadcast (msg, data) {
    var self = this;

    self.emit(msg, data);

    Object.keys(self.peers).forEach(function tell (id) {
      var peer = self.peers[id];
      peer.send(msg);
    });

    return true;
  }

  /**
   * Blindly consume messages from a {@link Source}, relying on `this.chain` to
   * verify results.
   * @param  {EventEmitter} source Any object which implements the `EventEmitter` pattern.
   * @return {Fabric}        Returns itself.
   */
  trust (source) {
    let self = this;

    this.warn('[TRUST]', 'trusting:', typeof source);

    source.on('changes', async function (changes) {
      self.log('source', typeof source, 'emitted:', changes);
    });

    source.on('transaction', async function (transaction) {
      // console.log('[FABRIC:CORE]', '[EVENT:TRANSACTION]', `source (${source.constructor.name}):`, transaction);
      // console.log('[PROPOSAL]', 'apply this transaction to local state:', transaction);
    });

    source.on('block', async function (block) {
      await self.chain.append(block).catch(self.log.bind(self));
    });

    source.on('patch', function (patch) {
      console.log('source', typeof source, 'emitted patch:', patch);
      self.emit('patch', Object.assign({}, patch, {
        path: source.name + patch.path // TODO: check in Vector Machine that this is safe
      }));
    });

    // normalized bindings
    source.on('actor', function (actor) {
      self.log(typeof source, 'source emitted actor:', actor);
      self.emit('actor', {
        id: [source.name, 'actors', actor.id].join('/'),
        name: actor.name,
        online: actor.online || false,
        subscriptions: []
      });
    });

    source.on('channel', function (channel) {
      self.emit('channel', {
        id: [source.name, 'channels', channel.id].join('/'),
        name: channel.name,
        members: []
      });
    });

    source.on('join', async function (join) {
      self.emit('join', {
        user: [source.name, 'actors', join.user].join('/'),
        channel: [source.name, 'channels', join.channel].join('/')
      });
    });

    source.on('message', async function (msg) {
      let now = Date.now();
      let id = [now, msg.actor, msg.target, msg.object].join('/');
      let hash = crypto.createHash('sha256').update(id).digest('hex');
      let message = {
        id: [source.name, 'messages', (msg.id || hash)].join('/'),
        actor: [source.name, 'actors', msg.actor].join('/'),
        target: [source.name, 'channels', msg.target].join('/'),
        object: msg.object,
        origin: {
          type: 'Link',
          name: source.name
        },
        created: now
      };

      this.log('message:', message);
      self.emit('message', message);

      let response = await self.parse(message);
      if (response) {
        await source.send(msg.target, response, {
          parent: message
        });

        self.emit('response', {
          parent: message,
          response: response
        });
      }
    });

    return self;
  }

  /**
   * Process the current stack.
   * @return {Fabric} Resulting instance of the stack.
   */
  compute () {
    ++this.clock;
    // console.log('[FABRIC:COMPUTE]', '[COMMIT:RESULT]', this.commit());
    return this;
  }

  render () {
    return `<Fabric integrity="sha256:${this.id}" />`;
  }
}

module.exports = Fabric;
