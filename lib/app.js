'use strict';

const Remote = require('./remote');
const Resource = require('./resource');
const Scribe = require('./scribe');
const State = require('./state');
const Storage = require('./store');

/**
 * Web-friendly application framework for building single-page applications with
 * Fabric-based networking and storage.
 * @property {Collection} components Interface elements.
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

    this['@data'] = definition;

    this.tips = new Storage({ path: './data/tips' });
    this.stash = new Storage({ path: './data/stash' });
    // this.worker = new Worker();

    this.name = 'application';
    this.network = {};
    this.element = document.createElement('fabric-app');
    this.bindings = {};
    this.authorities = {};
    this.components = {};
    this.resources = {};
    this.templates = {};
    this.keys = [];

    this.commit();

    return this;
  }

  _bindEvents (element) {
    for (let name in this.bindings) {
      element.addEventListener(name, this.bindings[name]);
    }

    return element;
  }

  _unbindEvents (element) {
    for (let name in this.bindings) {
      element.removeEventListener(this.bindings[name]);
    }

    return element;
  }

  /**
   * Start the program.
   * @return {Promise}
   */
  async start () {
    this.log('[APP]', 'started!');
    return this;
  }

  /**
   * Stop the program.
   * @return {Promise}
   */
  async stop () {
    this.log('[APP]', 'stopping...');

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
    let element = document.querySelector(selector);
    if (!element) {
      this.log('[FABRIC:APP]', 'envelop()', 'could not find element:', selector);
      return null;
    }

    this._bindEvents(element);
    this.attach(element);

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
   * @return {String}           Output of the program.
   */
  render (component) {
    let rendered = `<fabric-${this.name.toLowerCase()} />`;
    let sample = new State(rendered);

    if (this.element) {
      this.element.setAttribute('integrity', `sha256:${sample.id}`);
      this.element.innerHTML = rendered;
    }

    return rendered;
  }
}

module.exports = App;
