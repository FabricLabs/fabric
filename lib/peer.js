'use strict';

var crypto = require('crypto');
var util = require('util');

// to use the Vectorspace as our store (i.e., we're ephemereal)
// var Store = require('./vector');
// otherwise...
var Stash = require('./stash');

// TODO: configure
var KEY_SIZE = 20; // 20 bytes -> 160 bits for kad addresses

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

Peer.prototype._connect = async function initiate (notify) {
  var self = this;

  self.emit('log', 'peer connecting...');

  var commitment = self._serialize(self['@data']);
  var seed = crypto.randomBytes(KEY_SIZE);
  
  var id = seed;
  var type = '/types/identity'; // path to _lookup()
  var store = new Stash(); // TODO: eval() ;)

  self.emit('log', ['[PEER]', 'emitting (',type,'):', id ]);
  self.emit('identity', id);

  self['@id'] = self['@data'];
  
  //await store.close();

  return self;

  //node.on('error', notify);

}

Peer.prototype.send = function message () {
  
}

module.exports = Peer;
