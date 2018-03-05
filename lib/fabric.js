'use strict';

const util = require('util');

const Chain = require('./chain');
const Peer = require('./peer');
const Vector = require('./vector');
const Machine = require('./machine');
const _ = require('./functions');

class Fabric extends Vector {
  /**
   * The {@link module:Fabric} type implements the Fabric Protocol, a formally-defined language for the establishment and settlement of mutually-agreed upon proofs of work.
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

    const self = this;

    this.identity = {};
    this.peers = {};

    this.chain = new Chain();
    this.machine = new Machine();

    this.chain.on('block', function (block) {
      self.emit('block', block);
    });

    this.init();
  }

  async set (key, val) {
    this.machine.stack.push([key, val]);
    let saved = await this.chain.storage.set(key, val);
    console.log('chainstore:', saved);
    return this;
  }

  async stop () {
    //super.stop();
    await this.chain.storage.close();
    return this;
  }
}

Fabric.add = function combineVectors (a, b) {
  return a + b;
};

Fabric.prototype.add = function combine (delta) {
  const self = this;
  
  console.log('[FABRIC]', 'add', delta);
  console.log('[FABRIC]', 'prior', self['@data']);
  
  var ans = this.machine.add(self['@data'], delta);
  
  return ans.newDocument;
}

/**
 * Consume an application definition (configure resources + services)
 * @param {object} vector - Object representation of the application definition.
 * @param {function} notify - Callback function (err, result)
 */
Fabric.prototype.bootstrap = function configureSandbox (vector, notify) {
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

Fabric.prototype.identify = function generateKeys (vector, notify) {
  if (!vector) vector = {};
  if (!notify) notify = new Function();

  var self = this;
  var identity = {
    key: {
      public: 'foo'
    }
  }
  
  self.identity = identity;
  self.use('NOOP', function () {
    return this;
  });
  
  // a "vector" is a known truth, something that we've generated ourselves
  // or otherwise derived truth from an origin (a genesis vector
  // TODO: remove lodash
  self['@data'] = _.merge(self['@data'], vector, identity); // should be equivalent to `f(x + y)`

  this.emit('auth', identity);

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
 * Blindly consume messages from a `source`, relying on `Chain` to verify.
 * @param  {EventEmitter} source Any object which implements the `EventEmitter` pattern.
 * @return {Fabric}        Returns itself.
 */
Fabric.prototype.trust = function (source) {
  var self = this;
  source.on('block', async function (block) {
    await self.chain.append(block);
  });
  return self;
};

Fabric.prototype.start = async function init (done) {
  var self = this;
  self.identify();
  // self.compute();
  // return done();
};

/**
 * Serialize the current network state and provide it as output.
 * @return {String} Serialized output for consumption.
 */
Fabric.prototype.render = function consume () {
  return JSON.stringify(this['@data']);
};

module.exports = Fabric;
