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

      // self.use(name, structure);
      // TODO: decide on resource['@data'] vs. resource (new)
      self.resources[name] = resource;

      self._sign();
    } catch (E) {
      console.error(E);
    }

    return this;
  }

  async register (component) {
    this.components[component.name] = component;
  }

  async render (component) {
    this.components[component.name].render(this.state);
  }

  /**
   * Defer control of this application to an outside authority.
   * @param  {String} authority Hostname to trust.
   * @return {App}           The configured application as deferred to `authority`.
   */
  async defer (authority) {
    let self = this;
    let resources = {};

    console.warn('[APP]', 'deferring authority:', authority);

    if (typeof authority === 'string') {
      self.remote = new Fabric.Remote({
        host: authority
      });
      resources = await self.remote.enumerate();
    } else {
      resources = authority.resources;
    }

    if (!resources) {
      resources = {};
    }

    self.consume(resources);

    if (window && window.page) {
      // load the Index
      window.page('/', function (context) {
        console.log('Hello, navigator.');
        console.log('Context:', context);
        self.element.navigate('fabric-splash', context);
      });

      window.page();
    }

    return this;
  }

  /**
   * Define the Application's resources from an existing resource map.
   * @param  {Object} resources Map of resource definitions by name.
   * @return {App}           Configured instance of the Application.
   */
  consume (resources) {
    let self = this;

    self.element.resources = resources;

    for (let key in resources) {
      let def = resources[key];
      self.define(def.name, def);
    }

    return this;
  }

  /**
   * Configure the Application to use a specific element.
   * @param  {DOMElement} element DOM element to bind to.
   * @return {App}           Configured instance of the Application.
   */
  attach (element) {
    this.element = element;
    return this;
  }

  _explore (input) {
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
  }

  use (name, definition) {
    super.use(name, definition);
    console.log('[APP]', 'using:', name, definition);
  }
}

module.exports = App;
