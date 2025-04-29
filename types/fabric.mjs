'use strict';

// external dependencies
import crypto from 'crypto';

// components
import Actor from '../types/actor.js';
// import Application from '../types/application.js';
import Block from '../types/block.js';
import Chain from '../types/chain.js';
import Circuit from '../types/circuit.js';
import Collection from '../types/collection.js';
import Entity from '../types/entity.js';
import Key from '../types/key.js';
import Ledger from '../types/ledger.js';
import Machine from '../types/machine.js';
import Message from '../types/message.js';
import Observer from '../types/observer.js';
import Oracle from '../types/oracle.js';
import Peer from '../types/peer.js';
import Program from '../types/program.js';
import Remote from '../types/remote.js';
import Resource from '../types/resource.js';
import Service from '../types/service.js';
import Scribe from '../types/scribe.js';
import Script from '../types/script.js';
import Stack from '../types/stack.js';
import State from '../types/state.js';
import Store from '../types/store.js';
import Vector from '../types/vector.js';
import Wallet from '../types/wallet.js';
import Worker from '../types/worker.js';

/**
 * Reliable decentralized infrastructure.
 */
class Fabric extends Service {
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
  constructor (settings = {}) {
    super(settings);

    // local settings
    this.settings = Object.assign({
      path: './stores/fabric',
      persistent: false,
      state: {
        ...super.state,
        ...settings.state
      }
    }, settings);

    // start with reference to object
    this.ident = new Actor(this.settings);

    // build maps
    this.agent = {}; // Identity
    this.modules = {}; // List<Class>
    this.opcodes = {}; // Map<id>
    this.peers = {}; // Map<id>
    this.plugins = {}; // Map<id>
    this.services = {}; // Map<id>

    // initialize components
    this.chain = new Chain(this.settings);
    this.machine = new Machine(this.settings);
    this.store = new Store(this.settings);

    this._state = {
      status: 'PAUSED',
      content: this.settings.state
    };

    // provide instance
    return this;
  }

  static get registry () {
    return {
      local: new URL('../services/local.js', import.meta.url)
    };
  }

  // static get Application () { return Application; }
  static get Block () { return Block; }
  static get Chain () { return Chain; }
  static get Circuit () { return Circuit; }
  static get Collection () { return Collection; }
  static get Entity () { return Entity; }
  static get Key () { return Key; }
  static get Ledger () { return Ledger; }
  static get Machine () { return Machine; }
  static get Message () { return Message; }
  static get Observer () { return Observer; }
  static get Oracle () { return Oracle; }
  static get Peer () { return Peer; }
  static get Program () { return Program; }
  static get Remote () { return Remote; }
  static get Resource () { return Resource; }
  static get Service () { return Service; }
  static get Scribe () { return Scribe; }
  static get Script () { return Script; }
  static get Stack () { return Stack; }
  static get State () { return State; }
  static get Store () { return Store; }
  static get Vector () { return Vector; }
  static get Wallet () { return Wallet; }
  static get Worker () { return Worker; }

  static sha256 (data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static random () {
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

  async register (service) {
    if (!service) return new Error('Service must be provided.');

    try {
      const name = service.name || service.constructor.name;
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
    const self = this;
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

  push (value) {
    let name = value.constructor.name;
    if (name !== 'Vector') value = new Vector(value)._sign();
    this.machine.script.push(value);
    return this.machine.script;
  }

  use (name, description) {
    this.log('[FABRIC]', `defining <code>${name}</code> as:`, description);
    this.opcodes[name] = description.bind(this);
    return this.define(name, description);
  }
}

export default Fabric; 