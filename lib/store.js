'use strict';

// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
const fs = require('fs');
const level = require('level');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const pointer = require('json-pointer');

// internal components
const Collection = require('./collection');
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
      persistent: true
    }, config);

    this['@entity'] = {
      '@type': 'Store',
      '@data': {}
    };

    this['@entity']['@data'].types = {};
    this['@entity']['@data'].blobs = {};
    this['@entity']['@data'].states = {};
    this['@entity']['@data'].collections = {};
    this['@entity']['@data'].tips = {};

    Object.assign(this['@data'], this['@entity']['@data']);

    return this;
  }

  /**
   * Registers an {@link Actor}.  Necessary to store in a collection.
   * @param  {Object} obj Instance of the object to store.
   * @return {Vector}     Returned from `storage.set`
   */
  async _REGISTER (obj) {
    let store = this;
    let result = null;
    let vector = new State(obj);

    store.log('[STORE]', '_REGISTER', vector.id, vector['@type']);

    try {
      await this._SET(`/types/${vector.id}`, vector['@type']);
    } catch (E) {
      this.error('Error creating object:', E, obj);
    }

    try {
      result = await this._SET(`/entities/${vector.id}`, vector['@data']);
    } catch (E) {
      this.error('Error creating object:', E, obj);
    }

    return result;
  }

  async _GET (key) {
    let result = null;

    this.log('[STORE]', '_GET', key);

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
    console.log('[STORE]', '_PATCH', 'patch:', key, patch.constructor.name, patch);
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
    this.log('[STORE]', '_POST', 'post:', key, value.constructor.name, value);

    this['@method'] = '_POST';

    // preamble
    let self = this;
    let path = pointer.escape(key);
    let router = this.sha256(path);

    let state = new State(value);
    let serial = state.serialize();
    let digest = this.sha256(serial);

    // defaults
    let actor = null;
    let list = null;
    let type = null;
    let tip = null;

    if (!self.db) {
      await self.open();
    }

    let entity = await self._REGISTER(value);
    let collection = `/collections/${router}`;
    let route = await self._REGISTER(collection);

    try {
      list = await self._GET(collection);
    } catch (E) {
      this.warn('Collection does not exist.', E);
    }

    // defaults
    if (!list) list = [];

    // internal variables
    let origin = new Collection(list);
    let leaves = new State(list);

    try {
      actor = await this._REGISTER(value);
    } catch (E) {
      console.trace(E);
    }

    let height = origin.push(value);
    let result = await origin.commit();
    let vector = await self._REGISTER(origin);
    let mapper = await this._SET(`${collection}`, origin);
    let commit = await this.commit();
    let after = await this._GET(`${collection}`);

    return state.link;
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
    this.log('[STORE]', 'get:', key);

    let self = this;
    let id = pointer.escape(key);
    let router = this.sha256(id);

    let type = null;
    let state = null;
    let tip = null;
    let collection = null;

    if (!self.db) {
      await self.open();
    }

    try {
      collection = await self.db.get(`/collections/${router}`);
    } catch (E) {
      collection = router;
    }

    console.log('getting got:', collection);

    try {
      tip = await self.db.get(`/tips/${collection}`);
    } catch (E) {
      self.error(`cannot get tip [${collection}] "/tips/${collection}":`, E);
    }

    try {
      type = await self.db.get(`/types/${tip}`);
    } catch (E) {
      self.error(`cannot get type`, E);
    }

    try {
      state = await self.db.get(`/states/${tip}`);
    } catch (E) {
      self.error(`cannot get state [${tip}] "/states/${tip}":`, E);
    }

    switch (type) {
      default:
        return State.fromHex(state);
      case 'Buffer':
        return Buffer.from(state, 'hex');
    }
  }

  /**
   * Set a `key` to a specific `value`.
   * @param       {String} key   Address of the information.
   * @param       {Mixed} value Content to store at `key`.
   */
  async set (key, value) {
    this.log('[STORE]', `(${this['@method']})`, 'set:', key, value.constructor.name, value);

    let self = this;

    // Let's use the document's key as the identifying value.
    // This is what defines our key => value store.
    // All functions can be run as a map of an original input vector, allowing
    // binary scoping across trees of varying complexity.
    let id = pointer.escape(key);
    let router = this.sha256(id);

    // locals
    let origin = new State(self['@data']);
    let vector = new State(value);
    let serial = vector.serialize(value);
    let digest = this.sha256(serial);
    let batched = null;

    // Since we're using JavaScript, we can use Object literals.
    // See also: https://to.fabric.pub/#purity:fabric.pub
    let pure = {
      '@id': vector.id,
      '@data': value,
      '@type': value.constructor.name,
      '@link': `/states/${vector.id}`,
      '@state': vector,
      '@parent': origin.id,
      '@buffer': serial
    };

    if (!self.db) {
      await self.open();
    }

    let ops = [
      { type: 'put', key: `/states/${pure['@id']}`, value: serial.toString('hex'), encoding: 'hex' },
      { type: 'put', key: `/blobs/${pure['@id']}`, value: serial.toString('hex'), encoding: 'hex' },
      { type: 'put', key: `/types/${pure['@id']}`, value: pure['@type'] },
      { type: 'put', key: `/tips/${router}`, value: pure['@id'] },
      { type: 'put', key: `/names/${router}`, value: id }
    ];

    try {
      batched = await self.db.batch(ops);
    } catch (E) {
      console.error('BATCH FAILURE:', E);
    }

    try {
      await Promise.all(ops.map(op => {
        return self.db.put(op.key, op.value);
      }));
    } catch (E) {
      console.error(E);
    }

    this.commit();

    return this.get(key);
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
      this.error('[STORE]', E);
    }

    return this;
  }

  async close () {
    if (!this.config.persistent) {
      await this.flush();
    }

    if (this.db) {
      try {
        await this.db.close();
      } catch (E) {
        this.error('[STORE]', 'closing store:', this.config.path, E);
      }
    }

    await super.close();

    return this;
  }

  /**
   * Implicitly trust an {@link Event} source.
   * @param  {EventEmitter} source Event-emitting source.
   * @return {Store}        Resulting instance of {@link Store} with new trust.
   */
  trust (source) {
    let store = this;
    let name = `/sources/${store.id}`;

    source.on('put', function (key, value) {
      store.log('[TRUST:SOURCE]', source.constructor.name, 'emitted a put event', name, key, value.constructor.name, value);

      let id = pointer.escape(key);
      let router = store.sha256(id);
      let state = new State(value);

      pointer.set(store['@entity']['@data'], `${name}`, value);
      pointer.set(store['@entity']['@data'], `/states/${state.id}`, value);
      pointer.set(store['@entity']['@data'], `/blobs/${state.id}`, state.serialize());
      pointer.set(store['@entity']['@data'], `/types/${state.id}`, value.constructor.name);
      pointer.set(store['@entity']['@data'], `/tips/${router}`, state.id);
      pointer.set(store['@entity']['@data'], `/names/${router}`, id);

      store.emit('source/events', {
        '@type': 'Request',
        '@method': 'put',
        '@actor': '~level',
        '@object': state['@link'],
        '@target': key,
        '@data': value
      });
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
      rimraf.sync(this.config.path);
    }
  }

  rotate () {
    if (fs.existsSync(this.config.path)) {
      fs.renameSync(this.config.path, this.config.path + '.' + Date.now());
    }
  }
}

module.exports = Store;
