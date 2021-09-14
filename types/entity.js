'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

/**
 * Live instance of an ARC in Fabric.
 * @type {Object}
 */
class Entity extends EventEmitter {
  /**
   * Generic template for virtual objects.
   * @param  {Object} [data={}] Pass an object to use.
   * @return {Entity}           Instance of the {@link Entity}.
   */
  constructor (data = {}) {
    super(data);

    // allow this entity to be run without the new keyword
    if (!(this instanceof Entity)) return new Entity(data);

    // set internal properties
    this.settings = {
      verbosity: 2 // Information && Warnings
    };

    // configure defaults
    this.actor = Object.assign({}, this._downsample(data));
    this.data = Object.assign({}, data);

    // TODO: use getters/setters to restrict access to these elements
    // remove EventEmitter cruft
    Object.defineProperty(this, '_events', { enumerable: false });
    Object.defineProperty(this, '_eventsCount', { enumerable: false });
    Object.defineProperty(this, '_maxListeners', { enumerable: false });

    // remove mutable variables
    Object.defineProperty(this, 'actor', { enumerable: false });
    // Object.defineProperty(this, 'machine', { enumerable: false });

    // return instance
    return this;
  }

  get version () {
    return 1;
  }

  set state (state) {
    if (!state) throw new Error('State must be provided.');
    this._state = state;
  }

  get state () {
    return Object.assign({}, this._state);
  }

  get buffer () {
    let entity = this;
    return function buffer () {
      return Buffer.from(entity.toJSON(), 'utf8');
    }
  }

  get id () {
    let data = this.toJSON();
    let hash = crypto.createHash('sha256').update(data).digest('hex');
    if (this.settings.verbosity >= 5) console.log('[FABRIC:ENTITY (pending upstream!)]', 'hash:', hash, 'data:', data);
    return hash;
  }

  serialize () {
    return this.toJSON();
  }

  toBuffer () {
    return Buffer.from(this.toString(), 'utf8');
  }

  /**
   * Produces a string of JSON, representing the entity.
   * @return {String} JSON-encoded object.
   */
  toJSON () {
    let result = null;

    switch (this.actor['@type']) {
      default:
        result = JSON.stringify(this.toObject());
        break;
      case 'Function':
        result = this._downsample();
        break;
      case 'Buffer':
      case 'String':
        result = JSON.stringify(this.toString());
        break;
    }

    return result;
  }

  toString () {
    let result = null;

    switch (this.actor['@type']) {
      default:
        result = JSON.stringify(this.actor['@data']);
        break;
      case 'Buffer':
        const buffer = new Uint8Array(this.data);
        const values = Object.values(this.data);
        result = JSON.stringify(values);
        break;
      case 'String':
        // TODO: write up longer-form explanation as to why we use an Array here
        result = this.actor['@data'].map(x => String.fromCharCode(x)).join('');
        // console.log('was string in array? now:', result);
        break;
    }

    return result;
  }

  toObject () {
    return this.actor['@data'];
  }

  /**
   * As a {@link Buffer}.
   * @return {Buffer} Slice of memory.
   */
  toRaw () {
    return Buffer.from(this.toJSON(), 'utf8');
  }

  /**
   * Return a {@link Fabric}-labeled {@link Object} for this {@link Entity}.
   * @param {Mixed} [input] Input to downsample.  If not provided, current Entity will be used. 
   */
  _downsample (input = this.data) {
    let result = {};

    if (typeof input === 'string') {
      result = {
        '@type': 'String',
        '@data': input.split('').map(x => x.charCodeAt(0))
      };
    } else if (input instanceof Array) {
      result = {
        '@type': 'Array',
        '@data': input
      };
    } else if (input instanceof Buffer) {
      result = {
        '@type': 'Buffer',
        '@data': JSON.parse(JSON.stringify(input))[0]
      };
    } else if (input instanceof Function) {
      try {
        result = {
          '@type': 'Function',
          '@data': JSON.stringify(input)
        };
      } catch (E) {
        console.error('Something could not be converted:', E, input);
        process.exit();
      }
    } else {
      try {
        result = {
          '@type': 'Entity',
          '@data': JSON.parse(JSON.stringify(input))
        };
      } catch (E) {
        console.error('Something could not be converted:', E, input);
        process.exit();
      }
    }

    return result;
  }
}

module.exports = Entity;
