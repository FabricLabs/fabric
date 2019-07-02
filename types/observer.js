'use strict';

const monitor = require('fast-json-patch');

class Observer {
  constructor (target) {
    this.observer = monitor.observe(target);
    return this;
  }
}

module.exports = Observer;
