'use strict';

const util = require('util');

const Fabric = require('./fabric');
const Vector = require('./vector');
const Stash = require('./stash');

const Remote = require('./remote');
const Worker = require('./worker');
const Peer = require('./peer');

function App (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.stash = new Stash();
  this.worker = new Worker();
  
  this.network = {};
  this.authorities = {};

  this.init();
}

util.inherits(App, Fabric);

App.prototype._defer = async function (authority) {
  var self = this;
  
  console.log('[APP]', 'deferring authority:', authority);
  
  var remote = new Remote({
    host: authority
  });
  
  var output = await remote._OPTIONS('/'); // TODO: use OPTIONS

  console.log('output:', output);

  for (var key in output.resources) {
    var def = output.resources[key];
    self.define(def.name, def);
  }
};

App.prototype._explore = function (input) {
  var self = this;
  var peer = new Peer({
    initiator: true
  });
  
  peer.compute();

  peer.on('error', function (err) {
    console.error(err);
  });

  peer.on('signal', function (data) {
    console.log('signal:', data);
  });

  peer.on('connect', function () {
    console.log('CONNECT');
    peer.send('whatever' + Math.random());
  });

  peer.on('data', function (data) {
    console.log('data: ' + data)
  });

  self.network[peer['@id']] = peer;

}

App.prototype._load = function configure (config) {
  var self = this;

  this.resources = [];
  
  Object.keys(self['@data'].resources).forEach(function(name) {
    var resource = self['@data'].resources[name];
    console.log('loading:', name, resource.prototype);
    self.define(name, {
      attributes: resource.prototype.attributes,
      components: resource.prototype.components,
    });
  });
  
  Object.keys(self['@data'].authorities).forEach(function(host) {
    var remote = new Remote({
      host: host
    });
    
    self.authorities[host] = remote;
  });
  
  this.compute();
  
  console.log('app loaded!');
  console.log('app:', self);
};

App.prototype.route = function handle (path) {
  
}

App.prototype.define = function initialize (name, structure) {
  var self = this;
  var index = self['@data'].resources[name];
  if (!index) {
    console.log('[APP]', 'defining:', name, structure);
    var vector = new Vector(structure);
    
    vector._sign();
    
    self['@data'].resources[name] = vector;
    self.resources[name] = structure;
  } else {
    console.log('[APP]', 'existing definition:', index.name, index['@id']);
  }
};

App.prototype.test = function () {
  this.stash.set('/messages', [{
    message: 'hello, world'
  }]);
};

App.prototype.request = function (path) {
  worker.route(path);
};

App.prototype.element = function () {
  return document.createElement('div');
};

module.exports = App;
