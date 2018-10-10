'use strict';

const path = require('path');

const Machine = require('./machine');
const Resource = require('./resource');
const Store = require('./store');
const Walker = require('./walker');
const Vector = require('./vector');

/**
 * An Oracle manages one or more collections, using a <code>mempool</code> for
 * transitive state.
 * @extends Store
 */
class Oracle extends Store {
  /**
   * Trusted point-of-reference for external services.
   * @param       {Object} initial - Initialization vector.
   */
  constructor (init) {
    super(init);

    this.name = 'Oracle';
    this.config = Object.assign({
      path: './data/oracle'
    }, init);

    this.machine = new Machine();
    this.mempool = [];

    this.resources = new Set();
    this.keys = new Set();

    return this;
  }

  async define (name, definition) {
    let resource = Object.assign({
      name: name
    }, definition);

    this.resources[name] = new Resource(resource);

    console.log('defined resource:', this.resources[name]);

    return this.resources[name];
  }

  async start () {
    await super.start();

    await Promise.all([
      this.define('Asset', {
        attributes: {
          name: { type: 'String', required: true, max: 220 }
        }
      }),
      this.define('Hash', {
        attributes: {
          'sha256': { type: 'String', required: true, max: 32 },
          '@data': { type: 'String', required: true, max: 2048 }
        }
      })
    ]);

    // TODO: pre-populate
    // this.state = await this._GET('/');
    // console.log('state retrieved:', this.state);
    this.machine.on('changes', this._handleStateChange.bind(this));

    return this;
  }

  /**
   * Synchronously reads a local path into memory.
   * @param  {String} path - dir (path to read)
   * @return {Vector} Computed vector.
   */
  async _load (dir) {
    let self = this;
    let walker = new Walker();

    let map = await walker._define(dir, {});
    let list = Object.keys(map);

    for (var i = 0; i < list.length; i++) {
      let file = path.join('/', list[i]);
      let content = map[list[i]];
      console.debug('[ORACLE]', 'saving:', content.length, 'bytes to', file);
      let result = await self.storage.set(file, content);
      let vector = new Vector(result)._sign();
    }

    let tree = list.map(function (x) {
      return x.replace(/^(.*)\/(.*)$/, '$2');
    });

    var response = [];

    try {
      let assets = await self._PUT('/assets', tree);
      self.tree = new Vector(assets)._sign();
      response = self.tree;
    } catch (E) {
      console.error(E);
    }

    return response;
  }

  async _sync () {
    for (let name in this.machine.state) {
      let data = this.machine.state[name];
      let path = `/${name}`;
      await this._PUT(path, data);
    }
  }

  /**
   * Registers an object.  Necessary to store in a collection.
   * @param  {Object} obj Instance of the object to store.
   * @return {Vector}     Returned from `storage.set`
   */
  async _REGISTER (obj) {
    let result = null;
    let vector = new Vector(obj)._sign();

    try {
      result = await this._SET(`/actors/${vector.id}`, obj);
    } catch (E) {
      console.error('Error creating object:', E, obj);
    }

    return result;
  }

  async flush () {
    this.log('[ORACLE]', 'flush requested:', this.keys);

    for (let item of this.keys) {
      this.log('...flushing:', item);
      try {
        await this._DELETE(item);
      } catch (E) {
        console.error(E);
      }
    }
  }

  _handleStateChange (changes) {
    this.mempool.push(changes);
    this.emit('changes', changes);
  }

  /**
   * Core messaging function for interacting with this object in system-time.
   * @param  {Message} msg Instance of a {@link module:Message} object, validated then transmitted verbatim.
   * @return {Boolean}     Returns `true` on success, `false` on failure.
   */
  broadcast (msg) {
    return this.emit('message', msg);
  }
}

module.exports = Oracle;
