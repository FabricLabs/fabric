'use strict';

// Dependencies
const merge = require('lodash.merge');

// Types
const Actor = require('./actor');
const KeyStore = require('./keystore');
const Machine = require('./machine');
const Message = require('./message');
const Peer = require('./peer');
const Remote = require('./remote');
const Resource = require('./resource');
const Scribe = require('./scribe');
const Storage = require('./store');
// const Swarm = require('./swarm');

/**
 * Web-friendly application framework for building single-page applications with
 * Fabric-based networking and storage.
 * @extends Scribe
 * @property {Collection} components Interface elements.
 * @property {Store} stash Routable {@link Datastore}.
 */
class App extends Scribe {
  /**
   * Generic bundle for building Fabric applications.
   * @param  {Object} definition Application definition.  See `config` for examples.
   * @return {App}            Returns an instance of `App`.
   */
  constructor (definition = {}) {
    super(definition);

    if (!definition.resources) definition.resources = {};

    this.settings = this['@data'] = Object.assign({
      seed: 1,
      path: './stores/fabric-application',
      prefix: '/',
      services: []
    }, definition);

    // Internal Components
    this.node = new Peer(this.settings);
    this.actor = new Actor(this.settings);
    this.machine = new Machine(this.settings);
    this.store = new KeyStore(this.settings);

    // TODO: replace these with KeyStore
    this.tips = new Storage({ path: './stores/tips' });
    this.stash = new Storage({ path: './stores/stash' });

    // TODO: debug these in browser
    // this.swarm = new Swarm();
    // this.worker = new Worker();

    this.name = 'application';
    this.network = {};

    // TODO: debug this in browser
    // this.element = document.createElement('fabric-app');

    // Assign Properties
    this.bindings = {};
    this.authorities = {};
    this.components = {};
    this.elements = {};
    this.services = {};
    this.commands = {};
    this.resources = {};
    this.templates = {};
    this.keys = [];

    // Listen for Patches
    this.stash.on('patches', function (patches) {
      console.log('[FABRIC:APP]', 'heard patches!', patches);
    });

    if (this.settings.resources) {
      for (const name in this['@data'].resources) {
        this.set(this.settings.prefix + this['@data'].resources[name].components.list, []);
      }
    }

    // State
    this._state = {
      anchor: 'BTC',
      chains: {}
    };

    this.commit();

    return this;
  }

  _bindEvents (element) {
    for (const name in this.bindings) element.addEventListener(name, this.bindings[name]);
    return element;
  }

  _unbindEvents (element) {
    for (const name in this.bindings) element.removeEventListener(this.bindings[name]);
    return element;
  }

  async bootstrap () {
    return true;
  }

  /**
   * Start the program.
   * @return {Promise}
   */
  async start () {
    this._appendMessage(`[FABRIC:APP] @${this.id} -- Starting...`);
    this.status = 'STARTING';

    for (const [name, service] of Object.entries(this.services)) {
      this._appendWarning(`@${this.id} -- Checking for Service: ${name}`);
      if (this.settings.services.includes(name)) {
        this._appendWarning(`Starting service: ${name}`);
        await this.services[name]._bindStore(this.store);
        await this.services[name].start();
      }
    }

    // Start P2P node
    this.node.start();
    this.status = 'STARTED';
    this.emit('ready');
    this._appendMessage(`[FABRIC:APP] @${this.id} -- Started!`);

    return this;
  }

  /**
   * Stop the program.
   * @return {Promise}
   */
  async stop () {
    this.log('[APP]', 'stopping...');

    await this.node.stop();
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

    self.log('[APP]', 'defining:', name, structure);

    try {
      let resource = new Resource(structure);

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
      self.remote = new Remote({
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
        self.log('Hello, navigator.');
        self.log('Context:', context);
        self.element.navigate('fabric-splash', context);
      });

      window.page();
    }

    return this;
  }

  async _appendMessage (msg) {
    console.log(`[${(new Date()).toISOString()}]: ${msg}`);
  }

  async _appendWarning (msg) {
    console.warn(`[${(new Date()).toISOString()}]: ${msg}`);
  }

  async _appendError (msg) {
    console.error(`[${(new Date()).toISOString()}]: ${msg}`);
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
   * Use a CSS selector to find an element in the current document's tree and
   * bind to it as the render target.
   * @param  {String} selector CSS selector.
   * @return {App}          Instance of app with bound element.
   */
  envelop (selector) {
    try {
      let element = document.querySelector(selector);

      if (!element) {
        this.log('[FABRIC:APP]', 'envelop()', 'could not find element:', selector);
        return null;
      }

      this._bindEvents(element);
      this.attach(element);
    } catch (E) {
      console.error('Could not envelop element:', E);
    }

    return this;
  }

  /**
   * Define a named {@link Resource}.
   * @param  {String} name       Human-friendly name for this resource.
   * @param  {Object} definition Map of configuration values.
   * @return {App}            Configurated instance of the {@link App}.
   */
  use (name, definition) {
    this.log('[APP]', 'using:', name, definition);
    super.use(name, definition);
    return this;
  }

  /**
   * Get the output of our program.
   * @return {String} Output of the program.
   */
  render () {
    const actor = new Actor(this._state);
    const html = `<fabric-${this.name.toLowerCase()}>` +
      `\n  <fabric-state id="${actor.id}">` +
      `\n    <fabric-state-json integrity="sha256:${actor.preimage}">${actor.serialize()}</fabric-state-json>` +
      '\n  </fabric-state>' +
      `\n</fabric-${this.name.toLowerCase()}>\n`;

    const sample = new Actor(html);

    if (this.element) {
      this.element.setAttribute('integrity', `sha256:${sample.preimage}`);
      this.element.innerHTML = html;
    }

    return html;
  }

  _registerCommand (command, method) {
    this.commands[command] = method.bind(this);
  }

  /**
   * Registers a named {@link Service} with the application.  Services are
   * standardized interfaces for Fabric contracts, emitting {@link Message}
   * events with a predictable lifecycle.
   * @internal
   * @param {String} name Internal name of the service.
   * @param {Class} Service The ES6 class definition implementing {@link Service}.
   * @returns {Service} The registered service instance.
   */
  _registerService (name, Service) {
    const self = this;
    const service = new Service(merge({}, this.settings, this.settings[name]));

    if (this.services[name]) {
      return this._appendWarning(`Service already registered: ${name}`);
    }

    this.services[name] = service;

    this.services[name].on('error', function (msg) {
      self._appendError(`Service "${name}" emitted error: ${JSON.stringify(msg, null, '  ')}`);
    });

    this.services[name].on('warning', function (msg) {
      self._appendWarning(`Service warning from ${name}: ${JSON.stringify(msg, null, '  ')}`);
    });

    this.services[name].on('message', function (msg) {
      self._appendMessage(`@services/${name} -- <FabricServiceMessage>(${typeof msg}) ${JSON.stringify(msg, null, '  ')}`);
      switch (msg['@type']) {
        case 'ChatMessage':
          self.node.relayFrom(self.node.id, Message.fromVector(['ChatMessage', JSON.stringify(msg)]));
          break;
        default:
          break;
      }
    });

    this.on('identity', function _registerActor (identity) {
      if (this.settings.services.includes(name)) {
        self._appendMessage(`Registering actor on service "${name}": ${JSON.stringify(identity)}`);

        try {
          this.services[name]._registerActor(identity);
        } catch (exception) {
          self._appendError(`Error from service "${name}" during _registerActor: ${exception}`);
        }
      }
    });

    return this.services[name];
  }
}

module.exports = App;
