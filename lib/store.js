var Vector = require('./vector');

var util = require('util');
var level = require('level');

function Store (vector) {
  this['@data'] = vector || {
    path: './data/store',
    get: this.get,
    set: this.set,
    del: this.del,
    transform: this.transform,
    createReadStream: this.createReadStream,
  };

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.db = level(this['@data']['path']);
  
  this.init();
}

// could be looked up by name of parameter in #4
util.inherits(Store, Vector);

Store.prototype.get = async function GET (key) {
  var self = this;
  var value = await self.db.get(key);
  if (!value) return null;
  return JSON.parse(value);
};

Store.prototype.set = async function PUT (key, value) {
  var self = this;
  if (typeof value !== 'string') {
    value = self._serialize(value);
  }
  return await self.db.put(key, value);
};

Store.prototype.del = function DEL (key, done) {
  this.db.del(key, done);
};

Store.prototype.transform = function TRANSFORM (transaction, done) {
  this.db.del(batch, done);
};

Store.prototype.createReadStream = function createReadStream () {
  this.db.del(key, done);
};

Store.prototype.close = async function close () {
  return await this.db.close();
};

module.exports = Store;
