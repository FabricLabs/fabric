'use strict';

var crypto = require('crypto');
var util = require('util');

// our two external dependencies.
// bcoin, to implement transactions,
// and kad, to implement lookups
// TODO: finish working prototype
// TODO: discuss as a group
var bcoin = require('bcoin');
var kad = require('kad');

// use the Vectorspace as our store (i.e., we're ephemereal)
//var Store = require('./vector');
var Store = require('./store');

// storage.  not really necessary, but useful.
//var levelup = require('levelup');
var level = require('level');

// TODO: configure
var KEY_SIZE = 20; // bytes -> 160 bits for kad addresses

/**
 * [Peer An in-memory representation of a node in our network.]
 * @param       {[Vector]} vector [Initialization Vector for this peer.]
 * @constructor
 */
 function Peer (init) {
   this['@data'] = init || {};
   this.clock = 0;
   this.stack = [];
   this.known = {};
   this.init();
 }

// could be looked up by name of parameter in #3
util.inherits(Peer, require('./vector'));

Peer.prototype._connect = function initiate (notify) {
  var self = this;
  
  self.emit('log', 'peer connecting...');
  
  var commitment = self._serialize(self['@data']);
  var seed = crypto.randomBytes(KEY_SIZE);
  
  var id = seed;
  var type = '/types/identity'; // path to _lookup()
  var store = new Store(); // TODO: eval() ;)

  self.emit('log', ['[PEER]', 'emitting (',type,'):', id ]);
  self.emit('identity', id);

  // TODO: create `Pipe` class to internalize an API here
  var node = kad({
    transport: new kad.HTTPTransport(),
    storage: level(process.env.PWD + '/data/kad/local'),
    //storage: null,
    //storage: store,
    // who am I?
    identity: id,
    contact: {
      hostname: self['@data']['host'],
      port: self['@data']['port'] || 8080
    }
  });
  
  self['@id'] = self['@data'];

  //node.on('error', notify);

}

Peer.prototype.send = function message () {
  
}

module.exports = Peer;
