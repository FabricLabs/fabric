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
      name: 'Collection',
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

  _setKey (name) {
    this.settings.key = name;
  }

  async getByID (id) {
    return pointer.get(this.state, `${this.path}/${id}`);
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

  /**
   * Create an instance of an {@link Entity}.
   * @param  {Object}  entity Object with properties.
   * @return {Promise}        Resolves with instantiated {@link Entity}.
   */
  async create (input, commit = true) {
    let result = null;
    let size = this.push(input, false);
    let state = this['@entity'].states[this['@data'][size - 1]];

    let entity = new Entity(state);
    let link = `${this.path}/${(entity.data[this.settings.fields.id] || entity.id)}`;
    // console.log('[AUDIT]', '[COLLECTION]', 'created:', link);

    if (this.settings.methods && this.settings.methods.create) {
      state = await this.settings.methods.create.call(this, state);
      // console.log('[AUDIT]', `[COLLECTION:CREATED:${this.settings.name.toUpperCase()}]`, 'created data:', state);
    }

    this.set(link, state.data || state);

    this.emit('message', {
      '@type': 'Create',
      '@data': state.data
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

    return result;
  }

  list () {
    return Collection.pointer.get(this.state, `${this.path}`);
  }
}

module.exports = Collection;
