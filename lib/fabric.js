var util = require('util');
var _ = require('lodash');
var Peer = require('./peer');
var Vector = require('./vector');

/**
 * Fabric Core Library
 * @constructor
 * @param {object} config - configuration object
 */
function Fabric (vector) {
  this.id = 0;
  this['@data'] = vector['@data'];
}

util.inherits(Fabric, Vector);

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
}

// for all known peers locally, ask for data
// aka: promiscuous mode
Fabric.prototype.explore = function crawl () {
  var fabric = this;
  var list = Object.keys(fabric['@data'].peers).forEach(function(x) {
    var host = fabric['@data'].peers[x];
    var peer = new Peer(host);
    
    peer.on('identity', function sandbox (identity) {
      console.log('sandbox inner:', identity);
    });
    
    // neat!
    peer.compute();
  });
}

Fabric.prototype.identify = function generateKeys (vector, notify) {
  if (!vector) vector = {};
  if (!notify) notify = new Function();

  var self = this;
  var identity = {
    key: {
      public: 'foo'
    }
  }
  
  // a "vector" is a known truth, something that we've generated ourselves
  // or otherwise derived truth from an origin (a genesis vector
  self['@data'] = _.merge(self['@data'], vector, identity); // should be equivalent to `f(x + y)`

  this.emit('identity', identity);

  return notify();
}

/**
 * Consume a known state and
 * @constructor
 * @param {object} config - configuration object
 */
Fabric.prototype.render = function consumeState (stateHash, notify) {
  // TODO: stateHash needs a type, maybe `<hash> | <tree>`
  return notify('Not yet implemented.');
}

module.exports = Fabric;
