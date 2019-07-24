'use strict';

const lexer = require('jade-lexer');
const parse = require('jade-parser');

const Service = require('./service');

class Component extends Service {
  constructor (config) {
    this.config = Object.assign({
      'encoding': 'jade',
      'input': 'fabric-component Hello, world!'
    }, config);

    this['@encoding'] = 'html';

    this.tokens = lexer(this.config.input);
    this.ast = parse(this.tokens);

    return this;
  }

  toHTML (ast) {
    return `<broken />`;
  }

  render () {
    let result = null;

    switch (this['@encoding']) {
      default:
        result = this.toHTML(this.ast);
        break;
    }

    return result;
  }
}

module.exports = Component;
