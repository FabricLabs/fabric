'use strict';

const Vector = require('./vector');

/**
 * Simple tag-based recordkeeper.
 * @property {Object} config Current configuration.
 */
class Scribe extends Vector {
  /**
   * The "Scribe" is a simple tag-based recordkeeper.
   * @param       {Object} config General configuration object.
   * @param       {Boolean} config.verbose Should the Scribe be noisy?
   */
  constructor (config) {
    super(config);
    this.config = Object.assign({
      verbose: true
    }, config);
    this.stack = [];
  }

  static now () {
    // return new Date().toISOString();
    return new Date().getTime();
  }

  /**
   * Use an existing Scribe instance as a parent.
   * @param  {Scribe} scribe Instance of Scribe to use as parent.
   * @return {Scribe}        The configured instance of the Scribe.
   */
  inherits (scribe) {
    return this.stack.push(scribe.config.namespace);
  }

  log (...inputs) {
    let now = this.constructor.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.config.verbose) {
      console.log.apply(null, this.stack.concat(inputs));
    }

    return this.emit('info', this.stack.concat(inputs));
  }

  error (...inputs) {
    let now = this.constructor.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.config.verbose) {
      console.error.apply(null, this.stack.concat(inputs));
    }

    return this.emit('error', this.stack.concat(inputs));
  }

  warn (...inputs) {
    let now = this.constructor.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.config.verbose) {
      console.warn.apply(null, this.stack.concat(inputs));
    }

    return this.emit('warning', this.stack.concat(inputs));
  }
}

module.exports = Scribe;
