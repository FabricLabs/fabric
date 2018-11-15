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
      path: './data/store',
      get: this.get,
      set: this.set,
      del: this.del,
      transform: this.transform,
      createReadStream: this.createReadStream
    }, config);

    this.state['@data'].blobs = {};
    this.state['@data'].tips = {};

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
      result = await this._SET(`/states/${vector.id}`, obj);
      this.emit('state', await this._GET(`/states/${vector.id}`));
    } catch (E) {
      console.error('Error creating object:', E, obj);
    }

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
    let genesis = {};
    let root = null;

    let current = await this._GET(key);

    return root;
  }

  async _POST (key, value) {
    let id = pointer.escape(key);
    let path = `/collections/${id}`;
    let list = await this._GET(`${path}`);

    if (!list) list = [];

    let vector = new State(value);
    let collection = new Stack(list);
    let actor = await this._REGISTER(value);

    collection.push(value);

    let leaves = collection['@data'].map(x => x.toString('hex'));

    // set state values
    let actor = await this._REGISTER(value);
    let inject = await this._SET(`${key}/${vector.id}`, vector['@data']);
    let saved = await this._SET(`${key}`, leaves);
    let hidden = await this._SET(`${path}`, leaves);
    let commit = await this.commit();

    this.emit(`channels/${id}`, vector);

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
    let output = await this._GET(`/blobs/${vector.id}`);
    let commit = await this.commit();

    return output;
  }

  /**
   * Barebones getter.
   * @param  {String}  key Name of data to retrieve.
   * @return {Promise}     Resolves on complete.  `null` if not found.
   */
  async get (key) {
    let self = this;
    let item = null;
    let hash = null;
    let path = pointer.escape(key);

    if (!self.db) {
      await this.open();
    }

    try {
      hash = await self.db.get(`/tips/${path}`);
    } catch (E) {
      this.warn(`Could not retrieve tip ${path}:`, E);
    }

    try {
      item = await self.db.get(`/blobs/${hash}`);
    } catch (E) {
      this.warn(`Could not retrieve item [${hash}]:`, E);
    }

    if (item) {
      try {
        item = State.fromString(item);
        if (item['@data']) {
          switch (item['@data']['@type']) {
            case 'Array':
              item = item['@data']['@data'];
              break;
            case 'String':
              item = item['@data']['@buffer'].toString();
              break;
          }
        }
      } catch (E) {
        this.warn(`Could not parse as JSON: "${item}":`, E);
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
    let id = pointer.escape(key);
    let state = new State(value);
    let pure = { '@id': state.id, '@data': state['@data'], '@type': value.constructor.name };
    let raw = (typeof value === 'string') ? JSON.stringify(value) : state.serialize(value);
    let address = `/blobs/${state.id}`;
    let stack = new Stack([state.id]);
    let result = null;

    stack.push(`${raw}`);
    stack.push(`OP_SHA256`);
    stack.push(`${state.id}`);
    stack.push(`OP_EQUALVERIFY`);

    this['@type'] = value.constructor.name;
    this['@pure'] = pure;
    this['@encoding'] = 'json';

    if (!this.db) {
      await this.open();
    }

    // ensure the document is stored on disk
    try {
      await this.db.put(address, raw);
      // TODO: migrate to events
      if (address.charAt(0) !== '/') {
        pointer.set(this['@data'], `/${address}`, value);
      } else {
        pointer.set(this['@data'], address, value);
      }
    } catch (E) {
      console.debug(E);
    }

    // ensure the tip is updated
    try {
      await this.db.put(`/tips/${id}`, state.id);
      // TODO: migrate to Chain
      pointer.set(this['@data'], `/tips/${id}`, state.id);
    } catch (E) {
      console.debug(E);
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
