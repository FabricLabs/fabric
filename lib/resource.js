'use strict';

const Vector = require('./vector');

/**
 * Generic interface for collections of digital objects.
 * @param       {Object} definition Initial parameters
 * @constructor
 */
class Resource extends Vector {
  constructor (init) {
    super(init);

    if (!(this instanceof Resource)) {
      return new Resource(init);
    }

    this['@data'] = init || this.prototype;

    this.clock = 0;
    this.stack = [];
    this.known = {};

    this.routes = init.routes || {
      query: '/'
    };

    this.init();
  }

  async get (id) {
    console.log('[RESOURCE]', 'get', id);
    
    try {
      return this.store.get(this.routes.query + id);
    } catch (E) {
      console.error(E);
    }

    return this;
  }

  async set (id, data) {
    console.log('[RESOURCE]', 'set', id, data);

    try {
      return this.store.set(this.routes.query + id);
    } catch (E) {
      console.error(E);
    }

    return this;
  }

  async list (id) {
    return this.store.get(this.routes.query);
  }

  async describe () {
    this.http.put(resource.routes.set, self.router);
    this.http.get(resource.routes.get, self.router);
    this.http.post(resource.routes.insert, self.router);
    this.http.patch(resource.routes.update, self.router);
    this.http.delete(resource.routes.delete, self.router);
    this.http.options(resource.routes.options, self.router);
  }
}

Resource.prototype.trust = function (store) {
  if (this.store) {
    this.store.close();
  }

  this.store = store;
  
  return this;
}

Resource.prototype.attach = function (app) {
  this.store = app.stash;
}

Resource.prototype.create = async function (obj) {
  let self = this;
  let vector = new Fabric.Vector(obj)._sign();
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

Resource.prototype.update = async function (id, update) {
  let self = this;
  let vector = new Fabric.Vector(update)._sign();
  let current = await self.store.get(id);
  if (!current) current = {};

  console.log('vector:', vector);
  console.log('current:', current);

  try {
    await self.store.set(id, vector['@data']);
  } catch (E) {
    console.error(E);
  }

  return vector;
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
