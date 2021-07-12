'use strict';

// internal dependencies
const Actor = require('./actor');
// const Disk = require('./disk');
const Key = require('./key');
const Entity = require('./entity');
const Store = require('./store');
const KeyStore = require('./keystore');
const Scribe = require('./scribe');
const Stack = require('./stack');
// const Swarm = require('./swarm');
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
   * @param       {Boolean} [config.networking=true] Whether or not to connect to the network.
   * @param       {Object} [config.@data] Internal data to assign.
   */
  constructor (settings = {}) {
    // Initialize Scribe, our logging tool
    super(settings);

    // Configure (with defaults)
    this.settings = Object.assign({
      name: 'service',
      path: './stores/service',
      networking: true,
      persistent: true,
      interval: 60000, // Mandatory Checkpoint Interval
      verbosity: 2, // 0 none, 1 error, 2 warning, 3 notice, 4 debug
      // TODO: export this as the default data in `inputs/fabric.json`
      // If the sha256(JSON.stringify(this.data)) is equal to this, it's
      // considered a valid Fabric object (for now!)
      /* '@data': {
        channels: {},
        messages: {},
        members: {}
      } */
    }, this.settings, settings);

    // Reserve a place for ourselves
    this.agent = null;
    this.actor = null;
    this.name = this.settings.name;
    this.clock = 0;
    this.collections = {};
    this.definitions = {};
    this.methods = {};
    this.clients = {};
    this.targets = [];
    this.origin = '';

    // TODO: fix this
    //   2) RPG Lite
    //      Canvas
    //        can draw a canvas:
    //          Error: Not implemented yet
    this.key = new Key(this.settings.key);

    if (this.settings.persistent) {
      try {
        this.store = new KeyStore(this.settings);
      } catch (E) {
        console.error('Error:', E);
      }
    }

    // set local state to whatever configuration supplies...
    /* this.state = Object.assign({
      messages: {} // always define a list of messages for Fabric services
    }, this.config['@data']); */
    this._state = {};

    // Keeps track of changes
    this.observer = null;

    /* if (this.settings.networking) {
      this.swarm = new Swarm(this.settings);
    } */

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
    // Object.defineProperty(this, 'store', { enumerable: false });
    Object.defineProperty(this, 'observer', { enumerable: false });

    // Provide the instance
    return this;
  }

  init () {
    this.components = {};
  }

  /**
   * Move forward one clock cycle.
   * @returns {Number}
   */
  tick () {
    return ++this.clock;
  }

  async process () {
    console.log('process created');
  }

  get members () {
    return this['@data'].members;
  }

  get targets () {
    return this._targets;
  }

  set targets (value) {
    this._targets = value;
  }

  get state () {
    return this._state;
  }

  set state (value) {
    // console.trace('[FABRIC:SERVICE]', 'Setting state:', value);
    this._state = value;
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

  async broadcast (msg) {
    if (!msg['@type']) throw new Error('Message must have a @type property.');
    if (!msg['@data']) throw new Error('Message must have a @data property.');

    for (let name in this.clients) {
      let target = this.clients[name];
      console.log('[FABRIC:SERVICE]', 'Sending broadcast to client:', target);
    }

    this.emit('message', msg);
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

  /**
   * Start the service, including the initiation of an outbound connection
   * to any peers designated in the service's configuration.
   */
  async start () {
    const service = this;

    // Assign status and process
    this.status = 'starting';
    this.process = function Process (msg) {
      console.log('[FABRIC:SERVICE]', 'Unterminated message:', msg);
      console.log('### Heads Up!');
      console.log('Please see documentation before continuing further:');
      console.log('Legacy Web: https://dev.fabric.pub/docs/');
      console.log('Fabric: fabric:docs');
      console.log('Local Repository: `npm run docs` to open HTTP server at http://localhost:8000');
    };

    // Define an Actor with all current settings
    this.actor = new Actor(this.settings);

    /* await this.define('message', {
      name: 'message',
      handler: this.process.bind(this.state),
      exclusive: true // override all previous types
    }); */

    for (let name in this.settings.resources) {
      const resource = this.settings.resources[name];
      const attribute = resource.routes.list.split('/')[1];
      const key = crypto.createHash('sha256').update(resource.routes.list).digest('hex');

      // Assign collection
      this.collections[key] = new Collection(resource);

      // Add to targets
      this.targets.push(this.collections[key].routes.list);

      // Define mappings
      Object.defineProperty(this, attribute, {
        get: function () {
          return this.collections[key];
        }
      });

      // Attach events
      this.collections[key].on('commit', (commit) => {
        service.broadcast({
          '@type': 'StateUpdate',
          '@data': service.state
        });
      });

      this.collections[key].on('message', (message) => {
        console.log('[FABRIC:SERVICE]', 'Internal message:', key, message);
      });

      this.collections[key].on('transaction', (transaction) => {
        console.log('[FABRIC:SERVICE]', 'Internal transaction:', key, transaction);
      });

      this.collections[key].on('changes', (changes) => {
        service._applyChanges(changes);
        service.emit('change', {
          type: 'Change',
          data: changes
        });
      });
    }

    if (this.settings.persistent) {
      try {
        await this.store.start();
      } catch (E) {
        console.error('[FABRIC:SERVICE]', 'Could not start store:', E);
      }
    }

    if (this.settings.networking) {
      await this.connect();
    }

    // TODO: re-re-evaluate a better approach... oh how I long for Object.observe!
    // this.observer = manager.observe(this.state, this._handleStateChange.bind(this));
    if (!this.state) this.state = {};
    this.observer = manager.observe(this.state);

    // Set a heartbeat
    this.heartbeat = setInterval(this._heartbeat.bind(this), this.settings.interval);
    this.status = 'ready';
    this.emit('message', `[FABRIC:SERVICE] Started!`);
    this.emit('ready');

    try {
      await this.commit();
    } catch (E) {
      console.error('Could not commit:', E);
    }

    return this;
  }

  async stop () {
    if (this.settings.networking) {
      await this.disconnect();
    }

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }

    if (this.settings.persistent) {
      try {
        await this.store.stop();
      } catch (E) {
        console.error('[FABRIC:SERVICE]', 'Exception stopping store:', E);
      }
    }

    return this;
  }

  /**
   * Retrieve a value from the Service's state.
   * @param  {String}  path Path of the value to retrieve.
   * @return {Promise}      Resolves with the result.
   */
  async _GET (path) {
    let result = null;
    if (typeof path !== 'string') return null;

    let parts = path.split('/');
    let list = `/${parts[1]}`;
    let name = crypto.createHash('sha256').update(list).digest('hex');

    if (path === '/') return this.state;
    if (this.collections[name]) {
      if (parts[2]) {
        let inner = this.collections[name].filter((x) => {
          return (x.address === parts[2]);
        })[0];
        return inner;
      }
    }

    try {
      result = pointer.get(this.state, path);
    } catch (E) {
      console.error(`Could not _GET() ${path}:`, E);
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
      memory = await pointer.get(this.state, path);
    } catch (E) {
      console.warn('[FABRIC:SERVICE]', 'posting to unloaded collection:', path);
      memory = [];
    }

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

    if (this.settings.networking && this.swarm) {
      await this.swarm.start();
    }

    this.connection = null;
    this.status = 'connected';

    if (notify) {
      await this.ready();
    }

    return this.fabric;
  }

  async disconnect () {
    this.status = 'disconnecting';
    // if (this.status !== 'active') return this;
    if (this.settings.networking && this.swarm) await this.swarm.stop();
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
    if (this.debug) console.log('[SERVICE]', 'send()', 'Sending:', channel, message, extra);

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

    if (self.settings.verbosity >= 4) console.log('[FABRIC:SERVICE]', 'Committing...');

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
      try {
        await this.store.batch(ops, function shareChanges () {
          // TODO: notify status?
        });
      } catch (E) {
        console.error('[FABRIC:SERVICE]', 'Threw Exception:', E);
      }
    }

    if (self.observer) {
      try {
        let patches = manager.generate(self.observer);
        if (patches.length) self.emit('patches', patches);
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

  async _bindStore (store) {
    this.store = store;
    return this;
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

    this.emit('message', `Registering Actor: ${actor.id} ${JSON.stringify(actor).slice(0, 32)}…`);

    let id = pointer.escape(actor.id);
    let path = `/actors/${id}`;

    try {
      await this._PUT(path, Object.assign({
        name: actor.id,
        subscriptions: []
      }, actor, { id }));
    } catch (E) {
      return this.error('Something went wrong saving:', E);
    }

    await this.commit();
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

  async _registerMethod (name, method) {
    this.methods[name] = method.bind(this);
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
    let result = null;

    try {
      // TODO: allow configurable validators
      result = manager.applyPatch(this.state, changes, function isValid () {
        return true;
      }, true /* mutate doc (1st param) */);
    } catch (exception) {
      console.error('Could not apply changes:', changes, exception);
    }

    await this.commit();

    return result;
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

  async _heartbeat () {
    return this.tick();
  }

  /**
   * Sends a message.
   * @param {Mixed} message Message to send.
   */
  async _send (message) {
    const entity = new Entity(message);
    await this._PUT(`/messages/${entity.id}`, message);
    return entity.id;
  }
}

module.exports = Service;
