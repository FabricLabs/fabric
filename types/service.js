'use strict';

const PATCHES_ENABLED = true;
const OP_TRACE = require('../contracts/trace');

// Dependencies
const crypto = require('crypto');
const stream = require('stream');
const path = require('path');
const EventEmitter = require('events').EventEmitter;

// Public modules
// TODO: remove
const merge = require('lodash.merge');
const pointer = require('json-pointer');
const manager = require('fast-json-patch');

// Fabric Types
const Actor = require('./actor');
const Collection = require('./collection');
const Resource = require('./resource');
const Entity = require('./entity');
const Hash256 = require('./hash256');
const Key = require('./key');
const Message = require('./message');
const Store = require('./store');

/**
 * The "Service" is a simple model for processing messages in a distributed
 * system.  {@link Service} instances are public interfaces for outside systems,
 * and typically advertise their presence to the network.
 *
 * To implement a Service, you will typically need to implement all methods from
 * this prototype.  In general, `connect` and `send` are the highest-priority
 * jobs, and by default the `fabric` property will serve as an I/O stream using
 * familiar semantics.
 * @access protected
 * @property map The "map" is a hashtable of "key" => "value" pairs.
 */
class Service extends Actor {
  /**
   * Create an instance of a Service.
   * @param       {Object} settings Configuration for this service.
   * @param       {Boolean} [settings.networking=true] Whether or not to connect to the network.
   * @param       {Object} [settings.@data] Internal data to assign.
   */
  constructor (settings = {}) {
    // Initialize Scribe, our logging tool
    super(settings);

    // Configure (with defaults)
    this.settings = merge({
      name: 'Service',
      path: './stores/service',
      networking: true,
      persistent: false,
      constraints: {
        tolerance: 100,
        memory: {
          max: 67108864
        }
      },
      state: {
        ...super.state,
        actors: {}, // TODO: schema
        channels: {}, // TODO: schema
        messages: {}, // TODO: schema
        services: {}
      },
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

    this.collections = {};
    this.definitions = {};
    this.resources = {};
    this.services = {};
    this.methods = {};
    this.clients = {};
    this.targets = [];
    this.history = [];
    this.origin = '';

    // TODO: fix this
    //   2) RPG Lite
    //      Canvas
    //        can draw a canvas:
    //          Error: Not implemented yet
    this.key = new Key(this.settings.key);

    if (this.settings.persistent) {
      try {
        this.store = new Store(this.settings);
      } catch (E) {
        console.error('Error:', E);
      }
    }

    // set local state to whatever configuration supplies...
    /* this.state = Object.assign({
      messages: {} // always define a list of messages for Fabric services
    }, this.config['@data']); */
    this._state = {
      clock: 0,
      epochs: {}, // snapshots of history (by ID)
      history: [], // list of ...
      services: {}, // stores sub-service state
      status: 'PAUSED',
      content: this.settings.state,
      version: 0 // TODO: change to 1 for 0.1.0
    };

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

  get clock () {
    return parseInt(this._state.clock);
  }

  get heartbeat () {
    return this._heart;
  }

  get status () {
    return this._state.status;
  }

  get members () {
    return this['@data'].members;
  }

  get targets () {
    return this._targets;
  }

  get state () {
    return Object.assign({}, this._state.content);
  }

  set clock (value) {
    this._state.clock = parseInt(value);
  }

  set state (value) {
    // console.trace('[FABRIC:SERVICE]', 'Setting state:', value);
    this._state = value;
  }

  set status (value) {
    if (!value) return this.status;
    if (!this._state.status) this._state.status = 'PAUSED';
    this._state.status = value.toUpperCase();
    return this.status;
  }

  set targets (value) {
    this._targets = value;
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

  alert (msg) {
    // TODO: promise
    // return Promise.all(Object.entries(this.services).filter().map())
    for (const [name, service] of Object.entries(this.services)) {
      if (!this.settings.services.includes(name)) continue;
      if (!service.alert) {
        console.error('Service', name, 'does not have an alert function?');
        continue;
      }

      service.alert(msg);
    }
  }

  identify () {
    this.emit('auth', this.key.pubkey);
    return this.key.pubkey;
  }

  /**
   * Called by Web Components.
   * TODO: move to @fabric/http/types/spa
   */
  init () {
    this.components = {};
  }

  /**
   * Move forward one clock cycle.
   * @returns {Number}
   */
  tick () {
    return this.beat();
  }

  beat () {
    const now = (new Date()).toISOString();

    // Increment clock
    ++this._clock;

    // TODO: remove async, use local state instead
    // i.e., queue worker job
    const beat = Message.fromVector(['Generic', {
      clock: this._clock,
      created: now,
      state: this._state.content
    }]);

    if (!beat) {
      this.emit('error', 'Beat could not construct a Message!');
      console.trace();
      process.exit();
    }

    // TODO: parse JSON types in @fabric/core/types/message
    let data = beat.data;

    try {
      const parsed = JSON.parse(data);
      data = JSON.stringify(parsed, null, '  ');
    } catch (exception) {
      this.emit('error', `Exception parsing beat: ${exception}`);
    }

    this.emit('beat', beat);
    this.commit();

    return this;
  }

  append (block) {
    if (this.best !== block.parent) throw new Error(`Block does not attach to current chain.  Block ID: ${block.id} Block Parent: ${block.parent} Current Best: ${this.best}`);
  }

  /**
   * Retrieve a key from the {@link State}.
   * @param {Path} path Key to retrieve.
   * @returns {Mixed}
   */
  get (path = '') {
    let result = null;
    try {
      result = pointer.get(this._state.content, path);
    } catch (exception) {
      console.error('[FABRIC:STATE]', 'Could not retrieve path:', path, pointer.get(this['@entity']['@data'], '/'), exception);
    }
    return result;
  }

  /**
   * Set a key in the {@link State} to a particular value.
   * @param {Path} path Key to retrieve.
   * @returns {Mixed}
   */
  set (path, value) {
    const result = pointer.set(this._state.content, path, value);
    this.commit();
    return result;
  }

  /**
   * Explicitly trust all events from a known source.
   * @param  {EventEmitter} source Emitter of events.
   * @return {Service} Instance of Service after binding events.
   */
  trust (source, name = source.constructor.name) {
    if (!(source instanceof EventEmitter)) throw new Error('Source is not an EventEmitter.')

    // Constants
    const self = this;

    // Attach Event Listeners
    if (source.settings && source.settings.debug) source.on('debug', this._handleTrustedDebug.bind(this));
    if (source.settings && source.settings.verbosity >= 0) {
      source.on('audit', async function _handleTrustedAudit (audit) {
        /*
        const now = (new Date()).toISOString();
        const template = {
          content: audit,
          created: now,
          type: 'Audit'
        };

        const actor = new Actor(template);
        // TODO: transaction log
        */
      });
    }

    return {
      _handleActor: source.on('actor', async function (actor) {
        self.emit('debug', `[FABRIC:SERVICE] Source "${name}" emitted actor: ${JSON.stringify(actor, null, '  ')}`);
      }),
      _handleAlert: source.on('alert', async function (alert) {
        self.alert(`[FABRIC:SERVICE] [ALERT] [!!!] ${name} alerted: ${alert}`);
      }),
      _handleBeat: source.on('beat', async function (beat) {
        self.emit('debug', `[FABRIC:SERVICE] Source "${name}" emitted beat: ${JSON.stringify(beat, null, '  ')}`);

        const ops = [
          { op: 'add', path: `/actors`, value: {} },
          { op: 'add', path: `/services`, value: {} },
          { op: 'replace', path: `/services/${name}`, value: beat.state }
        ];

        try {
          manager.applyPatch(self._state.content, ops);
          await self.commit();
        } catch (exception) {
          self.emit('warning', `Could not process beat: ${exception}`);
        }
      }),
      _handleChanges: source.on('changes', async function (changes) {
        self.emit('debug', `[FABRIC:SERVICE] Source "${name}" emitted changes: ${changes}`);
      }),
      _handleChannel: source.on('channel', async function (channel) {
        self.emit('debug', `[FABRIC:SERVICE] Source "${name}" emitted channel: ${JSON.stringify(channel, null, '  ')}`);
      }),
      _handleCommit: source.on('commit', async function (commit) {
        self.emit('log', `[FABRIC:SERVICE] Source "${name}" committed: ${JSON.stringify(commit, null, '  ')}`);
      }),
      _handleError: source.on('error', async function _handleTrustedError (error) {
        self.emit('debug', `[FABRIC:SERVICE] Source "${name}" emitted error: ${error}`);
      }),
      _handleLog: source.on('log', async function _handleTrustedLog (log) {
        self.emit('log', `[FABRIC:SERVICE] Source "${name}" emitted log: ${log}`);
      }),
      _handleMessage: source.on('message', async function (message) {
        self.emit('debug', `[FABRIC:SERVICE] Source "${name}" emitted message: ${JSON.stringify(message.toObject ? message.toObject() : message, null, '  ')}`);
        await self._handleTrustedMessage(message);
      }),
      _handlePatches: source.on('patches', async function (patches) {
        self.emit('debug', `[FABRIC:SERVICE] [${name}] Service State: ${JSON.stringify(source.state, null, '  ')}`);
        self.emit('debug', `[FABRIC:SERVICE] [${name}] Patches: ${JSON.stringify(patches)}`);
        self.emit('patches', patches);
      }),
      _handleReady: source.on('ready', async function _handleTrustedReady (info) {
        self.emit('log', `[FABRIC:SERVICE] Source "${name}" emitted ready: ${JSON.stringify(info)}`);
      }),
      _handleTip: source.on('tip', async function (hash) {
        self.alert(`[FABRIC:SERVICE] New ${name} chaintip: ${hash}`);
      }),
      _handleWarning: source.on('warning', async function _handleTrustedWarning (warning) {
        self.emit('warning', `[FABRIC:SERVICE] Source "${name}" emitted warning: ${warning}`);
      })
    };
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
   * Attempt to acquire a lock for `duration` seconds.
   * @param {Number} [duration=1000] Number of milliseconds to hold lock.
   * @returns {Boolean} true if locked, false if unable to lock.
   */
  lock (duration = 1000) {
    if (this._state.status === 'LOCKED') return false;
    this._state.status = 'LOCKED';
    this.locker = new Actor({
      created: (new Date()).toISOString(),
      contract: (setTimeout(() => {
        delete this.locker;
        this._state.status = 'UNLOCKED';
      }, duration))
    });

    return true;
  }

  _defineResource (name, definition) {
    const resource = Object.assign({ name }, definition);
    this.resources[name] = new Resource(resource);
    this.emit('resource', this.resources[name]);
  }

  _handleTrustedDebug (message) {
    this.emit('debug', `[FABRIC:SERVICE] Trusted Source emitted debug: ${message}`);
  }

  _handleTrustedMessage (message) {
    this.emit('message', message);
  }

  async process () {
    console.log('process created');
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
    this.emit('debug', `[FABRIC:SERVICE] Starting as ${this.id}...`);

    const service = this;

    // Assign status and process
    this.status = 'starting';

    // Define an Actor with all current settings
    this.actor = new Actor(this.settings);

    /* await this.define('message', {
      name: 'message',
      handler: this.process.bind(this.state),
      exclusive: true // override all previous types
    }); */

    for (const name in this.settings.resources) {
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

    await this._startAllServices();

    if (this.settings.networking) {
      await this.connect();
    }

    // TODO: re-re-evaluate a better approach... oh how I long for Object.observe!
    // this.observer = manager.observe(this.state, this._handleStateChange.bind(this));
    try {
      this.observer = manager.observe(this._state.content);
    } catch (exception) {
      console.warn('Could not observe state:', this._state.content, exception);
    }

    // Set a heartbeat
    await this._startHeart();

    this.status = 'ready';
    this.emit('log', '[FABRIC:SERVICE] Started!');
    this.ready();

    return this;
  }

  async stop () {
    if (this.settings.networking) {
      await this.disconnect();
    }

    if (this._heart) {
      clearInterval(this._heart);
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
    } catch (exception) {
      this.emit('debug', `Could not _GET() ${path}:\n${exception}\n\tState: ${JSON.stringify(this.state, null, '  ')}`);
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
    if (!path) throw new Error('Path must be provided.');
    if (!data) throw new Error('Data must be provided.');

    const name = crypto.createHash('sha256').update(path).digest('hex');
    const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

    let result = null;

    // always use locally computed values
    data.address = hash;

    let object = new Entity(data);
    let collection = null;
    let memory = null;

    try {
      memory = await pointer.get(this.state, path);
    } catch (E) {
      this.emit('warning', `[FABRIC:SERVICE] posting to unloaded collection: ${path}`);
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

    if (commit) await this.commit();

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

    if (this.store) {
      try {
        const prior = await this.store.get('/');
        this.state = JSON.parse(prior);
      } catch (exception) {
        this.emit('warning', `[FABRIC:SERVICE] Could not restore state: ${exception}`);
      }
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

  async subscribe (actorID, channelID) {
    if (!actorID) throw new Error('Must provide actor ID.');
    if (!channelID) throw new Error('Must provide channel ID.');

    const label = Hash256.digest(actorID + channelID);
    const actor = await this._getActor(actorID);
    const channel = await this._getChannel(channelID);

    if (!actor) throw new Error(`Actor does not exist: ${actorID}`);
    if (!channel) throw new Error(`Channel does not exist: ${channelID}`);

    const link = await this._POST('/subscriptions', { label });

    await this._applyChanges([
      { op: 'add', value: channelID, path: `/actors/${actor.id}/subscriptions/0` },
      { op: 'add', value: channelID, path: `/channels/${channel.id}/members/0` }
    ]);

    await this.commit();

    const result = await this._GET(link);
    this.emit('subscription', result);

    return result;
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

    const path = Buffer.alloc(256);
    const payload = Buffer.alloc(2048);
    const checksum = Buffer.alloc(64);
    const entropy = Buffer.alloc(1726); // fill to 4096

    path.write(channel);
    payload.write(message);

    const msg = Buffer.concat([ path, payload ]);
    const hash = crypto.createHash('sha256').update(msg).digest('hex');

    checksum.write(hash);

    const block = Buffer.concat([
      Buffer.from([0x01]), // version byte
      Buffer.from([0x00]), // placeholder
      checksum,
      msg,
      entropy
    ]);

    this.fabric.write(block);

    return this;
  }

  commit () {
    this.emit('debug', `[FABRIC:SERVICE] Committing ${OP_TRACE()}`);

    const self = this;
    const ops = [];

    // assemble all necessary info, emit Snapshot regardless of storage status
    try {
      ops.push({ type: 'put', key: 'snapshot', value: self.state });

      this.emit('debug', `Commit Template: ${JSON.stringify({
        '@data': self.state,
        '@from': 'COMMIT',
        '@type': 'Snapshot'
      }, null, '  ')}`);
    } catch (E) {
      console.error('Error saving state:', self.state);
      console.error('Could not commit to state:', E);
    }

    if (this.settings.persistent) {
      // TODO: add robust + convenient database opener
      this.store.batch(ops, function shareChanges () {
        // TODO: notify status?
      }).catch((exception) => {
        self.emit('error', `Could not write to store: ${exception}`);
      }).then((output) => {
        self.emit('commit', { output });
      });
    }

    if (PATCHES_ENABLED && self.observer) {
      try {
        const patches = manager.generate(self.observer);
        if (patches.length) {
          this.history.push(patches);
          self.emit('patches', patches);
        }
      } catch (E) {
        console.error('Could not generate patches:', E);
      }
    }

    const commit = new Actor({
      type: 'Commit',
      state: self.state
    });

    this.emit('commit', { ...commit.toObject(), id: commit.id });

    return commit.id;
  }

  async _handleBitcoinCommit (commit) {
    console.log('[FABRIC:SERVICE] Handling (Bitcoin?) commit:', commit);
  }

  async _attachBindings (emitter) {
    const service = this;

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
  async _registerActor (actor = {}) {
    if (!actor.id) {
      const entity = new Actor(actor);
      actor = { ...entity.toObject(), id: entity.id };
    }

    const id = pointer.escape(actor.id);
    const path = `/actors/${id}`;

    try {
      await this._PUT(path, merge({
        name: actor.id,
        subscriptions: []
      }, actor, { id }));
    } catch (E) {
      return this.error('Something went wrong saving:', E);
    }

    await this.commit();

    const registration = await this._GET(path);
    this.emit('actor', registration);

    return registration;
  }

  async _registerChannel (channel) {
    if (!channel.id) {
      const entity = new Actor(channel);
      channel = merge({
        id: entity.id,
        members: []
      }, channel);
    }

    const target = pointer.escape(channel.id);
    const path = `/channels/${target}`;

    try {
      this._PUT(path, merge({
        members: []
      }, channel));
    } catch (E) {
      this.log(`Failed to register channel "${channel.id}":`, E);
    }

    await this.commit();

    const registration = await this._GET(path);
    this.emit('channel', registration);

    return registration;
  }

  async _addMemberToChannel (memberID, channelID) {
    return this.subscribe(memberID, channelID);
  }

  async _registerMethod (name, method) {
    this.methods[name] = method.bind(this);
  }

  async _updatePresence (id, status) {
    const target = pointer.escape(id);
    const presence = (status === 'online') ? 'online' : 'offline';
    return this._PUT(`/actors/${target}/presence`, presence);
  }

  async _getPresence (id) {
    const member = await this._GET(`/actors/${id}`);
    return member.presence || null;
  }

  async _getMembers (id) {
    const channel = await this._GET(`/channels/${id}`);
    if (!channel) throw new Error(`No such channel: ${id}`);
    return channel.members || null;
  }

  async _getSubscriptions (id) {
    const member = await this._GET(`/actors/${id}`);
    return member.subscriptions || null;
  }

  async _listActors () {
    return Object.values(await this._GET('/actors'));
  }

  async _listChannels () {
    return Object.values(await this._GET('/channels'));
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

  async _registerService (name, Service) {
    const self = this;
    const settings = merge({}, this.settings, this.settings[name]);
    const service = new Service(settings);

    if (this.services[name]) {
      return this._appendWarning(`Service already registered: ${name}`);
    }

    this.services[name] = service;
    this.services[name].on('error', function (msg) {
      self.emit('error', `Service "${name}" emitted error: ${JSON.stringify(msg, null, '  ')}`);
    });

    this.services[name].on('warning', function (msg) {
      self.emit('warning', `Service warning from ${name}: ${JSON.stringify(msg, null, '  ')}`);
    });

    this.services[name].on('message', function (msg) {
      self.emit('message', `Service message from ${name}: ${JSON.stringify(msg, null, '  ')}`);
    });

    this.on('identity', async function _registerActor (identity) {
      if (self.settings.services && self.settings.services.includes(name)) {
        self.emit('log', `Registering actor on service "${name}": ${JSON.stringify(identity)}`);

        try {
          let registration = await self.services[name]._registerActor(identity);
          self.emit('log', `Registered Actor: ${JSON.stringify(registration, null, '  ')}`);
        } catch (exception) {
          self.emit('error', `Error from service "${name}" during _registerActor: ${exception}`);
        }
      }
    });

    if (service.routes && service.routes.length) {
      for (let i = 0; i < service.routes.length; i++) {
        const route = service.routes[i];
        this.http._addRoute(route.method, route.path, route.handler);
      }
    }

    await this.commit();

    return this;
  }

  async _startAllServices () {
    if (!this.services) return this.emit('warning', 'Tried to start subservices, but none existed.');
    // Start all Services
    for (const [name, service] of Object.entries(this.services)) {
      // TODO: re-evaluate inclusion on Service itself
      if (this.settings.services && this.settings.services.includes(name)) {
        this.emit('debug', `Starting service "${name}" (with trust)`);
        // TODO: evaluate @fabric/core/types/store
        // TODO: isomorphic @fabric/core/types/store
        // await this.services[name]._bindStore(this.store);
        this.trust(this.services[name], name);

        try {
          await this.services[name].start();
        } catch (exception) {
          this.emit('warning', `Could not start the "${name}" service due to exception: ${JSON.stringify(exception, null, '  ')}`);
        }
      }
    }

    return this;
  }

  async _startHeart () {
    this._heart = setInterval(this.beat.bind(this), this.settings.interval);
  }
}

module.exports = Service;
