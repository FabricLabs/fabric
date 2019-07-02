'use strict';

const Vector = require('./vector');

class Document extends Vector {
  constructor (doc) {
    super(doc);

    // only valid if this matches
    this.contract = {
      integrity: `sha256-${this.hash}`
    };

    return this;
  }

  /**
   * Compiles an `input` {@link Vector}.
   * ENV provides the name of a parent type (e.g., "scaffold" or "0xDEADBEEF...")
   * UI provides the name of the desired component
   * @param  {Vector}  input [env, ui]
   * @return {Promise}       Promise which resolves on compilation.
   */
  async compile (input) {
    let vector = new Vector(input)._sign();
    let contract = [
      `extends ${input[0]}`,
      `block body`,
      `  ${input[1]}(state="${vector.id}") {{state}}`
    ].join('\n');

    this.contract = contract;
    this['@id'] = vector.id;
    await this.commit();

    return contract;
  }

  toString () {
    return `<Document id="${this.id}" />`;
  }
}

module.exports = Document;
