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

class KeyStore extends Actor {
  constructor (settings = {}) {
    super(settings);
    if (!settings.seed) settings.seed = process.env.FABRIC_SEED || null;

    this.key = new Key(settings);
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
      key: { private: this.key.privkey },
      mode: this.settings.mode,
      version: this.settings.version
    });

    this._state = {
      status: 'initialized',
      value: {}
    };

    this.observer = monitor.observe(this._state.value, this._handleStateChange.bind(this));

    return this;
  }

  get states () {
    return [
      'initialized',
      'opening',
      'open',
      'writing',
      'closing',
      'closed',
      'deleting',
      'deleted'
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
    const promise = new Promise(async (resolve, reject) => {
      if (['open', 'writing'].includes(keystore.status)) return resolve(keystore);
      keystore.status = 'opening';

      async function _handleOpen (err, db) {
        keystore.status = 'open';

        try {
          await keystore._getState();
        } catch (exception) {
          ('Unable to load state:', exception);
        }
        resolve(keystore);
      }

      try {
        keystore.db = level(keystore.settings.path, {
          keyEncoding: keystore.codec,
          valueEncoding: keystore.codec
        }, _handleOpen.bind(keystore));
      } catch (exception) {
        keystore.status = 'closed';
        reject(`Could not open store: ${exception}`);
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

  async wipe () {
    if (this.status !== 'open') return this.emit('error', `Status not open: ${this.status}`);
    this.status = 'deleting';
    this._state.value = null;
    await this.db.clear();
    this.status = 'deleted';
    return this;
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
    return pointer.get(this._state.value, `/${key}`);
  }

  async _set (key, value) {
    if (!['open', 'deleting'].includes(this.status)) throw new Error(`Cannot write while status === ${this.status}`);
    this.status = 'writing';
    this._state.value[key] = value;
    await this.db.put(key, value);
    this.status = 'open';
    return this._get(key);
  }

  async _getState () {
    if (!['open'].includes(this.status)) throw new Error(`Store is not open.  Currently: ${this.status}`);
    const keystore = this;
    const promise = new Promise(async (resolve, reject) => {
      try {
        const result = await keystore.db.get('/');
        const state = JSON.parse(result);
        // TODO: recursively cast { type, data } tuples as Buffer
        // where type === 'Buffer' && data
        await keystore._setState(state);
        await keystore.commit();
        resolve(state);
      } catch (exception) {
        reject(exception);
      }
    });
    return promise;
  }

  async _setState (state) {
    if (!state) throw new Error('State must be provided.');
    if (!['open', 'deleting'].includes(this.status)) throw new Error(`Store is not writable.  Currently: ${this.status}`);

    const keystore = this;
    const promise = new Promise(async (resolve, reject) => {
      const ops = [];
      const meta = { keys: [] };
      const actor = new Actor(state);
      const transition = {
        subject: 'state',
        predicate: 'becomes',
        object: state
      };

      // Phase 1
      for (let key in state) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          meta.keys.push(key);
          ops.push({ type: 'put', key: `/${key}`, value: state[key] });
          keystore._state.value[key] = state[key];
        }
      }

      if (ops.length) await keystore.db.batch(ops).catch(reject);

      // Phase 2
      try {
        await keystore.db.put('/', actor.serialize());
        await keystore.commit();
      } catch (exception) {
        return reject(exception);
      }

      return resolve(actor);
    });

    return promise;
  }
}

module.exports = KeyStore;
