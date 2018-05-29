'use strict';
// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
const util = require('util');
const localforage = require('localforage');

function Stash (vector) {
  this.config = Object.assign({
    path: './data/store',
    get: this.get,
    set: this.set,
    del: this.del,
    transform: this.transform,
    createReadStream: this.createReadStream
  }, vector || {});

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.open();

  this.init();
}

util.inherits(Stash, require('./vector'));

Stash.prototype.open = function load () {
  this.db = localforage.createInstance({
    name: 'fabric'
  });
};

Stash.prototype.get = async function GET (key) {
  var self = this;
  var value = await self.db.getItem(key);
  if (!value) return null;
  //if (typeof value !== 'string') return JSON.parse(value);
  return value;
};

Stash.prototype.set = async function PUT (key, value) {
  var self = this;
  if (typeof value !== 'string') {
    value = self._serialize(value);
  }

  await self.db.setItem(key, value);

  return await self.db.getItem(key);
};

Stash.prototype.del = async function DEL (key) {
  return await this.db.setItem(key, null);
};

Stash.prototype.transform = function TRANSFORM (transaction, done) {
  //this.db.del(batch, done);
  return new Error('not yet implemented');
};

Stash.prototype.createReadStream = function createReadStream () {
  return this.db.createReadStream();
};

Stash.prototype.close = async function close () {
  return await this.db.close();
};

module.exports = Stash;
