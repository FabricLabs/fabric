'use strict';

// internal dependencies
const Scribe = require('./scribe');
const Store = require('./store');

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
      store: './data/service'
    }, config);

    // Start with an empty state
    this.agent = null;
    this.state = {};

    // Enable persistent storage
    this.store = new Store();

    // Monitor all state changes and set ready status
    this.observer = manager.observe(this.state);
    this.status = 'ready';
  }

  async start () {
    this.status = 'starting';
    this.log('Starting...');
    // await super.start();
    this.connection = await this.connect();

    return this;
  }

  /**
   * Attach to network.
   * @param  {Boolean}  notify Commit to changes.
   * @return {Promise}        Resolves to {@link Fabric}.
   */
  async connect (notify) {
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

    this.status = 'connected';

    if (notify) {
      await this.ready();
    }

    return this.fabric;
  }

  async join (id) {
    this.log('join() is not yet implemented for this service.');
  }

  async _updatePresence (id, status) {
    let target = pointer.escape(id);
    let presence = (status === 'online') ? 'online' : 'offline';
    return this._PUT(`/users/${target}/presence`, presence);
  }
}

Service.prototype.use = function use (fabric) {
  this.fabric = fabric;
};

Service.prototype.disconnect = function disconnection () {
  if (this.status !== 'active') return this;
  this.status = 'disconnected';
  return this;
};

Service.prototype.ready = function ready () {
  this.emit('ready');
};

Service.prototype._GET = function get (path) {
  let result = null;

  try {
    result = pointer.get(this.state, path);
  } catch (E) {
    this.error(`Could not _GET() ${path}:`, E);
  }

  return result;
};

Service.prototype._PUT = async function set (path, value) {
  let result = null;

  try {
    result = pointer.set(this.state, path, value);
  } catch (E) {
    this.error(`Could not _PUT() ${path}:`, E);
  }

  await this.commit();

  return result;
};

/**
 * Default route handler for an incoming message.  Follows the Activity Streams
 * 2.0 spec: https://www.w3.org/TR/activitystreams-core/
 * @param  {Object}  message Message object.
 * @return {Service}         Chainable method.
 */
Service.prototype.handler = function route (message) {
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
};

/**
 * Send a message to a channel.
 * @param  {String} channel Channel name to which the message will be sent.
 * @param  {String} message Content of the message to send.
 * @return {Service}        Chainable method.
 */
Service.prototype.send = async function send (channel, message, extra) {
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
};

Service.prototype.whisper = async function whisper (target, message) {
  this.log('The "whisper" function is not yet implemented.');
  return this;
};

Service.prototype._getUser = function getUser (id) {
  if (!id) return this.error('Parameter "id" is required.');
  let path = pointer.escape(id);
  return this._GET(`/users/${path}`);
};

Service.prototype._registerUser = function registerUser (user) {
  if (!user.id) return this.error('User must have an id.');

  this.log('registering user:', user.id, JSON.stringify(user).slice(0, 32) + '…');

  let id = pointer.escape(user.id);
  let path = `/users/${id}`;

  try {
    this._PUT(path, Object.assign({
      name: user.id,
      subscriptions: []
    }, user, { id }));
  } catch (E) {
    return this.error('Something went wrong saving:', E);
  }

  this.emit('user', this._GET(path));

  return this;
};

Service.prototype._registerChannel = function registerChannel (channel) {
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
};

Service.prototype._getChannel = function getChannel (id) {
  if (!id) return this.error('Parameter "id" is required.');
  let target = pointer.escape(id);
  return this._GET(`/channels/${target}`);
};

Service.prototype.commit = async function commit (id) {
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
};

Service.prototype.subscribe = async function subscribe (id) {
  this.log(`subscribing to ${id}...`);
};

Service.prototype._getSubscriptions = async function getSubscriptions (id) {
  let member = this._GET(`/users/${id}`) || {};
  return member.subscriptions || null;
};

Service.prototype._getMembers = async function getMembers (id) {
  let channel = this._GET(`/channels/${id}`) || {};
  this.log('_getMembers() channel:', channel);
  return channel.members || null;
};

Service.prototype._getPresence = async function getPresence (id) {
  let member = this._GET(`/users/${id}`) || {};
  return member.presence || null;
};

module.exports = Service;
