'use strict';

const crypto = require('crypto');
const monitor = require('fast-json-patch');

const Scribe = require('./scribe');

class Vector extends Scribe {
  /**
   * An "Initialization" Vector.
   * @param       {Object} - Input state (will map to `@data`.)
   * @constructor
   */
  constructor (origin) {
    super(origin);

    if (!(this instanceof Vector)) {
      return new Vector(origin);
    }

    this.state = Object.assign({}, origin);

    this.known = {};
    this.registry = {};

    this.stack = [];
    this.script = [];

    this.status = 'initialized';

    return this;
  }

  async step () {
    return super.compute((this.clock | 0));
  }

  /**
   * _serialize is a placeholder, should be discussed.
   * @param {String} input - What to serialize.  Defaults to `this.state`.
   * @return {String} - resulting string [JSON-encoded version of the local `@data` value.]
   */
  _serialize (input) {
    return this.toString(input);
  }

  _deserialize (input) {
    return this.fromString(input);
  }

  // TODO: standardize on a serialization format
  fromString (input) {
    return JSON.parse(input);
  }

  /**
   * Render the output to a {@link String}.
   * @param  {Mixed} input Arbitrary input.
   * @return {String}
   */
  toString (input) {
    if (!input) input = this.state;
    // TODO: standardize on a serialization format
    return JSON.stringify(input);
  }

  validate (input) {
    return true;
  }
}

Vector.prototype._deserialize = function fromString (input) {
  // TODO: standardize on a serialization format
  return JSON.parse(input);
};

Vector.prototype._orderSpace = function sortObject (o) {
  // if not a real object, consider it pre-sorted
  if (o !== Object(o)) return o;

  // TODO: implement this recursively
  return Object.keys(o).sort().reduce(function (result, key) {
    result[key] = o[key];
    return result;
  }, {});
};

Vector.prototype.toObject = function toObject () {
  let object = {};
  for (let property in this['@data']) {
    if (property.charAt(0) !== '@') {
      object[property] = this['@data'][property];
    }
  }
  return object;
};

/**
 * Compute the `sha256` hash of the input entity's `@data` field.
 * @param  {Object} entity Input object; expects `@data`.
 * @return {Object}        Transformed entity with `@id` set to the `sha256` hash of `@data`.
 */
Vector.prototype._identify = function (entity) {
  let sort = this._orderSpace(entity['@data']);
  let raw = this._serialize(sort);

  entity['@id'] = crypto.createHash('sha256').update(raw).digest('hex');

  return entity;
};

Vector.prototype._sign = function identify () {
  let sort = this._orderSpace(this['@data']);
  let raw = this._serialize(sort);
  let now = Date.now();

  if (!this.created) this.created = now;
  if (!this.logs) this.logs = [];
  if (!raw) return this;

  this['@id'] = crypto.createHash('sha256').update(raw).digest('hex');

  if (!this.id) this.id = this['@id'];

  this.emit('claim', [this['@id'], raw]);
  // this.log('[VECTOR]', 'claim:', this['@id'], typeof raw, '<' + raw.length + '>', raw);

  this.known[this['@id']] = this['@data'];
  // this.emit('mutation', monitor.generate(this.observer));

  return this;
};

Vector.prototype.patch = function apply (patchset) {
  let self = this;
  monitor.applyPatch(self['@data'], patchset);

  return self;
};

module.exports = Vector;
