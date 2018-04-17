'use strict';

const Vector = require('./vector');

/**
 * Generic interface for collections of digital objects.
 * @param       {Object} definition Initial parameters
 * @constructor
 */
class Resource extends Vector {
  constructor (definition) {
    super(definition);

    if (!(this instanceof Resource)) {
      return new Resource(definition);
    }

    this['@data'] = definition || this.prototype;
    this.name = definition.name || 'Radical';

    this.routes = Object.assign({
      list: '/',
      view: ':id'
    }, definition.routes);

    this.components = Object.assign({
      list: [this.name.toLowerCase(), 'list'].join('-'),
      view: [this.name.toLowerCase(), 'view'].join('-')
    }, definition.components);

    this.init();

    return this;
  }

  async get (id) {
    console.log('[RESOURCE]', 'get', id);

    try {
      return this.store.get(this.routes.list + id);
    } catch (E) {
      console.error(E);
    }

    return this;
  }

  async set (id, data) {
    console.log('[RESOURCE]', 'set', id, data);

    try {
      return this.store.set(this.routes.list + id);
    } catch (E) {
      console.error(E);
    }

    return this;
  }

  async list (id) {
    return this.store.get(this.routes.list);
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

/**
 * Trust a datastore.
 * @param  {Store} store Instance to trust.
 * @return {Resource}       Bound instance of the Resource.
 */
Resource.prototype.trust = function (store) {
  if (this.store) {
    this.store.close();
  }

  this.store = store;

  return this;
};

Resource.prototype.attach = function (app) {
  this.store = app.stash;
};

Resource.prototype.flush = async function () {
  return this.store.set(this.routes.list, []);
};

/**
 * Create an instance of the Resource's type.
 * @param  {Object} obj Map of the instance's properties and values.
 * @return {Vector}     Resulting Vector with deterministic identifier.
 */
Resource.prototype.create = async function (obj) {
  let self = this;
  let vector = new Vector(obj)._sign();
  let collection = await self.store.get(self.routes.list);
  let path = [self.routes.list, vector.id].join('/');

  if (!collection) collection = [];
  if (typeof collection === 'string') collection = JSON.parse(collection);

  collection.unshift(vector);

  try {
    await self.store.set(vector.id, vector);
    await self.store.set(path, vector);
    await self.store.set(self.routes.list, collection);
  } catch (E) {
    console.error(E);
  }

  return vector;
};

/**
 * Modify an existing instance of a Resource by its unique identifier.  Produces a new instance.
 * @param  {String} id     Unique ID to update.
 * @param  {Object} update Map of change to make (keys -> values).
 * @return {Vector}        Resulting Vector instance with updated identifier.
 */
Resource.prototype.update = async function (id, update) {
  let self = this;
  let vector = new Vector(update)._sign();
  let collection = await self.store.get(self.routes.list);
  let path = [self.routes.list, vector.id].join('/');
  let current = await self.get(path);

  if (!current) current = {};

  let sample = Object.assign({}, current, vector['@data']);
  let result = new Vector(sample)._sign();

  try {
    await self.store.set(result.id, result);
    await self.store.set(path, vector);
    await self.store.set(self.routes.list, collection);
  } catch (E) {
    console.error(E);
  }

  return result;
};

Resource.prototype.query = async function (inquiry) {
  let self = this;
  let collection = await self.store.get(self.routes.list);

  if (typeof collection === 'string') collection = JSON.parse(collection);

  return collection;
};

Resource.prototype.get = async function (id) {
  let self = this;
  let instance = await self.store.get([self.routes.list, id].join('/'));

  if (typeof instance === 'string') instance = JSON.parse(instance);

  return instance;
};

Resource.prototype.delete = async function () {
  
};

Resource.asStruct = function () {
  var obj = this.prototype;
  obj.name = this.name;
  return obj;
}

module.exports = Resource;
