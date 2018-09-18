'use strict';

// external dependencies
const crypto = require('crypto');

// components
const Block = require('./block');
const Chain = require('./chain');
const Datastore = require('./datastore');
const Key = require('./key');
const Machine = require('./machine');
const Oracle = require('./oracle');
const Peer = require('./peer');
const Resource = require('./resource');
const Scribe = require('./scribe');
const Storage = require('./storage');
const Store = require('./store');
const Transaction = require('./transaction');
const Vector = require('./vector');
const Worker = require('./worker');

// services
const Registry = {
  Local: require('../services/local')
};

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
  constructor (vector) {
    super(vector);

    this.services = {};
    this.modules = {};
    this.plugins = {};
    this.identity = {};
    this.peers = {};

    this.chain = new Chain();
    this.machine = new Machine();
    this.store = new Store();

    this.init();

    return this;
  }

  static get Block () { return Block; }
  static get Chain () { return Chain; }
  // TODO: differentiate from Store
  static get Datastore () { return Datastore; }
  static get Machine () { return Machine; }
  static get Oracle () { return Oracle; }
  static get Resource () { return Resource; }
  // TODO: differentiate from Store
  static get Storage () { return Storage; }
  static get Store () { return Store; }
  static get Transaction () { return Transaction; }
  static get Vector () { return Vector; }
  static get Worker () { return Worker; }

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

  async set (key, val) {
    this.machine.stack.push([key, val]);
    let saved = await this.chain.storage.set(key, val);
    this.log('chainstore:', saved);
    return this;
  }

  async start () {
    let self = this;

    // open long-term storage...
    await this.chain.storage.open();

    this.chain.on('block', function (block) {
      self.emit('block', block);
    });

    // enable the "local" service
    await this.register(Registry.Local);
    await this.enable('local');

    // identify ourselves to the network
    await this.identify();

    return this;
  }

  async stop () {
    this.log('Stopping...');

    for (let name in this.services) {
      await this.services[name].stop();
    }

    return this.chain.storage.close();
  }

  async register (service) {
    this.log('registering:', service);
    this.modules[service.name] = service;
  }

  async enable (name) {
    let self = this;
    let Module = null;

    // TODO: fix this fuckery
    try {
      Module = require(`${process.env.PWD}/services/${name}`);
    } catch (E) {
      Module = require(`../services/${name}`);
    }

    let service = new Module(this.config[name]);

    self.log(`enabling service "${name}"...`);
    self.log(`service description: "${name}":`, JSON.stringify(service));

    // TODO: fix upstream Fabric to provide Fabric.Store
    service.use(self.fabric);

    service.on('patch', function (patch) {
      self.emit('patch', Object.assign({}, patch, {
        path: name + patch.path // TODO: check in Vector Machine that this is safe
      }));
    });

    service.on('user', function (user) {
      self.emit('user', {
        id: [name, 'users', user.id].join('/'),
        name: user.name,
        online: user.online || false,
        subscriptions: []
      });
    });

    service.on('channel', function (channel) {
      self.emit('channel', {
        id: [name, 'channels', channel.id].join('/'),
        name: channel.name,
        members: []
      });
    });

    service.on('join', async function (join) {
      self.emit('join', {
        user: [name, 'users', join.user].join('/'),
        channel: [name, 'channels', join.channel].join('/')
      });
    });

    service.on('message', async function (msg) {
      let now = Date.now();
      let id = [now, msg.actor, msg.target, msg.object].join('/');
      let hash = crypto.createHash('sha256').update(id).digest('hex');
      let message = {
        id: [name, 'messages', (msg.id || hash)].join('/'),
        actor: [name, 'users', msg.actor].join('/'),
        target: [name, 'channels', msg.target].join('/'),
        object: msg.object,
        origin: {
          type: 'Link',
          name: name
        },
        created: now
      };

      this.log('message:', message);
      self.emit('message', message);

      let response = await self.parse(message);
      if (response) {
        await service.send(msg.target, response, {
          parent: message
        });

        self.emit('response', {
          parent: message,
          response: response
        });
      }
    });

    service.on('ready', function () {
      self.emit('service', { name });
    });

    this.status = 'configured';
    this.log(`service configured: ${name}`);
    this.log(`service running:`, service);

    this.services[name] = service;

    this.log(`attempting to start: ${name}`);

    try {
      await this.services[name].start();
    } catch (E) {
      this.error(`exceptioning:`, E);
    }

    return this;
  }

  /**
   * Push an instruction onto the stack.
   * @param  {Instruction} value
   * @return {Stack}
   */
  push (value) {
    let name = value.constructor.name;
    if (name !== 'Vector') value = new Vector(value)._sign();
    this.script.push(value);
    return this.script;
  }

  define (name, description) {
    this.log(`Defining resource "${name}":`, description);
    let resource = new Fabric.Resource(name, description);

    this.log(`Resource:`, resource);

    return resource;
  }

  async stop () {
    //super.stop();
    await this.chain.storage.close();
    return this;
  }
}

/**
 * Consume an application definition (configure resources + services)
 * @param {Object} vector Object representation of the application definition.
 * @param {Function} notify Callback function (err, result)
 */
Fabric.prototype.genesis = function configureSandbox (vector, notify) {
  if (!vector) vector = null;
  if (!notify) notify = new Function();

  this.emit('vector', {
    vector: vector
  });

  return notify('Not yet implemented');
};

// for all known peers locally, ask for data
// aka: promiscuous mode
Fabric.prototype.explore = function crawl () {
  let fabric = this;
  let list = Object.keys(fabric['@data'].peers).forEach(function(x) {
    peer.on('identity', function sandbox (identity) {
      console.log('sandbox inner:', identity);
    });
    
    // neat!
    peer.compute();
  });
};

Fabric.prototype.connect = async function dock (id) {
  var self = this;
  var peer = new Peer(id);

  await peer._connect();
  
  // TODO: webrtc here
  self.peers[id] = peer;
  
  return peer;
};

Fabric.prototype.identify = async function generateKeys (vector, notify) {
  if (!vector) vector = {};
  if (!notify) notify = new Function();

  var self = this;
  var key = new Key();

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

  return notify();
};

Fabric.prototype.broadcast = function announcer (msg, data) {
  var self = this;

  self.emit(msg, data);

  Object.keys(self.peers).forEach(function tell (id) {
    var peer = self.peers[id];
    peer.send(msg);
  });

  return true;
};

/**
 * Blindly consume messages from a {@link Source}, relying on `this.chain` to
 * verify results.
 * @param  {EventEmitter} source Any object which implements the `EventEmitter` pattern.
 * @return {Fabric}        Returns itself.
 */
Fabric.prototype.trust = function (source) {
  let self = this;

  source.on('block', async function (block) {
    await self.chain.append(block).catch(self.log.bind(self));
  });

  return self;
};

module.exports = Fabric;
