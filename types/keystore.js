'use strict';

// Dependencies
const level = require('level');
const merge = require('lodash.merge');
const monitor = require('fast-json-patch');
const pointer = require('json-pointer');

// Fabric Types
const Actor = require('./actor');
const Codec = require('./codec');
const Message = require('./message');
const Tree = require('./tree');
const Key = require('./key');

/**
 * Provides an encrypted datastore for generic object storage.
 */
class KeyStore extends Actor {
  /**
   * Create an instance of the Store.
   * @param {FabricStoreConfiguration} [configuration] Settings to use.
   * @param {String} [configuration.name="DefaultStore"] Name of the Store.
   * @returns {KeyStore} Instance of the store.
   */
  constructor (settings = {}) {
    super(settings);
    if (!settings.seed) settings.seed = process.env.FABRIC_SEED || null;

    this.key = new Key(settings.key);
    this.settings = merge({
      name: 'DefaultStore',
      type: 'EncryptedFabricStore',
      path: './stores/keystore',
      mode: 'aes-256-cbc',
      key: { private: Buffer.from(this.key.privkey, 'hex') },
      version: 0
    }, this.settings, settings);

    this.tree = new Tree();
    this.level = null;
    this.db = null;

    this.codec = new Codec({
      key: this.settings.key,
      mode: this.settings.mode,
      version: this.settings.version
    });

    this._state = {
      status: 'initialized',
      version: this.settings.version,
      keys: [],
      value: {}
    };

    this.observer = monitor.observe(this._state.value, this._handleStateChange.bind(this));

    return this;
  }

  get states () {
    return [
      'initialized',
      'starting',
      'opening',
      'open',
      'started',
      'writing',
      'closing',
      'closed',
      'deleting',
      'deleted',
      'stopping',
      'stopped'
    ];
  }

  get status () {
    return this._state.status;
  }

  set status (value) {
    if (!value) throw new Error('Cannot set status to empty value.');
    if (!this.states.includes(value)) throw new Error(`Status value "${value}" is not one of ${this.states.length} valid states: ${JSON.stringify(this.states)}`);
    this._state.status = value;
    return this.status;
  }

  get state () {
    return Object.assign({}, this._state.value);
  }

  async commit () {
    const changes = monitor.generate(this.observer, true);
    if (changes) {
      const actor = new Actor(changes);
      this.emit('changes', changes);
      this.emit('message', Message.fromVector(['StateChange', {
        changes: changes,
        signature: actor.sign().signature
      }]));
    }
    return this;
  }

  async open () {
    const keystore = this;
    const promise = new Promise((resolve, reject) => {
      if (['open', 'writing'].includes(keystore.status)) return resolve(keystore);
      keystore.status = 'opening';

      async function _handleDiskOpen (err, db) {
        if (err) this.emit('error', `Could not open: ${err}`);
        this.status = 'open';
        let state = null;

        try {
          state = await this._getState();
        } catch (exception) {
          this.emit('warning', `Could not retrieve state`);
        }

        if (state) {
          // TODO: recursively cast { type, data } tuples as Buffer
          // where type === 'Buffer' && data
          await this._setState(state);
          await this.commit();
        }

        return this;
      }

      try {
        keystore.db = level(keystore.settings.path, {
          keyEncoding: keystore.codec,
          valueEncoding: keystore.codec
        }, _handleDiskOpen.bind(keystore));

        keystore.status = 'open';
        resolve(keystore);
      } catch (exception) {
        keystore.status = 'closed';
        reject(new Error(`Could not open store: ${exception}`));
      }
    });

    return promise;
  }

  async close () {
    this.status = 'closing';
    if (this.db) await this.db.close();
    this.status = 'closed';
    return this;
  }

  async batch (ops) {
    await this._batch(ops);
    return this;
  }

  async wipe () {
    if (this.status !== 'open') return this.emit('error', `Status not open: ${this.status}`);
    this.status = 'deleting';
    this._state.value = null;
    await this.db.clear();
    this.status = 'deleted';
    return this;
  }

  async get (path = '*') {
    return this._get(path);
  }

  async _handleStateChange (changes) {
    // console.log('changes:', changes);
  }

  async _applyChanges (changes) {
    monitor.applyPatch(this._state.value, changes);
    await this.commit();
    return this._get();
  }

  async _get (key = '*') {
    if (key === '*') return Object.assign({}, this._state.value);
    try {
      const result = pointer.get(this._state.value, `/${key}`);
      return result;
    } catch (exception) {
      return null;
    }
  }

  async _set (key, value) {
    if (!['open', 'deleting'].includes(this.status)) throw new Error(`Cannot write while status === ${this.status}`);
    this.status = 'writing';
    this._state.value[key] = value;
    await this.db.put(key, value);
    this.status = 'open';
    return this._get(key);
  }

  async _batch (ops) {
    await this.db.batch(ops);
    return this;
  }

  async _getState () {
    const keystore = this;
    const promise = new Promise((resolve, reject) => {
      async function loadStateFromDisk () {
        try {
          const result = await keystore.db.get('/');
          // TODO: actor.deserialize();
          return JSON.parse(result);
        } catch (exception) {
          return null;
        }
      }

      loadStateFromDisk().then(resolve).catch(reject);
    });
    return promise;
  }

  /**
   * Saves an Object to the store.
   * @param {Object} state State to store.
   * @returns {Actor} The local instance of the provided State's {@link Actor}.
   */
  async _setState (state) {
    if (!state) throw new Error('State must be provided.');
    if (!['open', 'deleting'].includes(this.status)) throw new Error(`Store is not writable.  Currently: ${this.status}`);

    const keystore = this;
    const promise = new Promise((resolve, reject) => {
      for (const key in state) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          keystore._state.keys.push(key);
          keystore._state.value[key] = state[key];
        }
      }

      this._syncStateToDisk().then(resolve).catch(reject);
    });

    return promise;
  }

  async _syncStateToDisk () {
    if (!['open', 'deleting'].includes(this.status)) throw new Error(`Store is not writable.  Currently: ${this.status}`);

    const keystore = this;
    const promise = new Promise((resolve, reject) => {
      const actor = new Actor(this.state);
      const serialized = actor.serialize();
      console.log('serialized:', serialized);
      return keystore.db.put('/', serialized).then(resolve).catch(reject);
    });

    return promise;
  }

  async start () {
    this.status = 'starting';
    await this.open();
    this.status = 'started';
    return this;
  }

  async stop () {
    this.status = 'stopping';
    await this.close();
    this.status = 'stopped';
    return this;
  }
}

module.exports = KeyStore;
