'use strict';

const util = require('util');
const _ = require('./functions');

function Storage (vector) {
  let template = {
    path: './data/storage',
    get: this.get,
    set: this.set,
    del: this.del,
    transform: this.transform,
    createReadStream: this.createReadStream,
  };

  this['@data'] = _.merge({}, template, vector || {});

  this.clock = 0;
  this.stack = [];
  this.known = {};
  
  this.open();

  this.init();
}

if (process.env.APP_ENV !== 'browser') {
  util.inherits(Storage, require('./store'));
} else {
  util.inherits(Storage, require('./stash'));
}

module.exports = Storage;
