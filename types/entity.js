'use strict';

const crypto = require('crypto');

const Events = require('events');
const Machine = require('./machine');

/**
 * Live instance of an ARC in Fabric.
 * @type {Object}
 */
class Entity extends Events.EventEmitter {
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
    this.machine = new Machine();

    // configure defaults
    this.actor = Object.assign({}, this._downsample(data));
    this.data = Object.assign({}, data);

    // remove EventEmitter cruft
    Object.defineProperty(this, '_events', { enumerable: false });
    Object.defineProperty(this, '_eventsCount', { enumerable: false });
    Object.defineProperty(this, '_maxListeners', { enumerable: false });

    // remove mutable variables
    Object.defineProperty(this, 'actor', { enumerable: false });
    Object.defineProperty(this, 'machine', { enumerable: false });

    // return instance
    return this;
  }

  get id () {
    let data = this.toJSON();
    let hash = crypto.createHash('sha256').update(data).digest('hex');
    // console.log('[RPG:ENTITY (pending upstream!)]', 'hash:', hash, 'data:', data);
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
        result = this.toJSON();
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

  _downsample (input) {
    let result = {};

    if (!input) input = this.data;

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
      console.log('[FABRIC:ENTITY]', 'input data:', input);
      console.log('[FABRIC:ENTITY]', 'input stringified by local JS engine:', JSON.stringify(input));
      result = {
        '@type': 'Buffer',
        '@data': JSON.parse(JSON.stringify(input))[0]
      };
    } else {
      try {
        result = {
          '@type': 'Entity',
          '@data': JSON.parse(JSON.stringify(input))
        };
      } catch (E) {
        console.log('Something could not be converted:', E, input);
      }
    }

    return result;
  }
}

module.exports = Entity;
