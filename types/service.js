'use strict';

// internal dependencies
// const Disk = require('./disk');
const Key = require('./key');
const Entity = require('./entity');
const Store = require('./store');
const Scribe = require('./scribe');
const Collection = require('./collection');

// external dependencies
const crypto = require('crypto');
const stream = require('stream');
const path = require('path');

// npm-based modules
const pointer = require('json-pointer');
const manager = require('fast-json-patch');

/**
 * The "Service" is a simple model for processing messages in a distributed
 * system.  {@link Service} instances are public interfaces for outside systems,
 * and typically advertise their presence to the network.
 *
 * To implement a Service, you will typically need to implement all methods from
 * this prototype.  In general, `connect` and `send` are the highest-priority
 * jobs, and by default the `fabric` property will serve as an I/O stream using
 * familiar semantics.
 *
 * @property map The "map" is a hashtable of "key" => "value" pairs.
 */
class Service extends Scribe {
  /**
   * Create an instance of a Service.
   * @param       {Object} config Configuration for this service.
   */
  constructor (config) {
    // Initialize Scribe, our logging tool
    super(config);

    // Configure (with defaults)
    this.config = Object.assign({
      name: 'service',
      path: './stores/service',
      // TODO: export this as the default data in `inputs/fabric.json`
      // If the sha256(JSON.stringify(this.data)) is equal to this, it's
      // considered a valid Fabric object (for now!)
      '@data': {
        channels: {},
        messages: {},
        members: {}
      }
    }, config);

    // Reserve a place for ourselves
    this.agent = null;
    this.name = this.config.name;
    this.collections = {};
    this.definitions = {};
    this.origin = '';
    this.key = new Key();

    this.store = new Store({
      path: this.config.path
    });

    // set local state to whatever configuration supplies...
    this.state = Object.assign({
      messages: {} // always define a list of messages for Fabric services
    }, this.config['@data']);

    this.observer = null;

    // Set ready status
    this.status = 'ready';

    // Remove mutable variables
    Object.defineProperty(this, '@version', { enumerable: false });
    Object.defineProperty(this, '@input', { enumerable: false });
    Object.defineProperty(this, '@data', { enumerable: false });
    Object.defineProperty(this, '@meta', { enumerable: false });
    Object.defineProperty(this, '@encoding', { enumerable: false });
    Object.defineProperty(this, '@entity', { enumerable: false });
    Object.defineProperty(this, '@allocation', { enumerable: false });
    Object.defineProperty(this, '@buffer', { enumerable: false });

    // Remove sensitive objects
    Object.defineProperty(this, 'store', { enumerable: false });
    Object.defineProperty(this, 'observer', { enumerable: false });

    // Provide the instance
    return this;
  }

  get members () {
    return this['@data'].members;
  }

  static fromName (name) {
    let local = `services/${name}`;
    let deep = `/../node_modules/@fabric/core/${local}.js`;
    let fallback = path.dirname(require.main.filename) + deep;
    let plugin = null;

    try {
      plugin = require(local);
    } catch (E) {
      console.log('could not load main:', E);
      try {
        plugin = require(fallback);
      } catch (E) {
        console.log('Fallback service failed to load:', E);
      }
    }

    return plugin;
  }

  define (name, value) {
    this.definitions[name] = Object.assign({
      data: {},
      handler: function handler (msg) {
        return null;
      }
    }, value);

    return this;
  }

  ready () {
    this.emit('ready');
  }

  replay (list = []) {
    for (let i = 0; i < list.length; i++) {
      this.route(list[i]);
    }

    return this;
  }

  toString () {
    let entity = new Entity(this.state);
    return entity.toString();
  }

  /**
   * Default route handler for an incoming message.  Follows the Activity
   * Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/
   * @param  {Activity}  message Message object.
   * @return {Service}         Chainable method.
   */
  handler (message) {
    try {
      this.emit('message', {
        actor: message.actor,
        target: message.target,
        object: message.object
      });
    } catch (E) {
      this.error('Malformed message:', message);
    }
    return this;
  }

  /**
   * Resolve a {@link State} from a particular {@link Message} object.
   * @param  {Message}  msg Explicit Fabric {@link Message}.
   * @return {Promise}     Resolves with resulting {@link State}.
   */
  async route (msg) {
    console.log('[FABRIC:SERVICE]', 'routing message:', msg);
    console.log('[FABRIC:SERVICE]', 'definitions:', Object.keys(this.definitions));

    let result = null;

    if (this.definitions[msg.type]) {
      console.log('[FABRIC:SERVICE]', this.name, 'received a well-defined message type from message in requested route:', msg);

      let handler = this.definitions[msg.type].handler;
      let state = handler.apply(this.state, [msg]);

      console.log('sample:', state);
      console.log('sample.channels:', state.channels);
      console.log('sample.messages:', state.messages);

      result = state;

      let commit = await this.commit();
      console.log('commit:', commit);
    }

    return result;
  }

  async start () {
    await super.start();

    this.log('Starting...');
    this.status = 'starting';
    this.process = function Process (msg) {
      console.log('[FABRIC:SERVICE]', 'Unterminated message:', msg);
      console.log('### Heads Up!');
      console.log('Please see documentation before continuing further:');
      console.log('Legacy Web: https://dev.fabric.pub/docs/');
      console.log('Fabric: fabric:docs');
      console.log('Local Repository: `npm run docs` to open HTTP server at http://localhost:8000');
    };

    await this.define('message', {
      name: 'message',
      handler: this.process.bind(this.state),
      exclusive: true // override all previous types
    });

    try {
      await this.store.start();
    } catch (E) {
      console.log('[FABRIC:SERVICE]', 'Could not start store:', E);
    }

    await this.connect();

    // TODO: re-re-evaluate a better approach... oh how I long for Object.observe!
    // this.observer = manager.observe(this.state, this._handleStateChange.bind(this));
    if (!this.state) this.state = {};
    this.observer = manager.observe(this.state);

    this.status = 'started';
    this.commit();

    return this;
  }

  async stop () {
    await this.disconnect();
    await this.store.stop();
    await super.stop();
    return this;
  }

  /**
   * Retrieve a value from the Service's state.
   * @param  {String}  path Path of the value to retrieve.
   * @return {Promise}      Resolves with the result.
   */
  async _GET (path) {
    let result = null;

    if (path === '/') return this.state;

    try {
      result = pointer.get(this.state, path);
    } catch (E) {
      this.error(`Could not _GET() ${path}:`, E);
    }

    return result;
  }

  /**
   * Store a value in the Service's state.
   * @param  {String}  path  Path to store the value at.
   * @param  {Object}  value Document to store.
   * @param  {Boolean} [commit=false] Sign the resulting state.
   * @return {Promise}       Resolves with with stored document.
   */
  async _PUT (path, value, commit = true) {
    let result = null;

    if (path === '/') {
      this.state = value;
    } else {
      try {
        result = pointer.set(this.state, path, value);
      } catch (E) {
        this.error(`Could not _PUT() ${path}:`, E);
      }
    }

    if (commit) {
      await this.commit();
    }

    return result;
  }

  async _POST (path, data, commit = true) {
    console.log('[SERVICE]', '_POST', path, data);

    let result = null;
    let name = crypto.createHash('sha256').update(path).digest('hex');
    let hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

    // always use locally computed values
    data.address = hash;

    let object = new Entity(data);
    let collection = null;
    let memory = null;

    try {
      memory = await this._GET(path);
    } catch (E) {
      console.warn('[FABRIC:SERVICE]', 'posting to unloaded collection:', path);
    }

    if (!memory) memory = [];

    try {
      collection = new Collection(memory);
    } catch (E) {
      console.error('Could not create collection:', E, memory);
    }

    // TODO: use Resource definition to de-deuplicate by fields.id
    collection.push(object.toObject());

    this.collections[name] = await collection.populate();

    // TODO: reduce storage to references
    try {
      await this._PUT(path, await collection.populate());
      await this.set(path, await collection.populate());
      result = `${path}/${data.address}`;
    } catch (E) {
      console.log('NOPE:', E);
    }

    await this.commit();

    return result;
  }

  /**
   * Attach to network.
   * @param  {Boolean}  notify Commit to changes.
   * @return {Promise}        Resolves to {@link Fabric}.
   */
  async connect (notify = true) {
    // TODO: implement a basic Stream
    this.status = 'connecting';

    // stub for a transform stream
    this.fabric = new stream.Transform({
      transform (chunk, encoding, callback) {
        callback(null, chunk);
      }
    });

    try {
      let prior = await this.store.get('/');
      let state = JSON.parse(prior);
      this.state = state;
    } catch (E) {
      this.warn('[DOORMAN:SERVICE]', 'Could not restore state:', E);
    }

    this.connection = null;
    this.status = 'connected';

    if (notify) {
      await this.ready();
    }

    return this.fabric;
  }

  async disconnect () {
    if (this.status !== 'active') return this;
    this.status = 'disconnected';
    return this;
  }

  async subscribe (id) {
    this.log(`subscribing to ${id}...`);
    let subscription = new Entity();
    return subscription;
  }

  async join (id) {
    this.log('join() is not yet implemented for this service.');
  }

  async whisper (target, message) {
    this.log('The "whisper" function is not yet implemented.');
    return this;
  }

  /**
   * Send a message to a channel.
   * @param  {String} channel Channel name to which the message will be sent.
   * @param  {String} message Content of the message to send.
   * @return {Service}        Chainable method.
   */
  async send (channel, message, extra) {
    if (this.debug) this.log('[SERVICE]', 'send:', channel, message, extra);

    let path = Buffer.alloc(256);
    let payload = Buffer.alloc(2048);
    let checksum = Buffer.alloc(64);
    let entropy = Buffer.alloc(1726); // fill to 4096

    path.write(channel);
    payload.write(message);

    let msg = Buffer.concat([ path, payload ]);
    let hash = crypto.createHash('sha256').update(msg).digest('hex');

    checksum.write(hash);

    let block = Buffer.concat([
      Buffer.from([0x01]), // version byte
      Buffer.from([0x00]), // placeholder
      checksum,
      msg,
      entropy
    ]);

    this.fabric.write(block);

    return this;
  }

  async commit () {
    let self = this;
    let ops = [];
    let state = new Entity(self.state);

    // assemble all necessary info, emit Snapshot regardless of storage status
    try {
      ops.push({ type: 'put', key: 'snapshot', value: state.toJSON() });
      this.emit('message', {
        '@type': 'Snapshot',
        '@data': self.state
      });
    } catch (E) {
      console.error('Error saving state:', self.state);
      console.error('Could not commit to state:', E);
    }

    if (this.store) {
      // TODO: add robust + convenient database opener
      await this.store.batch(ops, function shareChanges () {
        // TODO: notify status?
      });
    }

    if (self.observer) {
      try {
        let patches = manager.generate(self.observer);
        if (patches.length) self.emit('patches', patches);
        if (patches.length) self.emit('message', {
          '@type': 'Commit',
          '@data': patches
        });
      } catch (E) {
        console.error('Could not generate patches:', E);
      }
    }

    return this;
  }

  async _attachBindings (emitter) {
    let service = this;

    emitter.on('attached', function () {
      service.emit('attached', {
        type: 'Notification',
        message: 'Bindings complete!'
      });
    });

    emitter.emit('attached');

    return service;
  }

  async _getActor (id) {
    if (!id) return this.error('Parameter "id" is required.');
    let path = pointer.escape(id);
    return this._GET(`/actors/${path}`);
  }

  async _getChannel (id) {
    if (!id) return this.error('Parameter "id" is required.');
    let target = pointer.escape(id);
    return this._GET(`/channels/${target}`);
  }

  /**
   * Register an {@link Actor} with the {@link Service}.
   * @param  {Object}  actor Instance of the {@link Actor}.
   * @return {Promise}       Resolves upon successful registration.
   */
  async _registerActor (actor) {
    if (!actor.id) return this.error('Client must have an id.');

    this.log('registering actor:', actor.id, JSON.stringify(actor).slice(0, 32) + '…');

    let id = pointer.escape(actor.id);
    let path = `/actors/${id}`;

    try {
      this._PUT(path, Object.assign({
        name: actor.id,
        subscriptions: []
      }, actor, { id }));
    } catch (E) {
      return this.error('Something went wrong saving:', E);
    }

    this.emit('actor', this._GET(path));

    return this;
  }

  async _registerChannel (channel) {
    if (!channel.id) return this.error('Channel must have an id.');

    let target = pointer.escape(channel.id);
    let path = `/channels/${target}`;

    try {
      this._PUT(path, Object.assign({
        members: []
      }, channel));
      this.emit('channel', this._GET(path));
    } catch (E) {
      this.log(`Failed to register channel "${channel.id}":`, E);
    }

    return this;
  }

  async _updatePresence (id, status) {
    let target = pointer.escape(id);
    let presence = (status === 'online') ? 'online' : 'offline';
    return this._PUT(`/actors/${target}/presence`, presence);
  }

  async _getPresence (id) {
    let member = this._GET(`/actors/${id}`) || {};
    return member.presence || null;
  }

  async _getMembers (id) {
    let channel = this._GET(`/channels/${id}`) || {};
    return channel.members || null;
  }

  async _getSubscriptions (id) {
    let member = this._GET(`/actors/${id}`) || {};
    return member.subscriptions || null;
  }

  async _applyChanges (changes) {
    // TODO: allow configurable validators
    return manager.applyPatch(this.state, changes, function isValid () {
      return true;
    }, true /* mutate doc (1st param) */);
  }

  async _handleStateChange (changes) {
    console.log('MAGIC HANDLER:', changes);
    this.emit('message', {
      '@type': 'Transaction',
      '@data': {
        // TODO: update this in constructor
        parent: this.origin,
        changes: changes
      }
    });
  }
}

module.exports = Service;
