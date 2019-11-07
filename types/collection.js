'use strict';

const pluralize = require('pluralize');
const monitor = require('fast-json-patch');
const pointer = require('json-pointer');

const Entity = require('./entity');

const Stack = require('./stack');
const State = require('./state');

/**
 * The {@link Collection} type maintains an ordered list of {@link State} items.
 * @property {Object} @entity Fabric-bound entity object.
 */
class Collection extends Stack {
  /**
   * Create a list of {@link Entity}-like objects for later retrieval.
   * @param  {Object}  [configuration={}] Configuration object.
   * @return {Collection}                 Configured instance of the the {@link Collection}.
   */
  constructor (configuration = {}) {
    super(configuration);

    // TODO: document `listeners` handler (currently only `create`)
    this.settings = Object.assign({
      atomic: true,
      // TODO: document determinism
      deterministic: true,
      name: 'Collection',
      type: Entity,
      path: `./stores/collection`,
      fields: {
        id: 'id'
      },
      key: 'id'
    }, configuration);

    this['@entity']['@type'] = 'Collection';

    this.name = pluralize(configuration.name || this.settings.name);
    this.path = `/` + this.name.toLowerCase();
    this.state = {};

    this.set(`${this.path}`, this.settings.data || {});

    return this;
  }

  asMerkleTree () {
    let list = pointer.get(this.state, this.path);
    let stack = new Stack(Object.keys(list));
    return stack.asMerkleTree();
  }

  _setKey (name) {
    this.settings.key = name;
  }

  /**
   * Retrieve an element from the collection by ID.
   * @param {String} id Document identifier.
   */
  getByID (id) {
    if (!id) return null;

    let result = null;

    try {
      result = pointer.get(this.state, `${this.path}/${id}`);
    } catch (E) {
     // console.debug('[FABRIC:COLLECTION]', `@${this.name}`, Date.now(), `Could not find ID "${id}" in tree ${this.asMerkleTree()}`);
    }

    result = this._wrapResult(result);

    return result;
  }

  /**
   * Retrieve the most recent element in the collection.
   */
  getLatest () {
    let items = pointer.get(this.state, this.path);
    return items[items.length - 1];
  }

  findByField (name, value) {
    let result = null;
    let items = pointer.get(this.state, this.path);
    // constant-time loop
    for (let id in items) {
      if (items[id][name] === value) {
        // use only first result
        result = (result) ? result : items[id];
      }
    }
    return result;
  }

  findByName (name) {
    let result = null;
    let items = pointer.get(this.state, this.path);
    // constant-time loop
    for (let id in items) {
      if (items[id].name === name) {
        // use only first result
        result = (result) ? result : items[id];
      }
    }
    return result;
  }

  findBySymbol (symbol) {
    let result = null;
    let items = pointer.get(this.state, this.path);
    // constant-time loop
    for (let id in items) {
      // TODO: fix bug here (check for symbol)
      if (items[id].symbol === symbol) {
        // use only first result
        result = (result) ? result : items[id];
      }
    }
    return result;
  }

  // TODO: deep search, consider GraphQL (!!!: to discuss)
  match (query = {}) {
    let result = null;
    let items = pointer.get(this.state, this.path);
    let list = Object.keys(items).map((x) => {
      return items[x];
    });

    try {
      result = list.filter((x) => {
        for (let field in query) {
          if (x[field] !== query[field]) return false;
        }
        return true;
      });
    } catch (E) {
      console.error('Could not match:', E);
    }

    return result;
  }

  _wrapResult (result) {
    if (this.settings.type.name !== 'Entity') {
      let Type = this.settings.type;
      result = new Type(result || {});
    }
    return result;
  }

  _patchTarget (path, patches) {
    let link = `${path}`;
    let result = null;

    try {
      result = monitor.applyPatch(this.state, patches.map((op) => {
        op.path = `${link}${op.path}`;
        return op;
      })).newDocument;
    } catch (E) {
      console.log('Could not patch target:', E, path, patches);
    }

    this.commit();

    return result;
  }

  /**
   * Adds an {@link Entity} to the {@link Collection}.
   * @param  {Mixed} data {@link Entity} to add.
   * @return {Number}      Length of the collection.
   */
  push (data, commit = true) {
    super.push(data);

    let state = new State(data);

    this['@entity'].states[this.id] = this['@data'];
    this['@entity'].states[state.id] = state['@data'];

    this['@entity']['@data'] = this['@data'].map(x => x.toString());
    this['@data'] = this['@entity']['@data'];

    this['@id'] = this.id;

    if (commit) {
      try {
        this['@commit'] = this.commit();
      } catch (E) {
        console.error('Could not commit.', E);
      }
    }

    return this['@data'].length;
  }

  async populate () {
    return Promise.all(this['@entity']['@data'].map(id => {
      return this['@entity'].states[id.toString('hex')];
    }));
  }

  async query (path) {
    return this.get(path);
  }

  list () {
    return Collection.pointer.get(this.state, `${this.path}`);
  }

  /**
   * Create an instance of an {@link Entity}.
   * @param  {Object}  entity Object with properties.
   * @return {Promise}        Resolves with instantiated {@link Entity}.
   */
  async create (input, commit = true) {
    let result = null;
    let size = this.push(input, false);
    let state = this['@entity'].states[this['@data'][size - 1]];

    if (!this.settings.deterministic) state.created = Date.now();

    let entity = new Entity(state);
    // TODO: enable specifying names (again)
    // let link = `${this.path}/${(entity.data[this.settings.fields.id] || entity.id)}`;
    let link = `${this.path}/${entity.id}`;
    // console.log('[AUDIT]', '[COLLECTION]', 'created:', link);

    if (this.settings.methods && this.settings.methods.create) {
      state = await this.settings.methods.create.call(this, state);
      // console.log('[AUDIT]', `[COLLECTION:CREATED:${this.settings.name.toUpperCase()}]`, 'created data:', state);
    }

    this.set(link, state.data || state);

    this.emit('message', {
      '@type': 'Create',
      '@data': Object.assign({}, state.data, {
        id: entity.id
      })
    });

    if (this.settings.listeners && this.settings.listeners.create) {
      await this.settings.listeners.create.call(this, entity.data);
    }

    if (commit) {
      try {
        this['@commit'] = this.commit();
      } catch (E) {
        console.error('Could not commit.', E);
      }
    }

    result = state.data || entity.data;
    result.id = entity.id;

    return result;
  }

  async import (input, commit = true) {
    let result = null;
    let size = this.push(input, false);
    let state = this['@entity'].states[this['@data'][size - 1]];
    let entity = new Entity(state);
    let link = `${this.path}/${entity.id}`;

    this.set(link, state.data || state);

    if (commit) {
      try {
        this['@commit'] = this.commit();
      } catch (E) {
        console.error('Could not commit.', E);
      }
    }

    result = state.data || entity.data;
    result.id = entity.id;

    this.emit('message', {
      '@type': 'Snapshot',
      '@data': {
        path: this.path,
        state: pointer.get(this.state, this.path)
      }
    });

    return result;
  }

  async importList (list) {
    let ids = [];

    for (let i = 0; i < list.length; i++) {
      let item = await this.import(list[i]);
      ids.push(item.id);
    }

    return ids;
  }

  async importMap (map) {
    return this.importList(Object.values(map));
  }
}

module.exports = Collection;
