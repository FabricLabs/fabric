'use strict';

const util = require('util');
const Vector = require('./vector');

/**
 * Generic interface for collections of digital objects.
 * @param       {Object} definition Initial parameters
 * @constructor
 */
function Resource (init) {
  if (!(this instanceof Resource)) return new Resource(init);

  this['@data'] = init || this.prototype;

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.routes = init.routes || {
    query: '/'
  };

  this.handlers = {
    create: function (req, res, next) {
      let vector = new Vector(req.body);

      vector._sign();

      return res.format({
        link: this.routes.query + (vector.id || vector['@id'])
      });
    }
  }

  this.init();
}

util.inherits(Resource, Vector);

Resource.prototype.attach = function (app) {
  this.store = app.stash;
}

Resource.prototype.create = async function (obj) {
  let self = this;
  let vector = new Vector(obj);
  
  vector._sign();
  
  let current = await self.store.get(self.routes.query);
  if (!current) current = [];
  
  if (typeof current === 'string') current = JSON.parse(current);

  console.log('vector:', vector);
  console.log('current:', current);
  
  current.unshift(vector);
  
  try {
    await self.store.set(self.routes.query, current);
  } catch (E) {
    console.error(E);
  }
  
  return vector;
}

Resource.prototype.update = function () {
  
}

Resource.prototype.query = async function (inquiry) {
  let self = this;
  let current = await self.store.get(self.routes.query);

  if (typeof current === 'string') current = JSON.parse(current);

  return current;
}

Resource.prototype.get = function () {
  
}

Resource.prototype.delete = function () {
  
}

Resource.asStruct = function () {
  var obj = this.prototype;
  obj.name = this.name;
  return obj;
}

module.exports = Resource;
