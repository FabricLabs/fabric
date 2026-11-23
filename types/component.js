'use strict';

const Service = require('./service');

/**
 * Dead stub. Page composition lives in `@fabric/http` (`types/component.js`,
 * `functions/compose.js`). This module stays out of the published package.
 */
class Component extends Service {
  constructor (config) {
    this.config = Object.assign({
      encoding: 'html',
      input: ''
    }, config);

    this['@encoding'] = 'html';
    this.tokens = null;
    this.ast = null;

    return this;
  }

  toHTML (_ast) {
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
