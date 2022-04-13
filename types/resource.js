'use strict';

const crypto = require('crypto');
const pluralize = require('pluralize');

const State = require('./state');
const Store = require('./store');

/**
 * Generic interface for collections of digital objects.
 * @param       {Object} definition Initial parameters
 * @constructor
 */
class Resource extends Store {
  constructor (definition = {}) {
    super(definition);

    if (!(this instanceof Resource)) {
      return new Resource(definition);
    }

    this['@data'] = definition;
    this.name = definition.name || 'Radical';
    this.names = [ this.name, pluralize(this.name) ];
    this.definition = definition;

    this.routes = Object.assign({
      list: `/${this.names[1].toLowerCase()}`, // TODO: unpin, offer larger name list
      view: `/${this.names[1].toLowerCase()}/:id`
    }, definition.routes);

    this.components = Object.assign({
      list: [this.name.toLowerCase(), 'list'].join('-'),
      view: [this.name.toLowerCase(), 'view'].join('-')
    }, definition.components);

    return this;
  }

  static asStruct () {
    var obj = this.prototype;
    obj.name = this.name;
    return obj;
  }

  get hash () {
    return crypto.createHash('sha256').update(this.render()).digest('hex');
  }

  attach (app) {
    this.store = app.stash;
  }

  async list () {
    return this.store.get(this.routes.list);
  }

  async describe () {
    this.http.put(this.routes.set, this.router);
    this.http.get(this.routes.get, this.router);
    this.http.post(this.routes.insert, this.router);
    this.http.patch(this.routes.update, this.router);
    this.http.delete(this.routes.delete, this.router);
    this.http.options(this.routes.options, this.router);
  }

  /**
   * Create an instance of the Resource's type.
   * @param  {Object} obj Map of the instance's properties and values.
   * @return {Vector}     Resulting Vector with deterministic identifier.
   */
  async create (obj) {
    let self = this;
    let vector = new State(obj);
    let collection = await self.store._POST(self.routes.list, vector['@data']);
    return vector;
  }

  /**
   * Modify an existing instance of a Resource by its unique identifier.  Produces a new instance.
   * @param  {String} id     Unique ID to update.
   * @param  {Object} update Map of change to make (keys -> values).
   * @return {Vector}        Resulting Vector instance with updated identifier.
   */
  async update (id, update) {
    let self = this;
    let path = `${self.routes.list}/${id}`;
    let vector = new State(update);
    let patches = self.store._PATCH(path, update);
    let result = self.store._GET(path);
    return result;
  }

  async query (inquiry) {
    let self = this;
    let collection = await self.store._GET(self.routes.list);
    return collection;
  }

  render () {
    return `<fabric-resource name="${this.name}"><code>${JSON.stringify(this.definition)}</code></fabric-resource>`;
  }
}

module.exports = Resource;
