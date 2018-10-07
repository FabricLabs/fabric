'use strict';

const crypto = require('crypto');
const monitor = require('fast-json-patch');

// Fabric Components
const State = require('./state');

/**
 * Simple tag-based recordkeeper.
 * @property {Object} config Current configuration.
 */
class Scribe extends State {
  /**
   * The "Scribe" is a simple tag-based recordkeeper.
   * @param       {Object} config General configuration object.
   * @param       {Boolean} config.verbose Should the Scribe be noisy?
   */
  constructor (config) {
    super(config);
    this.config = Object.assign({
      path: './data/scribe'
    }, config);

    this.tags = [];
    this.state = new State(config);

    // monitor for changes
    this.observer = monitor.observe(this.state['@data']);

    // signal ready
    this.status = 'ready';

    return this;
  }

  now () {
    // return new Date().toISOString();
    return new Date().getTime();
  }

  sha256 (data) {
    return crypto.createHash('sha256').update(data).digest();
  }

  /**
   * Use an existing Scribe instance as a parent.
   * @param  {Scribe} scribe Instance of Scribe to use as parent.
   * @return {Scribe}        The configured instance of the Scribe.
   */
  inherits (scribe) {
    return this.tags.push(scribe.config.namespace);
  }

  log (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.config && this.config.verbose) {
      console.log.apply(null, this.tags.concat(inputs));
    }

    return this.emit('info', this.tags.concat(inputs));
  }

  error (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.config.verbose) {
      console.error.apply(null, this.tags.concat(inputs));
    }

    return this.emit('error', this.tags.concat(inputs));
  }

  warn (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.config.verbose) {
      console.warn.apply(null, this.tags.concat(inputs));
    }

    return this.emit('warning', this.tags.concat(inputs));
  }

  debug (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.config.verbose) {
      console.debug.apply(null, this.tags.concat(inputs));
    }

    return this.emit('debug', this.tags.concat(inputs));
  }

  async open () {
    this.status = 'opened';
    return this;
  }

  async close () {
    this.status = 'closed';
    return this;
  }

  async start () {
    // console.log('[SCRIBE]', `[${this.constructor.name.toUpperCase()}]`, 'starting with state:', this.state);

    this.state.on('changes', function (changes) {
      console.log('got changes in scribe:', changes);
      monitor.applyPatches(this.state['@data'], changes);
    });

    this.status = 'started';

    return this;
  }

  async stop () {
    this.status = 'stopped';
    return this;
  }

  async init () {
    return this;
  }

  async _sign (data) {
    console.warn('[SCRIBE]', '[DEPRECATED]', '_sign', '_sign is deprecated in favor of the deterministic "@id" property.');
    if (!data) data = JSON.stringify(this.state['@data']);
    this['@preimage'] = data;
    this['@id'] = crypto.createHash('sha256').update(data).digest('hex');
    return this;
  }
}

module.exports = Scribe;
