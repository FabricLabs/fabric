'use strict';

const Fabric = require('./fabric');

if (process.env.APP_ENV === 'browser') {
  window.page = require('page');
}

class App extends Fabric {
  /**
   * Generic bundle for building Fabric applications.
   * @param  {Object} definition Application definition.  See `config` for examples.
   * @return {App}            Returns an instance of `App`.
   */
  constructor (definition) {
    super(definition);

    if (!definition) definition = {};
    if (!definition.resources) definition.resources = {};

    this['@data'] = definition;

    this.tips = new Fabric.Storage({ path: './data/tips' });
    this.stash = new Fabric.Storage({ path: './data/stash' });
    // this.worker = new Worker();

    this.network = {};
    this.authorities = {};
    this.components = {};
    this.resources = {};
    this.templates = {};
    this.keys = [];

    this.init();

    return this;
  }

  async start () {
    await super.start();
    console.log('[APP]', 'started!');
    return this;
  }

  async stop () {
    console.log('[APP]', 'stopping...');
    await super.stop();

    await this.tips.close();
    await this.stash.close();

    return this;
  }

  use (name, definition) {
    super.use(name, definition);
    console.log('[APP]', 'using:', name, definition);
  }

  /**
   * Define a Resource, or "Type", used by the application.
   * @param  {String} name      Human-friendly name for the Resource.
   * @param  {Object} structure Map of attribute names -> definitions.
   * @return {Object}           [description]
   */
  async define (name, structure) {
    let self = this;

    console.log('[APP]', 'defining:', name, structure);

    try {
      let resource = new Fabric.Resource(structure);

      resource._sign();
      resource.trust(self.stash);

      self.use(name, structure);
      // TODO: decide on resource['@data'] vs. resource (new)
      self.resources[name] = resource;

      self._sign();
    } catch (E) {
      console.error(E);
    }

    return this;

    let index = self['@data'].resources[name];
    if (!index) {
      let resource = Resource(structure)._sign();

      structure.data = await self.stash.get(structure.routes.query) || [];

      self['@data'].resources[name] = resource;
      
      self._sign();
      
      console.log('signed:', self['@id']);
      
      self.resources[name] = resource;

      self.keys.push(resource.routes.query);

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
  }

  async register (component) {
    this.components[component.name] = component;
  }

  async render (component) {
    this.components[component.name].render(this['@data']);
  }
}

/**
 * Defer control of this application to an outside authority.
 * @param  {String} authority Hostname to trust.
 * @return {App}           The configured application as deferred to `authority`.
 */
App.prototype._defer = async function (authority) {
  let self = this;
  let resources = {};

  console.warn('[APP]', 'deferring authority:', authority);

  if (typeof authority === 'string') {
    let remote = new Fabric.Remote({
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

  return this;
};

/**
 * Define the Application's resources from an existing resource map.
 * @param  {Object} resources Map of resource definitions by name.
 * @return {App}           Configured instance of the Application.
 */
App.prototype._consume = function (resources) {
  let self = this;

  self.element.resources = resources;

  for (let key in resources) {
    let def = resources[key];
    self.define(def.name, def);
  }

  return this;
};

/**
 * Configure the Application to use a specific element.
 * @param  {DOMElement} element DOM element to bind to.
 * @return {App}           Configured instance of the Application.
 */
App.prototype.attach = function consume (element) {
  this.element = element;
  return this;
};

App.prototype._explore = function (input) {
  let self = this;
  let peer = new Fabric.Peer({
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
    console.log('data: ' + data);
  });

  self.network[peer['@id']] = peer;

  return self;
};

App.prototype.test = function () {
  this.stash.set('/messages', [{
    message: 'hello, world'
  }]);
};

App.prototype.request = function (path) {
  this.log('Not yet implemented: App.request()');
  // worker.route(path);
};

App.prototype.element = function () {
  return document.createElement('div');
};

module.exports = App;
