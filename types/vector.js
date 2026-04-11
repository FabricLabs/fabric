'use strict';

const EventEmitter = require('events');

/**
 * @classdesc Lightweight <strong>event sink</strong> for instruction-stream and VM-adjacent signals.
 * Former {@link State}-backed fields (<code>script</code>, <code>stack</code>, <code>known</code>, serialization helpers)
 * live on {@link Machine} and {@link State} / {@link Fabric#push} instead.
 * @class Vector
 * @extends EventEmitter
 */
class Vector extends EventEmitter {
  /**
   * @param {Object} [options] Optional emitter options (e.g. <code>captureRejections</code>).
   */
  constructor (options) {
    super(options);
    return this;
  }
}

module.exports = Vector;
