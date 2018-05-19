'use strict';

const util = require('util');
const Schemae = require('ajv');

function Validator (input) {
  this.schemae = new Schemae({ allErrors: true });
  this.functor = this.schemae.compile(input);
}

util.inherits(Validator, require('events').EventEmitter);

Validator.prototype.validate = function (object) {
  return this.functor(object);
};

module.exports = Validator;
