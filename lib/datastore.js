'use strict';

var util = require('util');

var Ledger = require('../lib/ledger');
var Transaction = require('../lib/transaction');

function Datastore (state) {
  this['@data'] = state || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};
  
  var store = this;

  store.ledger = new Ledger();

  store.init();
}

util.inherits(Datastore, require('./vector'));

Datastore.prototype.identify = function register (identity) {
  this.identity = identity;
}

Datastore.prototype.register = function load (name) {
  this['@data'][name] = [] || new Chain();
  //this['@data'][name]
}

Datastore.prototype.get = function retrieve (key) {
  return this['@data'][key];
}

Datastore.prototype.put = function retrieve (key, value) {
  this['@data'][key] = value;
  return this.get(key);
}

Datastore.prototype._loadFrom = function loadFiles (dir) {
  var fs = require('fs');
  var self = this;

  self.register('/types');
  
  var files = fs.readdirSync(dir);
  for (var i = 0; i < files.length; i++) {
    var content = fs.readFileSync(files[i]);
    self['@data']
  }
}

Datastore.prototype._apply = function transform (delta) {
  var tx = this;
  patch.applyPatch(tx['@data'], delta);
  tx._sign();
}

Datastore.prototype.ping = function play () {
  var datastore = this;
  
  var ping = new Transaction({
    entropy: Math.random(),
    timestamp: Date.now(),
    identity: datastore.identity
  });
  
  ping._sign(datastore.identity);
  
  this['@data']['/pings'].ledger.append(ping);
  //this['@data']['/pings'].ledger.compute();
  //this.compute();
}

Datastore.prototype.pong = function play () {
  console.log('PONG!');
}

Datastore.prototype.spam = function play () {
  var datastore = this;
  for (var i = 0; i < 10; i++) {
    datastore.ping();
  }
}

Datastore.prototype.render = function compile () {
  return {};
}

module.exports = Datastore;
