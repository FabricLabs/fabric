'use strict';

// internal dependencies
// const Disk = require('./disk');
const State = require('./state');
const Store = require('./store');
const Scribe = require('./scribe');

// external dependencies
const crypto = require('crypto');
const stream = require('stream');

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
      path: './data/service',
      '@data': {
        channels: {},
        clients: {},
        messages: {}
      }
    }, config);

    // Reserve a place for ourselves
    this.agent = null;
    this.name = this.config.name;

    // Enable persistent storage
    this.store = new Store({
      path: this.config.path
    });

    // set local state to whatever configuration supplies...
    this.state['@data'] = this.config['@data'];

    // Monitor all state changes and set ready status
    this.observer = manager.observe(this.state['@data']);

    // Set ready status
    this.status = 'ready';

    // Provide the instance
    return this;
  }

  static fromName (name) {
    let disk = new Disk();
    let path = `services/${name}`;
    let fallback = `node_modules/@fabric/core/${path}.js`;
    let plugin = null;

    // load from local `services` path, else fall back to Fabric
    if (disk.exists(path + '.js') || disk.exists(path)) {
      plugin = disk.get(path);
    } else if (disk.exists(fallback)) {
      plugin = disk.get(fallback);
    }

    return plugin;
  }

  ready () {
    this.emit('ready');
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

  async start () {
    await super.start();

    this.log('Starting...');
    this.status = 'starting';

    await this.store.open();
    await this.connect();

    return this;
  }

  async stop () {
    await this.disconnect();
    await this.store.close();
    await super.stop();
    return this;
  }

  async _GET (path) {
    let result = null;

    try {
      result = pointer.get(this.state, path);
    } catch (E) {
      this.error(`Could not _GET() ${path}:`, E);
    }

    return result;
  }

  async _PUT (path, value) {
    let result = null;

    try {
      result = pointer.set(this.state, path, value);
    } catch (E) {
      this.error(`Could not _PUT() ${path}:`, E);
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
    let subscription = new State();
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

    try {
      ops.push({ type: 'put', key: '/', value: JSON.stringify(self.state) });
    } catch (E) {
      this.error('Error saving state:', self.state);
      this.error('Could not commit to state:', E);
    }

    return this.store.batch(ops, function shareChanges () {
      let patches = manager.generate(self.observer);
      if (patches.length) self.emit('patches', patches);
    });
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
}

module.exports = Service;
