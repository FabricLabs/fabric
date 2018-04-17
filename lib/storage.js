'use strict';

const util = require('util');

/**
 * Persistent data storage.
 * @param       {Object} config Configuration for internal datastore.
 * @constructor
 */
function Storage (vector) {
  this.config = Object.assign({
    path: './data/storage',
    get: this.get,
    set: this.set,
    del: this.del,
    transform: this.transform,
    createReadStream: this.createReadStream
  }, vector || {});

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.init();
}

if (process.env.APP_ENV !== 'browser') {
  util.inherits(Storage, require('./store'));
} else {
  util.inherits(Storage, require('./stash'));
}

module.exports = Storage;
