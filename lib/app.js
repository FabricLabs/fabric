'use strict';

const util = require('util');
const jade = require('jade');

const Fabric = require('./fabric');

// TODO: use exports from Fabric
const Peer = require('./peer');
const Remote = require('./remote');
const Resource = require('./resource');
const Storage = require('./storage');
const Validator = require('./validator');
const Worker = require('./worker');

if (process.env.APP_ENV === 'browser') {
  const page = require('page');
}

function App (init) {
  if (!init) init = {};
  if (!init.resources) init.resources = {};

  this['@data'] = init;
  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.tips = new Storage({ path: './data/tips' });
  this.stash = new Storage({ path: './data/stash' });
  this.worker = new Worker();

  this.network = {};
  this.authorities = {};
  this.resources = {};

  this.init();
}

util.inherits(App, Fabric);

/**
 * Defer control of this application to an outside authority.
 * @param  {String} authority Hostname to trust.
 * @return {App}           The configured application as deferred to `authority`.
 */
App.prototype._defer = async function (authority) {
  var self = this;
  var resources = {};
  
  console.warn('[APP]', 'deferring authority:', authority);
  
  if (typeof authority == 'string') {
    var remote = new Remote({
      host: authority
    });

    resources = await remote.enumerate();
  } else {
    resources = authority.resources;
  }
  
  if (!resources) {
    resources = {};
  }

  self._consume(resources);
  
  if (typeof page === 'function') {
    page('/', function (context) {
      console.log('ohai');
      self.element.navigate('fabric-splash', context);
    });

    page();
  }

  self.remote = remote;

};

App.prototype._consume = function (resources) {
  var self = this;
  
  self.element.resources = resources;
  

  for (var key in resources) {
    var def = resources[key];
    self.define(def.name, def);
  }
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

App.prototype.attach = function consume (element) {
  this.element = element;
};

/**
 * Define a Resource.
 * @param  {String} name      [description]
 * @param  {Object} structure [description]
 * @return {Object}           [description]
 */
App.prototype.define = async function initialize (name, structure) {
  var self = this;
  var index = self['@data'].resources[name];
  if (!index) {
    var resource = new Resource(structure);
    resource._sign();

    structure.data = await self.stash.get(structure.routes.query) || [];
    
    
    self['@data'].resources[name] = resource;
    
    self._sign();
    
    console.log('signed:', self['@id']);
    
    self.resources[name] = resource;

    console.log('structure:', structure);

    if (structure.routes.query && typeof page === 'function') {
      page(structure.routes.query, function query (context) {
        console.log('navigating:', structure, context);
        self.element.navigate(structure.components.query, context);
      });
    }
    
    if (structure.routes.get && typeof page === 'function') {
      page(structure.routes.get, function get (context) {
        self.element.navigate(structure.components.get, context);
      });
    }
    
    return resource;

  } else {
    console.log('[APP]', 'existing definition:', index.name, index['@id']);
    return this;
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
