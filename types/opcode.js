'use strict';

const Vector = require('./vector');

class Opcode {
  constructor (definition) {
    let opcode = this;

    opcode.config = Object.assign({}, definition);
    opcode.vector = new Vector(definition)._sign();

    return function Opcode (input) {
      opcode.output = definition.call({
        id: opcode.vector['@id']
      }, input);

      return opcode.output;
    };
  }
}

module.exports = Opcode;
