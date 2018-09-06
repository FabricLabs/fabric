'use strict';

const crypto = require('crypto');
const monitor = require('fast-json-patch');

class Vector extends require('events').EventEmitter {
  /**
   * An "Initialization" Vector.
   * @param       {Object} - Input state (will map to `@data`.)
   * @constructor
   */
  constructor (a) {
    super(a);

    if (!(this instanceof Vector)) {
      return new Vector(a);
    }

    this['@data'] = a || {};

    this.clock = 0;
    this.known = {};
    this.stack = [];
    this.script = [];

    this.init();

    return this;
  }
}

Vector.prototype.registry = {};

Vector.prototype.init = function attach () {
  var self = this;
  self.observer = monitor.observe(self['@data']);
  return this;
};

Vector.prototype.log = function report (...msg) {
  this.emit('info', {
    name: this.name,
    params: [...msg]
  });
};

Vector.prototype.debug = function report (...msg) {
  this.emit('debug', {
    name: this.name,
    params: [...msg]
  });
};

Vector.prototype.use = function define (method, plugin) {
  var self = this;
  self.known[method] = plugin;
};

Vector.prototype.validate = function validate (input) {
  return true;
};

/**
 * _serialize is a placeholder, should be discussed.
 * @param {String} input - What to serialize.  Defaults to `this['@data']`.
 * @return {String} - resulting string [JSON-encoded version of the local `@data` value.]
 */
Vector.prototype._serialize = function toString (input) {
  if (!input) input = this['@data'];
  // TODO: standardize on a serialization format
  return JSON.stringify(input);
};

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

  if (!raw) return this;

  this['@id'] = crypto.createHash('sha256').update(raw).digest('hex');

  if (!this.id) this.id = this['@id'];

  this.emit('claim', [this['@id'], raw]);
  // console.debug('[VECTOR]', 'claim:', this['@id'], typeof raw, '<' + raw.length + '>', raw);

  this.registry[this['@id']] = this['@data'];
  this.emit('mutation', monitor.generate(this.observer));

  return this;
};

Vector.prototype.patch = function apply (patchset) {
  let self = this;
  monitor.applyPatch(self['@data'], patchset);

  return self;
};

/**
 * Combine two vectors.
 * @param  {Vector} input [description]
 * @return {Array}       Native sequence.
 */
Vector.prototype.add = function (input) {
  if (!input) input = true;
  if (!(input instanceof Array)) input = [input];

  let start = this;

  var result;

  let a = input.pop()['@data'];
  let b = input.pop()['@data'];

  // TODO: PoW determinism
  if (a === Object(a) && b === Object(b)) {
    result = Object.assign(a, b);
    //result = Object.assign(a['@data'], b['@data']);
  } else {
    let A = parseInt(a) || false;
    let B = parseInt(b) || false;

    if (A && B) {
      result = A + B;
    } else {
      result = false;
    }
  }
  start['@data'] = result;
  return result;
};

/**
 * Computes the next "step" for our current Vector.  Analagous to `sum`.
 * The top item on the stack is always the memory held at current position,
 * so counts should always begin with 0.
 * @param  {Vector} input - Input state, undefined if desired.
 * @return {Vector} - Makes this Vector chainable.  Possible antipattern.
 */
Vector.prototype.compute = async function step (input) {
  this.clock += 1;

  let self = this;

  if (!input) input = new Vector();
  if (!(input instanceof Vector)) input = new Vector(input);

  for (var i = 0; i < self.script.length; i++) {
    let step = self.script[i];
    let instruction = step['@data'];
    let transmute = self.known[instruction];
    if (!transmute) {
      self['@data'] = step;
      self.stack.push(step);
    } else {
      let result = await transmute.call(self, self.stack);
      let vector = new Vector(result)._sign();

      self['@data'] = result;
      self.stack.push(vector);
    }
  }

  self._sign();
  self.output = self['@data'];

  return self['@data'];
};

Vector.prototype.render = function log () {
  var self = this;
  var obj = self['@data'];
  
  obj._sign();

  return obj;
};

module.exports = Vector;
