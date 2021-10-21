'use strict';

const crypto = require('crypto');

// Fabric Components
const State = require('./state');

/**
 * Simple tag-based recordkeeper.
 * @extends State
 * @property {Object} config Current configuration.
 */
class Scribe extends State {
  /**
   * The "Scribe" is a simple tag-based recordkeeper.
   * @param       {Object} config General configuration object.
   * @param       {Boolean} config.verbose Should the Scribe be noisy?
   */
  constructor (config = {}) {
    super(config);

    // assign the defaults;
    this.settings = Object.assign({
      verbose: true,
      verbosity: 2, // 0 none, 1 error, 2 warning, 3 notice, 4 debug
      path: './stores/scribe',
      tags: []
    }, config);

    // internal state
    this._state = new State(config);

    // signal ready
    this.status = 'ready';

    return this;
  }

  /** Retrives the current timestamp, in milliseconds.
   * @return {Number} {@link Number} representation of the millisecond {@link Integer} value.
   */
  now () {
    // return new Date().toISOString();
    return new Date().getTime();
  }

  sha256 (data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  _sign () {
    this.commit();
  }

  /**
   * Blindly bind event handlers to the {@link Source}.
   * @param  {Source} source Event stream.
   * @return {Scribe}        Instance of the {@link Scribe}.
   */
  trust (source) {
    let self = this;

    source.on('message', async function handleTrustedMessage (msg) {
      // console.trace('[FABRIC:SCRIBE]', 'Our Scribe received the following message from a trusted source:', msg);
    });

    source.on('transaction', async function handleTrustedTransaction (transaction) {
      self.log('[SCRIBE]', '[EVENT:TRANSACTION]', 'apply this transaction to local state:', transaction);
      self.log('[PROPOSAL]', 'apply this transaction to local state:', transaction);
    });

    return self;
  }

  /**
   * Use an existing Scribe instance as a parent.
   * @param  {Scribe} scribe Instance of Scribe to use as parent.
   * @return {Scribe}        The configured instance of the Scribe.
   */
  inherits (scribe) {
    return this.tags.push(scribe.settings.namespace);
  }

  log (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.settings.verbosity >= 3) {
      console.log.apply(null, ['[SCRIBE]'].concat(inputs));
    }

    return this.emit('info', ['[SCRIBE]'].concat(inputs));
  }

  error (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.settings.verbose) {
      console.error.apply(null, ['[SCRIBE]'].concat(inputs));
    }

    return this.emit('error', ['[SCRIBE]'].concat(inputs));
  }

  warn (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.settings.verbose) {
      console.warn.apply(null, ['[SCRIBE]'].concat(inputs));
    }

    return this.emit('warning', ['[SCRIBE]'].concat(inputs));
  }

  debug (...inputs) {
    let now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.settings.verbose) {
      console.debug.apply(null, ['[SCRIBE]'].concat(inputs));
    }

    return this.emit('debug', ['[SCRIBE]'].concat(inputs));
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
    this.status = 'starting';
    this['@data'] = this.settings;

    await this.open();
    await this.commit();

    // TODO: enable
    // this.trust(this.state);

    this.status = 'started';

    return this;
  }

  async stop () {
    this.status = 'stopping';
    await this.close();
    this.status = 'stopped';
    return this;
  }
}

module.exports = Scribe;
