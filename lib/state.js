'use strict';

const crypto = require('crypto');
const monitor = require('fast-json-patch');
const EventEmitter = require('events').EventEmitter;

/**
 * State.
 * @property {Map} @id Unique identifier for this data.
 */
class State extends EventEmitter {
  /**
   * Creates a snapshot of some information.
   * @param  {Mixed} data Input data.
   * @return {State}      Resulting state.
   */
  constructor (data) {
    super(data);

    /**
     * Identity function.
     * @type {Boolean}
     */
    Object.defineProperty(this, 'id', {
      enumerable: true,
      get: function fingerprint () {
        // TODO: have serialize always return {@link Buffer}
        let input = this.serialize(this['@data']);
        let hash = crypto.createHash('sha256').update(input).digest('hex');

        this['@type'] = 'State'; // TODO: move to Fabric
        this['@size'] = input.length;
        this['@input'] = input;
        this['@version'] = 1;
        this['@buffer'] = Buffer.from(input);
        this['@encoding'] = 'json';
        this['@integrity'] = `sha256:${hash}`;
        this['@method'] = 'sha256';
        this['@output'] = hash;

        return hash;
      }
    });

    Object.defineProperty(this, 'domain', {
      enumerable: false
    });

    Object.defineProperty(this, '_events', {
      enumerable: false
    });

    Object.defineProperty(this, '_eventsCount', {
      enumerable: false
    });

    Object.defineProperty(this, '_maxListeners', {
      enumerable: false
    });

    // start at zero
    this.clock = 0;

    // set various #meta
    this['@type'] = 'State';
    this['@data'] = Object.assign({}, data);
    this['@id'] = this.id;

    // set internal data
    this.name = this['@data'].name || `/states/${this['@id']}`;
    this.tags = [];

    // attach observer
    this.observer = monitor.observe(this['@data']);

    return this;
  }

  /**
   * Marshall an input {@link Blob} into an instance of a {@link State}.  States have
   * absolute authority over their own domain, so choose your States wisely.
   * @param  {Mixed} input Arbitrary input.
   * @return {State}       Resulting instance of the {@link State}.
   */
  static fromString (input) {
    return this.prototype.deserialize(input);
  }

  /**
   * Unmarshall an existing state to an instance of a {@link Blob}.
   * @return {String} Serialized {@link Blob}.
   */
  toString () {
    let cache = {};

    for (let name in this['@data']) {
      if (name.charAt(0) === '@') continue;
      cache[name] = this['@data'][name];
    }

    return this.serialize(cache);
  }

  overlay (data) {
    let state = new State(data);
    this['@parent'] = this['@id'];
    this['@data'] = Object.assign({}, this['@data'], state['@data']);
    this['@did'] = `did:fabric:${this.id}`;
    this['@id'] = this.id;
    return this;
  }

  serialize (input) {
    if (!input) input = this['@data'];
    if (input instanceof Array) {
      return JSON.stringify(this['@data']);
    }

    // State is (otherwise) always an object
    let state = {};

    for (let name in input) {
      if (name.charAt(0) === '@') {
        continue;
      } else {
        state[name] = input[name];
      }
    }

    return JSON.stringify(state);
  }

  deserialize (input) {
    let output = null;

    try {
      output = JSON.parse(input);
    } catch (E) {
      console.error(`Exception parsing input: `, E);
    }

    return output;
  }

  commit () {
    ++this.clock;

    this['@preimage'] = this.toString();
    this['@constructor'] = this.constructor;
    this['@changes'] = monitor.generate(this.observer);
    this['@id'] = this.id;

    if (this['@changes'].length) {
      this.emit('changes', this['@changes']);
    }

    return this;
  }

  render () {
    this.commit();
    return `<State id="${this.id}" integrity="sha256:${this.id}" />`;
  }
}

module.exports = State;
