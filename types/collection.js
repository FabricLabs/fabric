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
      type: Entity,
      deterministic: true,
      name: '@fabric/store',
      path: './collections',
      fields: { id: 'id' },
      key: 'id'
    }, configuration);

    this['@type'] = 'Collection';
    this['@entity']['@type'] = 'Collection';

    // Set name to plural version, define path for storage
    this.name = pluralize(this.settings.name);
    this.path = '/' + this.name.toLowerCase();

    this._state = {};
    this.value = {};

    this.set(`${this.path}`, this.settings.data || {});
    this.observer = monitor.observe(this.value);

    Object.defineProperty(this, '@allocation', { enumerable: false });
    Object.defineProperty(this, '@buffer', { enumerable: false });
    Object.defineProperty(this, '@encoding', { enumerable: false });
    Object.defineProperty(this, '@parent', { enumerable: false });
    Object.defineProperty(this, '@preimage', { enumerable: false });
    Object.defineProperty(this, 'frame', { enumerable: false });
    Object.defineProperty(this, 'services', { enumerable: false });

    return this;
  }

  get routes () {
    return this.settings.routes;
  }

  /**
   * Current elements of the collection as a {@link MerkleTree}.
   * @returns {MerkleTree}
   */
  asMerkleTree () {
    const list = pointer.get(this.value, this.path);
    const stack = new Stack(Object.keys(list));
    return stack.asMerkleTree();
  }

  /**
   * Sets the `key` property of collection settings.
   * @param {String} name Value to set the `key` setting to.
   */
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
      if (this.settings.verbosity >= 5) console.log(`getting ${this.path}/${id} from:`, this.value);
      result = pointer.get(this.value, `${this.path}/${id}`);
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
    const items = pointer.get(this.value, this.path);
    return items[items.length - 1];
  }

  /**
   * Find a document by specific field.
   * @param {String} name Name of field to search.
   * @param {String} value Value to match.
   */
  findByField (name, value) {
    let result = null;
    const items = pointer.get(this.value, this.path);
    // constant-time loop
    for (const id in items) {
      if (items[id][name] === value) {
        // use only first result
        result = (result) || items[id];
      }
    }
    return result;
  }

  /**
   * Find a document by the "name" field.
   * @param {String} name Name to search for.
   */
  findByName (name) {
    let result = null;
    const items = pointer.get(this.value, this.path);
    // constant-time loop
    for (const id in items) {
      if (items[id].name === name) {
        // use only first result
        result = (result) || items[id];
      }
    }
    return result;
  }

  /**
   * Find a document by the "symbol" field.
   * @param {String} symbol Value to search for.
   */
  findBySymbol (symbol) {
    let result = null;
    const items = pointer.get(this.value, this.path);
    // constant-time loop
    for (const id in items) {
      // TODO: fix bug here (check for symbol)
      if (items[id].symbol === symbol) {
        // use only first result
        result = (result) || items[id];
      }
    }
    return result;
  }

  // TODO: deep search, consider GraphQL (!!!: to discuss)
  match (query = {}) {
    let result = null;
    const items = pointer.get(this.value, this.path);
    const list = Object.keys(items).map((x) => {
      return items[x];
    });

    try {
      result = list.filter((x) => {
        for (const field in query) {
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
    // TODO: enable upstream specification via pure JSON
    if (this.settings.type.name !== 'Entity') {
      const Type = this.settings.type;
      result = new Type(result || {});
    }

    // TODO: validation of result by calling result.validate()
    // TODO: signing of result by calling result.signWith()
    return result;
  }

  /**
   * Modify a target document using an array of atomic updates.
   * @param {String} path Path to the document to modify.
   * @param {Array} patches List of operations to apply.
   */
  async _patchTarget (path, patches) {
    const link = `${path}`;
    let result = null;

    if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'Patching target:', path, patches);

    try {
      result = monitor.applyPatch(this.value, patches.map((op) => {
        op.path = `${link}${op.path}`;
        return op;
      })).newDocument;
    } catch (E) {
      console.error('Could not patch target:', E, path, patches);
    }

    await this.commit();

    return result;
  }

  /**
   * Adds an {@link Entity} to the {@link Collection}.
   * @param  {Mixed} data {@link Entity} to add.
   * @return {Number}      Length of the collection.
   */
  async push (data, commit = true) {
    super.push(data);

    const state = new State(data);

    this['@entity'].states[this.id] = this['@data'];
    this['@entity'].states[state.id] = state['@data'];

    this['@entity']['@data'] = this['@data'].map(x => x.toString());
    this['@data'] = this['@entity']['@data'];

    this['@id'] = this.id;

    if (commit) {
      try {
        this['@commit'] = await this.commit();
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

  /**
   * Retrieve a key from the {@link State}.
   * @param {Path} path Key to retrieve.
   * @returns {Mixed}
   */
  get (path) {
    let result = null;

    try {
      result = pointer.get(this['@entity']['@data'], path);
    } catch (exception) {
      this.emit('warning', `[FABRIC:COLLECTION] Could not retrieve path: ${path} ${JSON.stringify(exception)}`);
      // console.error('[FABRIC:COLLECTION]', 'Could not retrieve path:', path, exception);
    }

    return result;
  }

  /**
   * Set a key in the {@link State} to a particular value.
   * @param {Path} path Key to retrieve.
   * @returns {Mixed}
   */
  set (path, value) {
    pointer.set(this._state, path, value);
    pointer.set(this.value, path, value);
    pointer.set(this['@entity']['@data'], path, value);

    this.commit();
    return true;
  }

  /**
   * Generate a list of elements in the collection.
   * @deprecated
   * @returns {Array}
   */
  list () {
    const map = this.map();
    const ids = Object.keys(map);
    // TODO: `list()` should return an Array
    const result = {};

    for (let i = 0; i < ids.length; i++) {
      result[ids[i]] = this._wrapResult(map[ids[i]]);
    }

    return result;
  }

  /**
   * Provides the {@link Collection} as an {@link Array} of typed
   * elements.  The type of these elments are defined by the collection's
   * type, supplied in the constructor.
   */
  toTypedArray () {
    const map = this.map();
    const ids = Object.keys(map);
    return ids.map((x) => this._wrapResult(map[ids[x]]));
  }

  typedMap () {
    const map = this.map();
    const ids = Object.keys(map);
    // TODO: `list()` should return an Array
    const result = {};

    for (let i = 0; i < ids.length; i++) {
      result[ids[i]] = this._wrapResult(map[ids[i]]);
    }

    return result;
  }

  /**
   * Generate a hashtable of elements in the collection.
   * @returns {Array}
   */
  map () {
    return Collection.pointer.get(this.value, `${this.path}`);
  }

  /**
   * Create an instance of an {@link Entity}.
   * @param  {Object}  entity Object with properties.
   * @return {Promise}        Resolves with instantiated {@link Entity}.
   */
  async create (input, commit = true) {
    if (this.settings.verbosity >= 5) console.log('[FABRIC:COLLECTION]', 'Creating object:', input);
    if (!this.settings.deterministic) input.created = Date.now();

    let result = null;
    const entity = new Entity(input);
    const link = `${this.path}/${entity.id}`;
    // TODO: enable specifying names (again)
    // let link = `${this.path}/${(entity.data[this.settings.fields.id] || entity.id)}`;
    // TODO: handle duplicates (when desired, i.e., "unique" in settings)
    const current = await this.getByID(entity.id);
    if (current) {
      if (this.settings.verbosity >= 5) console.log('[FABRIC:COLLECTION]', 'Exact entity exists:', current);
    }

    if (this.settings.methods && this.settings.methods.create) {
      result = await this.settings.methods.create.call(this, input);
    } else {
      result = entity;
    }

    pointer.set(this._state, link, result.data);

    this.set(link, result.data || result);

    this.emit('message', {
      '@type': 'Create',
      '@data': Object.assign({}, result.data, {
        id: entity.id
      })
    });

    if (commit) {
      try {
        this['@commit'] = await this.commit();
        this.emit('commit', this['@commit']);
      } catch (E) {
        console.error('Could not commit.', E);
      }
    }

    if (this.settings.listeners && this.settings.listeners.create) {
      await this.settings.listeners.create(entity.data);
    }

    result = result.data || entity.data;
    result.id = entity.id;

    return result;
  }

  /**
   * Loads {@link State} into memory.
   * @param {State} state State to import.
   * @param {Boolean} commit Whether or not to commit the result.
   * @emits message Will emit one {@link Snapshot} message.
   */
  async import (input, commit = true) {
    if (input['@data']) input = input['@data'];

    let result = null;
    const size = await this.push(input, false);
    const state = this['@entity'].states[this['@data'][size - 1]];
    const entity = new Entity(state);
    const link = `${this.path}/${input.id || entity.id}`;

    if (this.settings.verbosity >= 4) console.log('state.data:', state.data);
    if (this.settings.verbosity >= 4) console.log('state:', state);
    if (this.settings.verbosity >= 4) console.log('link:', link);

    this.set(link, state.data || state);

    if (commit) {
      try {
        this['@commit'] = await this.commit();
      } catch (E) {
        console.error('Could not commit.', E);
      }
    }

    result = state.data || entity.data;
    result.id = input.id || entity.id;

    // TODO: ensure updates sent on subscriber channels
    // ESPECIALLY when an ID is supplied...
    // TODO: test upstream attack vectors
    if (this.settings.verbosity >= 4) console.log('input.id', input.id);

    this.emit('message', {
      '@type': 'Snapshot',
      '@data': {
        path: this.path,
        state: pointer.get(this.value, this.path)
      }
    });

    return result;
  }

  async importList (list) {
    const ids = [];

    for (let i = 0; i < list.length; i++) {
      const item = await this.import(list[i]);
      ids.push(item.id);
    }

    return ids;
  }

  async importMap (map) {
    return this.importList(Object.values(map));
  }

  commit () {
    if (this.settings.verbosity >= 4) this.emit('debug', '[FABRIC:COLLECTION] Committing...');
    const patches = monitor.generate(this.observer);

    if (patches && patches.length) {
      const body = {
        changes: patches,
        state: this.value
      };

      this.emit('transaction', body);
      this.emit('patches', patches);
      this.emit('message', {
        '@type': 'Transaction',
        '@data': body
      });
    }
  }

  get len () {
    return Object.keys(this.list()).length;
  }
}

module.exports = Collection;
