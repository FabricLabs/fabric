'use strict';

var util = require('util')
var crypto = require('crypto');

var jsonpatch = require('fast-json-patch');

var StateMachine = require('javascript-state-machine');
var StateMachineHistory = require('javascript-state-machine/lib/history')
var Digraph = require('javascript-state-machine/lib/visualize');

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
    this.stack = [];
    this.known = {};
    this.init();
  }
}

Vector.prototype.registry = {};

Vector.prototype.init = function attach () {
  var self = this;
  self.observer = jsonpatch.observe(self['@data']);
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

  //console.log('serializing:', typeof input, input);
  // TODO: standardize on a serialization format
  var output = JSON.stringify(input);
  //console.log('serialized:', output);

  return output;
};

Vector.prototype._deserialize = function fromString (input) {
  // TODO: standardize on a serialization format
  return JSON.parse(input);
};

Vector.prototype._orderSpace = function sortObject (o) {
  var self = this;
  // TODO: implement this recursively
  return Object.keys(o).sort().reduce(function (result, key) {
    result[key] = o[key];
    return result;
  }, {});
};

/**
 * Compute the `sha256` hash of the input entity's `@data` field.
 * @param  {Object} entity Input object; expects `@data`.
 * @return {Object}        Transformed entity with `@id` set to the `sha256` hash of `@data`.
 */
Vector.prototype._identify = function (entity) {
  var self = this;
  var sort = self._orderSpace(entity['@data']);
  var raw = self._serialize(sort);

  entity['@id'] = crypto.createHash('sha256').update(raw).digest('hex');
  
  return entity;
}

/**
 * Serializes internal state and computes an address for this vector.
 * @return {Vector} Fully-computed vector.
 */
Vector.prototype._sign = function identify () {
  var self = this;
  var sort = self._orderSpace(self['@data']);
  var raw = self._serialize(sort);
  
  if (!self.logs) self.logs = [];

  if (!raw) return this;

  self['@id'] = crypto.createHash('sha256').update(raw).digest('hex');

  //console.log('claim:', self['@id'], typeof raw, raw);

  self.registry[self['@id']] = self['@data'];
  self.emit('mutation', jsonpatch.generate(self.observer));

  return self;
};

Vector.prototype.patch = function apply (patchset) {
  var self = this;
  var test = jsonpatch.applyPatch(self['@data'], patchset).newDocument;

  return self;
};

/**
 * Computes the next "step" for our current Vector.
 * @param  {String} input - Input state, undefined if desired.
 * @return {Vector} - Makes this Vector chainable.  Possible antipattern.
 */
Vector.prototype.compute = function step (state) {
  this.clock += 1;

  var self = this;
  var mem = [];

  function follow (input) {
    for (var i = 0; i < input.length; i++) {
      var instruction = input[i];
      //console.log('instruction:', instruction);

      if (instruction instanceof Array) {
        follow(instruction);
      } else {
        //console.log('step:', instruction);
        
        var transmute = self.known[instruction];
        if (typeof transmute == 'function') {
          //console.log('KNOWN:', typeof transmute, transmute);
          self['@data'] = transmute.call(self, self['@data'], mem);
          mem.push(self['@data']);

          self._sign();
        }
      }
    }
  }

  follow(self.stack);

  // TODO: document that ALL VECTORS MUST SIGN
  self._sign();

  return self;
};

Vector.prototype.render = function log () {
  var self = this;
  var obj = self['@data'];
  
  obj._sign();

  return obj;
};

module.exports = Vector;
