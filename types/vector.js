'use strict';

const Scribe = require('./scribe');
const Stack = require('./stack');

class Vector extends Scribe {
  /**
   * An "Initialization" Vector.
   * @param       {Object} - Input state (will map to `@data`.)
   * @constructor
   */
  constructor (origin) {
    super(origin);

    this.settings = Object.assign({}, origin);

    this.known = {};
    this.registry = {};

    this.stack = new Stack();
    this.script = [];

    this.status = 'initialized';

    return this;
  }

  static fromObjectString (input = '') {
    if (!input) throw new Error('Must provide input.');
    if (typeof input !== 'string') input = JSON.stringify(input);
    let result = [];
    let object = JSON.parse(input);

    for (let i in object) {
      let element = object[i];

      if (element instanceof Array) {
        element = Buffer.from(element);
      } else {
        element = Buffer.from(element.data);
      }

      result.push(element);
    }

    return result;
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

  toObject () {
    let object = {};
    for (let property in this['@data']) {
      if (property.charAt(0) !== '@') {
        object[property] = this['@data'][property];
      }
    }
    return object;
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

  async step () {
    return super.compute((this.clock | 0));
  }
}

module.exports = Vector;
