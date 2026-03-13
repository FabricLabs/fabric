'use strict';

const Machine = require('./machine');
const Resource = require('./resource');
const Store = require('./store');

class Oracle extends Store {
  constructor (init) {
    super(init);

    this.name = 'Oracle';
    this.config = Object.assign({
      path: './stores/oracle',
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

    Object.defineProperty(this, '@allocation', { enumerable: false });
    Object.defineProperty(this, '@buffer', { enumerable: false });
    Object.defineProperty(this, '@encoding', { enumerable: false });
    Object.defineProperty(this, '@parent', { enumerable: false });
    Object.defineProperty(this, '@preimage', { enumerable: false });
    Object.defineProperty(this, 'frame', { enumerable: false });
    Object.defineProperty(this, 'services', { enumerable: false });

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
    const resource = Object.assign({
      name: name
    }, definition);

    this.resources[name] = new Resource(resource);
    this.emit('resource', this.resources[name]);

    return this.resources[name];
  }

  async start () {
    try {
      await this.open();
    } catch (E) {
      console.error('Could not open Oracle:', E);
    }

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

  async stop () {
    try {
      await this.close();
    } catch (E) {
      console.error('Could not close Oracle:', E);
    }

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
