'use strict';

const Vector = require('./vector');
const jade = require('jade');
const ssri = require('ssri');

class Document extends Vector {
  constructor (doc) {
    super(doc);

    console.log('[DOCUMENT]', 'raw:', typeof doc, doc);

    this.contract = {
      integrity: ssri.fromData(JSON.stringify(doc))
    };

    this['@data'] = doc;
    this._sign();

    return this;
  }

  /**
   * Compiles an input vector in the format [env, ui].
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
      `  ${input[1]}(state="${vector.id}")`
    ].join('\n');

    // this['@data'] = contract;
    this['@id'] = vector.id;

    return contract;
  }

  /**
   * Computes an output from a UI definition (template).
   * @param  {String}  template UI definition, written in Purity (f(x, v) => x(v))
   * @return {Promise}          Promise which resolves to a compiled output string.
   */
  async render (template) {
    console.log('[DOCUMENT]', 'render:', template);
    console.log('input data:', this['@data']);

    let contract = jade.compile(template, {
      pretty: true,
      filename: 'components/' + this.name
    });

    let output = contract({
      data: this['@data']
    }).replace(/^\s+|\s+$/g, '');

    return output;
  }

  renderFile (name) {
    if (name) {
      let path = './components/' + name.split('-').slice(1).join('-') + '.jade';
      console.log('original:', name);
      console.log('rendering:', path);
      // TODO: use precompiled functions
      return jade.renderFile(path, {
        data: JSON.stringify(this['@data'], null, '  ')
      });
    } else {
      return this['@data'];
    }
  }
}

module.exports = Document;
