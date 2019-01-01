'use strict';

const Machine = require('./machine');
const Resource = require('./resource');
const Store = require('./store');

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
      path: './data/oracle',
      services: ['http'],
      resources: {
        Actors: {},
        Keys: {}
      }
    }, init);

    this.machine = new Machine(this.config);
    this.mempool = [];

    this.resources = new Set();
    this.keys = new Set();

    return this;
  }

  _handleStateChange (changes) {
    this.mempool.push(changes);
    // this.emit('changes', changes);
  }

  /**
   * Core messaging function for interacting with this object in system-time.
   * @param  {Message} msg Instance of a {@link module:Message} object, validated then transmitted verbatim.
   * @return {Boolean}     Returns `true` on success, `false` on failure.
   */
  broadcast (msg) {
    return this.emit('message', msg);
  }

  async define (name, definition) {
    let resource = Object.assign({
      name: name
    }, definition);

    this.resources[name] = new Resource(resource);
    this.emit('resource', this.resources[name]);

    return this.resources[name];
  }

  async start () {
    await super.start();

    // TODO: define all resources
    await Promise.all([
      this.define('Actor', {
        attributes: {
          name: { type: 'String', required: true, max: 220 }
        }
      }),
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
    // this.machine.on('changes', this._handleStateChange.bind(this));

    return this;
  }

  async _sync () {
    for (let name in this.machine.state) {
      let data = this.machine.state[name];
      let path = `/${name}`;
      await this._PUT(path, data);
    }
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
}

module.exports = Oracle;
