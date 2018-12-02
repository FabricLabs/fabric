'use strict';

// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
const fs = require('fs');
const level = require('level');
const mkdirp = require('mkdirp');
const pointer = require('json-pointer');

// internal components
const Scribe = require('./scribe');
const Stack = require('./stack');
const State = require('./state');

/**
 * Long-term storage.
 * @property {Mixed} config Current configuration.
 */
class Store extends Scribe {
  constructor (config) {
    super(config);

    this.config = Object.assign({
      path: './data/store'
    }, config);

    this.state['@data'].blobs = {};
    this.state['@data'].collections = {};
    this.state['@data'].states = {};
    this.state['@data'].tips = {};

    Object.assign(this['@data'], this.state['@data']);

    return this;
  }

  /**
   * Registers an {@link Actor}.  Necessary to store in a collection.
   * @param  {Object} obj Instance of the object to store.
   * @return {Vector}     Returned from `storage.set`
   */
  async _REGISTER (obj) {
    let result = null;
    let vector = new State(obj);

    try {
      await this._SET(`/types/${vector.id}`, vector['@type']);
    } catch (E) {
      console.error('Error creating object:', E, obj);
    }

    try {
      result = await this._SET(`/states/${vector.id}`, obj);
      this.emit('actor', await this._GET(`/states/${vector.id}`));
    } catch (E) {
      console.error('Error creating object:', E, obj);
    }

    await this.commit();

    return result;
  }

  async _GET (key) {
    let result = null;

    try {
      result = await this.get(key);
    } catch (E) {
      this.error('[STORE]', '[_GET]', '[FAILURE]', E);
    }

    return result;
  }

  async _SET (key, value) {
    return this.set(key, value);
  }

  async _PUT (key, value) {
    return this.set(key, value);
  }

  async _DELETE (key) {
    await this._PUT(key, null);
    return null;
  }

  async _PATCH (key, patch) {
    let root = {};
    let current = await this._GET(key);
    let result = Object.assign(root, current, patch);
    return result;
  }

  /**
   * Insert something into a collection.
   * @param  {String}  key   Path to add data to.
   * @param  {Mixed}  value Object to store.
   * @return {Promise}       Resolves on success with a String pointer.
   */
  async _POST (key, value) {
    let id = pointer.escape(key);
    let path = `/collections/${id}`;
    let list = await this._GET(`${path}`);
    if (!list) list = [];
    let vector = new State(value);
    let origin = new Stack(list);
    let actor = await this._REGISTER(value);
    let count = list.push(vector.id);
    let stack = origin.push(value);
    let result = await origin.commit();
    let update = await this._SET(`${path}`, list);
    let mapper = await this._SET(`${key}`, list);
    let commit = await this.commit();
    this.emit(`commits/${id}`, commit);
    this.emit(`channels/${id}`, vector);
    this.emit(`collections/${id}`, origin);
    this.emit('patch', commit)
    return vector.link;
  }

  async _PUSH (key, data) {
    let id = pointer.escape(key);
    let path = `/stacks/${id}`;
    let list = await this._GET(path);
    if (!list) list = [];
    let vector = new State(data);
    let stack = new Stack(list);
    let result = stack.push(vector.id);
    let actor = await this._REGISTER(data);
    let blob = await this._PUT(`/blobs/${vector.id}`, vector['@data']);
    let saved = await this._SET(path, stack['@data']);
    let commit = await this.commit();
    let output = await this._GET(`/blobs/${vector.id}`);
    return output;
  }

  /**
   * Barebones getter.
   * @param  {String}  key Name of data to retrieve.
   * @return {Promise}     Resolves on complete.  `null` if not found.
   */
  async get (key) {
    let self = this;
    let type = null;
    let item = null;
    let hash = null;
    let data = null;
    let path = pointer.escape(key);
    let instance = null;

    if (!self.db) {
      await this.open();
    }

    if (this.states) {
      console.log('[CACHE]', 'states', this.states);
    }

    try {
      hash = await self.db.get(`/tips/${path}`);
    } catch (E) {
      this.warn(`Could not retrieve tip ${path}:`, E);
    }

    try {
      item = await self.db.get(`/blobs/${hash}`);
      return JSON.parse(item);
    } catch (E) {
      this.warn(`Could not retrieve item [${hash}]:`, E);
    }

    try {
      type = await self.db.get(`/types/${hash}`);
    } catch (E) {
      this.warn(`Could not retrieve type [${hash}]:`, E);
    }

    if (item) {
      switch (type) {
        default:
          console.error('Unhandled type:', type, hash, item);
          break;
        case 'Buffer':
          item = Buffer.from(item);
          break;
        case 'Object':
          item = item['@data'];
          break;
        case 'String':
          item = item['@data'];
          break;
      }
    }

    return item;
  }

  /**
   * Set a `key` to a specific `value`.
   * @param       {String} key   Address of the information.
   * @param       {Mixed} value Content to store at `key`.
   */
  async set (key, value) {
    // Let's use the document's key as the identifying value.
    // This is what defines our key => value store.
    // All functions can be run as a map of an original input vector, allowing
    // binary scoping across trees of varying complexity.
    let id = pointer.escape(key);
    let type = value['@type'] || value.constructor.name;

    // Construct a State object for this value
    let state = new State(value);
    let content = state.render();

    // Since we're using JavaScript, we can use Object literals.
    // See also: https://chat.fabric.pub/#/room/#purity:fabric.pub
    // TODO: remove invalid URLs in upstream
    let pure = {
      '@id': state.id,
      '@data': value,
      '@type': type,
      '@state': state
    };

    // We provide a minimal encoding format which allows for simple typing.
    let raw = state.serialize(value);
    let blob = `/blobs/${state.id}`;
    let address = `/states/${state.id}`;
    let result = null;

    this['@pure'] = pure;
    this['@encoding'] = 'json';

    if (!this.db) {
      await this.open();
    }

    // first store the type
    try {
      await this.db.put(`/types/${pure.id}`, pure['@type']);
      // TODO: migrate to Chain
      pointer.set(this['@data'], `/types/${state.id}`, pure['@type']);
    } catch (E) {
      console.error(E);
    }

    // ensure the document is stored on disk
    try {
      await this.db.put(blob, raw);
    } catch (E) {
      console.error(E);
    }

    try {
      await this.db.put(address, pure['@input']);
      // TODO: migrate to events
      if (address.charAt(0) !== '/') {
        pointer.set(this['@data'], `/${address}`, value);
      } else {
        pointer.set(this['@data'], address, value);
      }
    } catch (E) {
      console.error(E);
    }

    // ensure the tip is updated
    try {
      await this.db.put(`/tips/${id}`, state.id);
      // TODO: migrate to Chain
      pointer.set(this['@data'], `/tips/${id}`, state.id);
      pointer.set(this['@data'], `${key}`, state['@data']);
    } catch (E) {
      console.error(E);
    }

    await this.commit();

    if (address.charAt(0) !== '/') {
      result = pointer.get(this['@data'], `/${address}`);
    } else {
      result = pointer.get(this['@data'], address);
    }

    return result;
  }

  async open () {
    await super.open();

    if (!fs.existsSync(this.config.path)) {
      mkdirp.sync(this.config.path);
    }

    try {
      this.db = level(this.config.path);
      this.trust(this.db);
      this.status = 'opened';
    } catch (E) {
      console.error('[STORE]', E);
    }

    return this;
  }

  async close () {
    if (this.db) {
      try {
        await this.db.close();
      } catch (E) {
        console.error('[STORE]', 'closing store:', this.config.path, E);
      }
    }

    await super.close();

    return this;
  }

  trust (source) {
    let store = this;

    source.on('put', function (key, value) {
      store.log('[STORE]', source.constructor.name, 'emitted a put event');

      let vector = new State(value);
      let message = {
        '@type': 'Request',
        '@method': 'put',
        '@actor': '~level',
        '@object': vector['@link'],
        '@target': key,
        '@data': value
      };

      store.emit('source/events', message);
      store.emit('special', message);
    });

    return this;
  }

  del (key) {
    return this.db.del(key);
  }

  batch (ops, done) {
    return this.db.batch(ops).then(done);
  }

  createReadStream () {
    return this.db.createReadStream();
  }

  flush () {
    if (fs.existsSync(this.config.path)) {
      fs.renameSync(this.config.path, this.config.path + '.' + Date.now());
    }
  }
}

module.exports = Store;
