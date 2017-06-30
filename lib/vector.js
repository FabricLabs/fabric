var util = require('util');
var _ = require('lodash');

/**
 * [Vector An "Initialization" Vector.]
 * @param       {[object]} state [Data to map to `@data`.]
 * @constructor
 */
function Vector (state) {
  this['@data'] = state;
  this.id = this.clock = 0;
  this.stack = [];
}

util.inherits(Vector, require('events').EventEmitter);

/**
 * [_serialize is a placeholder, should be discussed.]
 * @return {[string]} [JSON-encoded version of the local `@data` value.]
 */
Vector.prototype._serialize = function toString () {
  // TODO: standardize on a serialization format
  return JSON.stringify(this['@data']);
}

/**
 * [compute Computes the next "step" for our current Vector.]
 * @param  {Function} next [Chaincode to run when this step is complete.]
 * @param  {Function} done [Chaincode to be called to exit.]
 * @return {[Vector]}      [Makes this Vector chainable.  Possible antipattern.]
 */
Vector.prototype.compute = function step (next, done) {
  ++this.clock;

  //this.now = new Date();

  // begin
  if (!next) next = new Function();
  if (!done) done = new Function();

  // define identity function as the current vector
  if (typeof next !== 'function') {
    next = function identity (input) {
      return input;
    }
  }

  var self = this;
  var pipeline = [ next , done ];

  // simply put...
  _.merge(self, self['@data']);
  // TODO: type lookup :)
  
  // TODO: emit event on every change
  // (use observers)
  self.emit('step', self['@data']);
  
  pipeline.forEach(function(method) {
    method.apply(self['@data']);
  });
  
  // all done!
  return self['@data'];
}

module.exports = Vector;
