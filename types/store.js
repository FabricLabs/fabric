'use strict';

const { PERSISTED_JSON_MAX_CHARS } = require('../constants');
const { tryParsePersistedJson } = require('../functions/wireJson');

// Dependencies
const { Level } = require('level');
const merge = require('lodash.merge');
const pointer = require('json-pointer');

// Fabric Types
const Actor = require('./actor');
const Collection = require('./collection');
const Entity = require('./entity');
const Stack = require('./stack');
const State = require('./state');

/**
 * Level before abstract-level 2 throws `LEVEL_NOT_FOUND` for a missing key;
 * later versions resolve `undefined`.
 * @private
 */
function isLevelNotFound (error) {
  return !!error && (error.code === 'LEVEL_NOT_FOUND' || error.notFound === true);
}

/** `path` as an absolute JSON Pointer path. */
function routePath (path) {
  return path.substring(0, 1) === '/' ? path : '/' + path;
}

/** Path tokens that would reach `Object.prototype` through `pointer.set`. */
const UNSAFE_PATH_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * A value read back from Level. `set` cannot store `null`, so persisted `null`
 * text was the string 'null'.
 * @private
 */
function decodePersisted (raw) {
  if (Buffer.isBuffer(raw)) {
    const text = raw.toString('utf8');
    const pr = tryParsePersistedJson(text);
    return pr.ok && pr.value !== null ? pr.value : text;
  }
  if (typeof raw === 'string') {
    const pr = tryParsePersistedJson(raw);
    return pr.ok && pr.value !== null ? pr.value : raw;
  }
  return raw;
}

/**
 * @classdesc Level-backed persistence extending {@link Actor}. Use optional {@link Codec} in <code>settings.codec</code> for
 * encrypted values; {@link Store.openEncrypted} matches Hub/shell keystore defaults. Commit/history behavior follows {@link Actor}.
 * @class Store
 * @extends Actor
 * @property {Mixed} settings Current configuration.
 */
class Store extends Actor {
  /**
   * Create an instance of a {@link Store} to manage long-term storage (LevelDB by default).
   * @param  {Object} [settings={}] configuration object (<code>path</code>, <code>codec</code>, <code>persistent</code>, …).
   * @param  {boolean} [settings.strict=false] `get` rejects when Level fails to read (a missing key still resolves `null`) and `set` rejects when Level fails to write, instead of resolving as if nothing went wrong
   * @return {Store} Instance of the Store, ready to start.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/store',
      path: './stores/store',
      type: 'leveldb',
      persistent: true,
      strict: false,
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

  async _setEncrypted (path, value, _passphrase = '') {
    if (typeof path !== 'string' || !path.length) {
      throw new Error('Path is required for encrypted store writes.');
    }

    const plaintext = (typeof value === 'string') ? value : JSON.stringify(value);
    let secret = plaintext;

    // Prefer configured codec for at-rest encryption; fallback keeps compatibility.
    if (this.codec && typeof this.codec.encode === 'function') {
      const encoded = this.codec.encode(plaintext);
      const encodedBuffer = Buffer.isBuffer(encoded)
        ? encoded
        : Buffer.from(String(encoded), 'utf8');
      secret = encodedBuffer.toString('hex');
    }

    const name = this._getPathForKey(path);
    return this.set(`/secrets/${name}`, secret);
  }

  async _getEncrypted (path, _passphrase = '') {
    if (typeof path !== 'string' || !path.length) return null;

    const name = this._getPathForKey(path);
    const secret = await this.get(`/secrets/${name}`);
    if (secret == null) return null;

    let decrypted = secret;

    if (this.codec && typeof this.codec.decode === 'function') {
      let payload = secret;
      if (!Buffer.isBuffer(payload)) {
        const serialized = String(secret);
        const isHex = /^[0-9a-fA-F]+$/.test(serialized) && serialized.length % 2 === 0;
        payload = Buffer.from(serialized, isHex ? 'hex' : 'utf8');
      }
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
    let result = null;

    this.log('[STORE]', '_REGISTER', actor.id, actor.type);

    try {
      await this._GET(`/entities/${actor.id}`);
    } catch (E) {
      this.warn('[STORE]', '_REGISTER', `Could not read from store:`, E);
    }

    try {
      await this._SET(`/types/${actor.id}`, actor.type);
    } catch (E) {
      this.error('Error creating object:', E, obj);
    }

    try {
      result = await this._SET(`/entities/${actor.id}`, actor.toObject());
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
      await this._PUT(key, result);
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
    if (value == null) {
      throw new Error('Store._POST requires a JSON body');
    }
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

    if (entity && (typeof entity === 'string' || Buffer.isBuffer(entity))) {
      const text = typeof entity === 'string' ? entity : entity.toString('utf8');
      const pr = tryParsePersistedJson(text);
      if (pr.ok) entity = pr.value;
      else if (this.settings.verbosity >= 4 || this.settings.debug) {
        console.warn(`Couldn't parse entity JSON: ${pr.error.message}`);
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
      origin.push(value);

      // Store the object at an entity locale
      await self._PUT(`/entities/${state.id}`, value);
      let serialized = await origin.serialize();

      // Keep in-memory collection view in sync for _GET/_PUT call paths.
      const existingList = await self._GET(key);
      const persistedList = Array.isArray(family) ? family.filter((item) => item != null) : [];
      const inMemoryList = Array.isArray(existingList) ? existingList.filter((item) => item != null) : [];
      const seedList = inMemoryList.length ? inMemoryList : persistedList;
      const nextList = seedList.concat([value]);
      await self._PUT(key, nextList);

      // Write serialized Collection to disk
      await self.db.put(address, serialized.toString());
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
    stack.push(vector.id);
    await this._REGISTER(data);
    await this._PUT(`/blobs/${vector.id}`, vector['@data']);
    await this._SET(path, stack['@data']);
    await this.commit();
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
    path = routePath(path);

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
    let result;
    try {
      result = pointer.get(this._state.content, route.path);
    } catch (_) {
      result = undefined;
    }

    // Durable fallback: hydrate from Level when memory has no entry (e.g. after reopen).
    if (result === undefined && this.db && this.settings.persistent !== false) {
      try {
        const raw = await this.db.get(route.path);
        // Level 10 resolves a missing key as `undefined` instead of throwing.
        if (raw === undefined || raw === null) return null;
        const value = decodePersisted(raw);
        const info = await this.getDataInfo(value);
        this._state.metadata[route.index] = info;
        this._state.indices[route.index] = route.pointer;
        pointer.set(this._state.content, route.path, value);
        return value;
      } catch (E) {
        if (this.settings.strict && !isLevelNotFound(E)) throw E;
        return null;
      }
    }

    if (result === undefined) return null;

    const meta = this._state.metadata[route.index];
    const type = meta && meta.type;

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
    // Writes under one top-level key run in call order, so a parent and its
    // children never race and Level and memory agree on the last write. The
    // write is queued before any await, so `stop` sees it.
    const lane = routePath(key).split('/')[1] || '';
    if (!this._writes) this._writes = new Map();
    const previous = this._writes.get(lane) || Promise.resolve();
    const write = previous.catch(() => {}).then(async () => this._set(key, value, await this.getRouteInfo(key)));
    const tail = write.catch(() => {});
    this._writes.set(lane, tail);
    tail.then(() => {
      if (this._writes.get(lane) === tail) this._writes.delete(lane);
    });
    return write;
  }

  /**
   * Why `path` cannot be written: it names an unsafe key, or an existing
   * parent (in memory, or in Level after a reopen) is not an object.
   * @private
   */
  async _parentError (path) {
    let tokens = [];
    try {
      tokens = pointer.parse(path);
    } catch (E) {
      return `bad path ${path}`;
    }
    if (tokens.some((token) => UNSAFE_PATH_TOKENS.has(token))) return `${path} names a reserved key`;
    const beneath = `${path} is beneath a value that is not an object`;
    let node = this._state.content;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (node === null || typeof node !== 'object') return beneath;
      if (!Object.prototype.hasOwnProperty.call(node, tokens[i])) {
        return (await this._persistedParentIsScalar(tokens, i)) ? beneath : null;
      }
      node = node[tokens[i]];
    }
    return (node === null || typeof node !== 'object') ? beneath : null;
  }

  /**
   * Is an ancestor from `tokens[from]` down, absent from memory, stored in
   * Level as something other than an object?
   * @private
   */
  async _persistedParentIsScalar (tokens, from) {
    if (!this.db || this.settings.persistent === false) return false;
    for (let i = from; i < tokens.length - 1; i++) {
      let raw;
      try {
        raw = await this.db.get(pointer.compile(tokens.slice(0, i + 1)));
      } catch (E) {
        if (isLevelNotFound(E)) continue;
        if (this.settings.strict) throw E;
        continue;
      }
      if (raw === undefined || raw === null) continue;
      const value = decodePersisted(raw);
      if (value === null || typeof value !== 'object') return true;
    }
    return false;
  }

  /** @private */
  async _set (key, value, route) {
    const parentError = await this._parentError(route.path);
    if (parentError) throw new Error(`[FABRIC:STORE] ${parentError}`);
    const persisting = !!this.db && this.settings.persistent !== false;
    // Level reads text back through the persisted JSON cap: a longer object would reopen as a string.
    if (persisting && typeof value !== 'string' && !Buffer.isBuffer(value)
      && JSON.stringify(value).length > PERSISTED_JSON_MAX_CHARS) {
      throw new Error(`[FABRIC:STORE] ${route.path} is larger than ${PERSISTED_JSON_MAX_CHARS} characters of JSON`);
    }
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

    // Persist path → value when Level is open (survives stop/start reopen),
    // before memory or a commit shows it: a strict write that fails changes nothing.
    if (persisting) {
      try {
        const payload = (typeof value === 'string')
          ? value
          : (Buffer.isBuffer(value) ? value : JSON.stringify(value));
        await this.db.put(route.path, payload);
      } catch (E) {
        if (this.settings.strict) throw E;
        console.error('[FABRIC:STORE]', 'Could not persist key:', route.path, E);
      }
    }

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
    // `abstract-level` opens a tick after construction and queues operations while
    // `opening`, so skipping that state would silently drop the wipe.
    const status = this.db && (this.db.status || this.db._status);
    if (!this.db || (status !== 'open' && status !== 'opening')) return this;

    if (this.settings.verbosity >= 4) console.log('[FABRIC:STORE]', 'Flushing database...');

    try {
      for (let name in this['@entity']['@data'].addresses) {
        let address = this['@entity']['@data'].addresses[name];
        if (this.settings.verbosity >= 3) console.log('found address:', address);
        if (address) await this.del(address);
      }

      await this.del(`/collections`);
      await this.commit();
    } catch (E) {
      const code = E && E.code;
      if (code === 'LEVEL_DATABASE_NOT_OPEN') return this;
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

    // Queued writes finish before Level closes, so none fails against a closed db.
    while (this._writes && this._writes.size) {
      await Promise.all([...this._writes.values()]);
    }

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
