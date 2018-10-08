'use strict';

// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
const fs = require('fs');
const level = require('level');
const mkdirp = require('mkdirp');

const monitor = require('fast-json-patch');
const pointer = require('json-pointer');

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

    return this;
  }

  async _SET (key, value) {
    return this.set(key, value);
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

  async _PUT (key, value) {
    return this.set(key, value);
  }

  async _PATCH (key, patch) {
    let genesis = {};
    let root = null;

    let current = await this._GET(key);

    return root;
  }

  async _POST (key, value) {
    let current = await this._GET(`${key}`);
    let vector = new State(value);
    let snapshot = await this._PUT(`/hashes/${vector.id}`, vector['@input']);

    // TODO: check to ensure collection type
    let output = await this._PUSH(`${key}`, vector.id);
    let entity = await this._GET(`/hashes/${vector.id}`);

    return entity['@data'];
  }

  async _PUSH (key, id) {
    let parts = key.split('/');
    let path = (parts[1]) ? `/collections/${parts[1]}` : `stack/${key}`;

    // get current value
    let current = await this._GET(path);
    let origin = new Stack(current);
    let result = origin.push(id);
    let claim = new State(origin['@data'].map(x => {
      return x.id;
    }));

    await this._PUT(`/hashes/${result.id}`, result['@input']);
    await this._PUT(`/hashes/${claim.id}`, claim['@input']);
    await this._PUT(`/collections/${key}`, claim['@input']);
    await this._PUT(`/${key}`, result['@data']);

    let output = await this._GET(`/collections/${key}`);

    return output;
  }

  /**
   * Barebones getter.
   * @param  {String}  key Name of data to retrieve.
   * @return {Promise}     Resolves on complete.  `null` if not found.
   */
  async get (key) {
    let self = this;
    let data = null;

    if (!self.db) {
      await this.open();
    }

    try {
      data = await self.db.get(key);
    } catch (E) {
      this.warn(`Could not retrieve key ${key}:`, E);
    }

    return data;
  }

  /**
   * Set a `key` to a specific `value`.
   * @param       {String} key   Address of the information.
   * @param       {Mixed} value Content to store at `key`.
   */
  async set (key, value) {
    let self = this;
    let overlay = new State(value);
    let raw = overlay.toString();

    if (!self.db) {
      await this.open();
    }

    if (this.config.debug) {
      console.debug('[STORE]', 'setting:', key, raw.length, 'bytes');
    }

    try {
      // await self.db.put(key, raw);
      await self.db.put(key, value);
    } catch (E) {
      console.debug(E);
    }

    pointer.set(this.state['@data'], key, value);

    await overlay.commit();
    await this.commit();

    let changes = monitor.generate(this.observer);

    if (changes && changes.length) {
      let transaction = new State({
        '@actor': this.agent,
        '@creator': this.agent,
        '@target': key,
        '@object': value,
        '@resource': this.name,
        '@type': 'Transaction',
        '@data': this.state['@data'],
        '@input': `SET ${key} ${overlay.id} ${this.state.serialize(overlay['@data'])}`,
        '@state': this.state.id,
        '@changes': changes
      });

      await transaction.commit();

      this.emit('changes', changes);
      this.emit('transaction', transaction);
    }

    return pointer.get(this.state['@data'], key);
  }

  async open () {
    await super.open();

    if (!fs.existsSync(this.config.path)) {
      mkdirp.sync(this.config.path);
    }

    try {
      this.db = level(this.config.path);
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
