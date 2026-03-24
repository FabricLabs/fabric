'use strict';

// Dependencies
const { Level } = require('level');
const crypto = require('crypto');
const merge = require('lodash.merge');
const pointer = require('json-pointer');

// Fabric Types
const Actor = require('./actor');
const Collection = require('./collection');
const Entity = require('./entity');
const Stack = require('./stack');
const State = require('./state');

/**
 * Long-term storage.
 * @property {Mixed} settings Current configuration.
 */
class Store extends Actor {
  /**
   * Create an instance of a {@link Store} to manage long-term storage, which is
   * particularly useful when building a user-facing {@link Product}.
   * @param  {Object} [settings={}] configuration object.
   * @return {Store}              Instance of the Store, ready to start.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/store',
      path: './stores/store',
      type: 'leveldb',
      persistent: true,
      verbosity: 2, // 0 none, 1 error, 2 warning, 3 notice, 4 debug
    }, settings);

    /**
     * Optional {@link Codec} for encrypted at-rest values (Level `valueEncoding`).
     * Browser and Hub-style apps typically use one {@link Store} with `codec` for
     * secrets and separate plain stores for cache/tips.
     */
    this.codec = this.settings.codec || null;

    this['@entity'] = {
      '@type': 'Store',
      '@data': {
        addresses: {}
      }
    };

    this.keys = {};
    this.commits = new Collection({
      type: 'State'
    });

    this._state = {
      actors: {},
      collections: {},
      content: {},
      documents: {},
      metadata: {},
      indices: {},
      routes: {},
      status: 'PAUSED',
      tips: {}
    };

    Object.defineProperty(this, '@allocation', { enumerable: false });
    Object.defineProperty(this, '@buffer', { enumerable: false });
    Object.defineProperty(this, '@encoding', { enumerable: false });
    Object.defineProperty(this, '@parent', { enumerable: false });
    Object.defineProperty(this, '@preimage', { enumerable: false });
    Object.defineProperty(this, 'frame', { enumerable: false });
    Object.defineProperty(this, 'services', { enumerable: false });

    return this;
  }

  /**
   * Settings object for a {@link Store} with {@link Codec} at-rest encryption
   * (same defaults as the legacy `Keystore` type). Prefer `openEncrypted` or
   * `new Store(Store.encryptedSettings(...))` over ad-hoc Codec wiring.
   * @param {Object} [settings={}]
   * @returns {Object} Settings merged with `codec` when absent.
   */
  static encryptedSettings (settings = {}) {
    const Codec = require('./codec');
    const envSeed = (typeof process !== 'undefined' && process.env && process.env.FABRIC_SEED) || null;
    const merged = merge({
      name: 'Keystore',
      path: './stores/keystore',
      type: 'EncryptedFabricStore',
      persistent: true,
      mode: 'aes-256-cbc',
      version: 0,
      seed: envSeed
    }, settings);

    const codec = merged.codec || new Codec({
      key: merged.key,
      mode: merged.mode,
      version: merged.version
    });

    return merge(merged, { codec });
  }

  /**
   * @param {Object} [settings={}]
   * @returns {Store}
   */
  static openEncrypted (settings = {}) {
    return new Store(Store.encryptedSettings(settings));
  }

  _getPathForKey (key) {
    const path = pointer.escape(key);
    return this.sha256(path);
  }

  async _errorHandler (err) {
    console.error('[FABRIC:STORE]', 'Error condition:', err);
  }

  async _setEncrypted (path, value, passphrase = '') {
    if (typeof path !== 'string' || !path.length) {
      throw new Error('Path is required for encrypted store writes.');
    }

    const plaintext = (typeof value === 'string') ? value : JSON.stringify(value);
    let secret = plaintext;

    // Prefer configured codec for at-rest encryption; fallback keeps compatibility.
    if (this.codec && typeof this.codec.encode === 'function') {
      const encoded = this.codec.encode(plaintext);
      secret = Buffer.isBuffer(encoded) ? encoded.toString('hex') : String(encoded);
    }

    const name = crypto.createHash('sha256').update(path).digest('hex');
    return this.set(`/secrets/${name}`, secret);
  }

  async _getEncrypted (path, passphrase = '') {
    if (typeof path !== 'string' || !path.length) return null;

    const name = crypto.createHash('sha256').update(path).digest('hex');
    const secret = await this.get(`/secrets/${name}`);
    if (secret == null) return null;

    let decrypted = secret;

    if (this.codec && typeof this.codec.decode === 'function') {
      const payload = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret), 'hex');
      decrypted = this.codec.decode(payload);
    }

    return decrypted;
  }

  /**
   * Registers an {@link Actor}.  Necessary to store in a collection.
   * @param  {Object} obj Instance of the object to store.
   * @return {Vector}     Returned from `storage.set`
   */
  async _REGISTER (obj) {
    const actor = new Actor(obj);
    const existing = await this._GET(`/entities/${actor.id}`);

    store.log('[STORE]', '_REGISTER', vector.id, vector['@type']);

    try {
      let item = await this._GET(`/entities/${vector.id}`);
    } catch (E) {
      this.warn('[STORE]', '_REGISTER', `Could not read from store:`, E);
    }

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

    if (this.settings.verbosity >= 5) this.log('[STORE]', '_GET', key);

    try {
      result = await this.get(key);
    } catch (E) {
      if (this.settings.verbosity >= 5) this.warn('[STORE]', '[_GET]', '[FAILURE]', E);
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
    this.log('[STORE]', '_PATCH', 'patch:', key, typeof patch, patch);

    const root = {};
    const current = await this._GET(key);

    if (this.settings.verbosity >= 3) console.warn('current value, no typecheck:', typeof current, current);
    const result = Object.assign(root, current || {}, patch);
    if (this.settings.verbosity >= 5) console.log('[STORE]', 'Patch result:', result);

    try {
      let action = await this._PUT(key, result);
    } catch (E) {
      console.error('Could not modify:', E);
    }

    return result;
  }

  /**
   * Insert something into a collection.
   * @param  {String}  key   Path to add data to.
   * @param  {Mixed}  value Object to store.
   * @return {Promise}       Resolves on success with a String pointer.
   */
  async _POST (key, value) {
    if (this.settings.verbosity >= 5) console.log('[STORE]', '_POST', key, typeof value, value);

    this['@method'] = '_POST';

    // preamble
    let self = this;
    let path = pointer.escape(key);
    let router = this.sha256(path);
    let address = `/collections/${router}`;

    if (!this.keys[address]) {
      // TODO: store metadata
      this.keys[address] = {
        path: key,
        address: address
      };
    }

    // TODO: check for commit state
    self['@entity']['@data'].addresses[router] = address;

    let state = new State(value);
    const serializedState = state.serialize();
    let serial = Buffer.isBuffer(serializedState)
      ? serializedState
      : Buffer.from(JSON.stringify(serializedState), 'utf8');
    let digest = this.sha256(serial);

    // defaults
    let actor = null;
    let list = null;
    let type = null;
    let tip = null;

    if (!self.db) {
      await self.open().catch(self._errorHandler.bind(self));
    }

    let family = null;
    let origin = null;
    let entity = null;

    // TODO: use ._GET
    try {
      entity = await self.db.get(address);
      // console.log('loading entity:', entity.toString('utf8'));
    } catch (E) {
      if (this.settings.verbosity >= 3) console.warn('Creating new collection:', E);
    }

    if (entity) {
      try {
        if (typeof entity === 'string') {
          entity = JSON.parse(entity);
        }
      } catch (E) {
        if (this.settings.verbosity >= 4 || this.settings.debug) {
          console.warn(`Couldn't parse: ${entity}`, E);
        }
      }
    }

    try {
      if (entity) {
        family = await self.populate(entity);
        if (this.settings.verbosity >= 5) console.warn('WARNING:', 'family exists, expecting restoration:', family);
        origin = new Collection(family);
      } else {
        origin = new Collection();
      }

      // Add Element to Collection
      let height = origin.push(value);

      // Store the object at an entity locale
      let object = await self._PUT(`/entities/${state.id}`, value);
      let serialized = await origin.serialize();

      // Keep in-memory collection view in sync for _GET/_PUT call paths.
      const existingList = await self._GET(key);
      const nextList = Array.isArray(existingList) ? existingList.concat([value]) : [value];
      await self._PUT(key, nextList);

      // Write serialized Collection to disk
      let answer = await self.db.put(address, serialized.toString());
    } catch (E) {
      console.log('Could not POST:', key, value, E);
      return false;
    }

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

  async encodeValue (value) {
    if (!(value instanceof String)) {
      switch (value.constructor.name) {
        default:
          value = JSON.stringify(value);
          break;
      }
    }

    return Buffer.from(value, 'utf8').toString('hex');
  }

  async getDataInfo (value) {
    let type = null;
    let size = null;
    let hash = null;

    switch (value.constructor.name) {
      case 'String':
        type = 'JSONString';
        size = value.length;
        hash = this.sha256(value);
        break;
      case 'Object':
      case 'Array': {
        const encoded = JSON.stringify(value);
        type = 'JSON';
        size = encoded.length;
        hash = this.sha256(encoded);
        break;
      }
      default:
        if (this.settings.verbosity >= 4 || this.settings.debug) {
          console.error('unhandled type:', value.constructor.name);
        }
        type = 'Unhandled';
        break;
    }

    return {
      hash,
      size,
      type
    };
  }

  async getRouteInfo (path) {
    if (path.substring(0, 1) !== '/') path = '/' + path;

    const id = pointer.escape(path);
    const router = this.sha256(id);

    return {
      path: path,
      pointer: id,
      index: router
    };
  }

  async populate (element) {
    let map = [];

    for (let i = 0; i < element.length; i++) {
      map[i] = await this._GET(`/entities/${element[i]}`);
    }

    return map;
  }

  /**
   * Barebones getter.
   * @param  {String}  key Name of data to retrieve.
   * @return {Promise}     Resolves on complete.  `null` if not found.
   */
  async get (key) {
    const route = await this.getRouteInfo(key);
    const result = pointer.get(this._state.content, route.path);
    const type = this._state.metadata[route.index].type;

    let output = null;

    switch (type) {
      default:
        output = result;
        break;
    }

    return output;
  }

  /**
   * Set a `key` to a specific `value`.
   * @param       {String} key   Address of the information.
   * @param       {Mixed} value Content to store at `key`.
   */
  async set (key, value) {
    const route = await this.getRouteInfo(key);
    const info = await this.getDataInfo(value);
    const data = await this.encodeValue(value);

    // Let's use the document's key as the identifying value.
    // This is what defines our key => value store.
    // All functions can be run as a map of an original input vector, allowing
    // binary scoping across trees of varying complexity.
    const hashInput = (typeof value === 'string' || Buffer.isBuffer(value))
      ? value
      : JSON.stringify(value);
    const hash = this.sha256(hashInput);
    const actor = new Actor({
      type: 'FabricDocument',
      content: data,
      encoding: 'json',
      original: value
    });

    this._state.actors[actor.id] = actor;
    this._state.documents[hash] = value;
    this._state.indices[route.index] = route.pointer;
    this._state.metadata[route.index] = info;

    pointer.set(this._state.content, route.path, value);

    this.commit();

    return this.get(key);
  }

  async open () {
    // await super.open();
    if (this.settings.verbosity >= 3) console.log('[FABRIC:STORE]', 'Opening:', this.settings.path);
    // if (this.db) return this;

    try {
      const levelOpts = {};
      if (this.codec && typeof this.codec.encode === 'function' && typeof this.codec.decode === 'function') {
        const codec = this.codec;
        levelOpts.valueEncoding = {
          name: 'fabric-codec',
          format: 'buffer',
          encode: function encodeFabricValue (value) {
            const out = codec.encode(value);
            if (out == null) throw new Error('[FABRIC:STORE] Codec.encode returned null');
            return Buffer.isBuffer(out) ? out : Buffer.from(typeof out === 'string' ? out : JSON.stringify(out), 'utf8');
          },
          decode: function decodeFabricValue (buffer) {
            return codec.decode(buffer);
          }
        };
      }
      this.db = new Level(this.settings.path, levelOpts);
      this.trust(this.db);
      this.status = 'opened';
      await this.commit();
      if (this.settings.verbosity >= 3) console.log('[FABRIC:STORE]', 'Opened!');
    } catch (E) {
      console.error('[FABRIC:STORE]', E);
      this.status = 'error';
    }

    if (this.settings.verbosity >= 3) console.log('[FABRIC:STORE]', 'Opened!');

    return this;
  }

  async close () {
    if (this.settings.verbosity >= 3) console.log('[FABRIC:STORE]', 'Closing:', this.settings.path);
    if (this.db) {
      try {
        await this.db.close();
      } catch (E) {
        this.error('[STORE]', 'closing store:', this.settings.path, E);
      }
    }

    // await super.close();
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

    source.on('write', function (key, value) {
      const valueType = (value && value.constructor && value.constructor.name) || typeof value;
      if (store.settings.verbosity >= 5) console.log('[TRUST:SOURCE]', source.constructor.name, 'emitted a write event', name, key, valueType, value);

      let id = pointer.escape(key);
      let router = store.sha256(id);
      let state = new Actor(value);

      // TODO: refactor storage paths
      pointer.set(store['@entity']['@data'], `${name}`, value);
      pointer.set(store['@entity']['@data'], `/states/${state.id}`, value);
      pointer.set(store['@entity']['@data'], `/blobs/${state.id}`, state.serialize());
      pointer.set(store['@entity']['@data'], `/types/${state.id}`, valueType);
      pointer.set(store['@entity']['@data'], `/tips/${router}`, state.id);
      pointer.set(store['@entity']['@data'], `/names/${router}`, id);

      // TODO: document this event
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

  /**
   * Remove a {@link Value} by {@link Path}.
   * @param {Path} key Key to remove.
   */
  async del (key) {
    if (!this.db) {
      await this.open();
    }

    const deleted = await this.db.del(key);
    return deleted;
  }

  async batch (ops) {
    if (this.settings.verbosity >= 5) console.log('[FABRIC:STORE]', 'Batching:', ops);
    let result = null;

    if (!this.db || this.db._status === 'closed') {
      await this.open();
    }

    // Core function
    try {
      result = await this.db.batch(ops);
      if (this.settings.verbosity >= 3) console.log('[FABRIC:STORE]', 'Batched:', result);
    } catch (E) {
      console.error('[FABRIC:STORE]', 'Could not batch updates:', E);
    }

    return result;
  }

  async commit () {
    if (this.settings.verbosity >= 5) console.log('[AUDIT]', '[FABRIC:STORE]', 'Committing:', this.state);
    const entity = new Entity(this.state.state);
    this.emit('commit', entity.id, entity.data);
    // TODO: document re-opening of store
    return entity;
  }

  createReadStream () {
    return this.db.createReadStream();
  }

  /**
   * Wipes the storage.
   */
  async flush () {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:STORE]', 'Flushing database...');

    for (let name in this['@entity']['@data'].addresses) {
      let address = this['@entity']['@data'].addresses[name];
      if (this.settings.verbosity >= 3) console.log('found address:', address);
      if (address) await this.del(address);
    }

    try {
      await this.del(`/collections`);
      await this.commit();
    } catch (E) {
      console.error('Could not wipe database:', E);
    }

    return this;
  }

  noop () {
    this.emit('noop');
    return this;
  }

  rotate () {
    return this;
  }

  /**
   * Start running the process.
   * @return {Promise} Resolves on complete.
   */
  async start () {
    if (this.settings.verbosity >= 3) console.log('[FABRIC:STORE]', 'Starting:', this.settings.path);
    this.status = 'starting';
    let keys = null;

    try {
      await this.open();
      this.status = 'started';
      // await this.commit();
    } catch (E) {
      console.error('[FABRIC:STORE]', 'Could not open db:', E);
    }

    if (this.settings.verbosity >= 3) console.log('[FABRIC:STORE]', 'Started on path:', this.settings.path);
    return this;
  }

  async stop () {
    this.status = 'stopping';

    if (this.settings.persistent !== true) {
      await this.flush();
    }

    try {
      await this.close();
    } catch (E) {
      console.error('Could not stop store:', E);
    }

    this.status = 'stopped';

    return this;
  }
}

module.exports = Store;
