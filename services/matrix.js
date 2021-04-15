'use strict';

// Dependencies
const matrix = require('matrix-js-sdk');

// Fabric Types
const HKDF = require('../types/hkdf');
const Entity = require('../types/entity');
// TODO: compare API against {@link Service}
const Service = require('../types/service');
const Actor = require('../types/actor');
const Message = require('../types/message');

// Local Values
const COORDINATORS = [
  // TODO: supply at least 7 coordinators
  '!pPjIUAOkwmgXeICrzT:fabric.pub' // Primary Coordinator
];

/**
 * Service for interacting with Matrix.
 * @augments Service
 */
class Matrix extends Service {
  /**
   * Create an instance of a Matrix client, connect to the
   * network, and relay messages received from therein.
   * @param {Object} [settings] Configuration values.
   */
  constructor (settings = {}) {
    super(settings);

    // Assign defaults
    this.settings = Object.assign({
      name: '@fabric/matrix',
      path: './stores/matrix',
      homeserver: 'https://fabric.pub',
      coordinator: COORDINATORS[0],
      connect: false
    }, this.settings, settings);

    this.client = matrix.createClient(this.settings.homeserver);
    this._state = {
      status: 'READY',
      actors: {},
      channels: COORDINATORS,
      messages: {}
    };

    return this;
  }

  get status () {
    return this._state[`status`];
  }

  set status (value = this.status) {
    switch (value) {
      case 'READY':
        this._state[`status`] =  value;
        break;
      default:
        return false;
    }

    return true;
  }

  /**
   * Getter for {@link State}.
   */
  get state () {
    // TODO: remove old use of `@data` while internal to Fabric
    return this._state['@data'];
  }

  async _handleException (exception) {
    console.error('[SERVICES:MATRIX]', 'Exception:', exception);
  }

  async _setState (state) {
    const entity = new Entity(state);
    const content = {
      '@id': entity.id,
      '@data': state,
      'state_key': 'fabric.services.matrix'
    };

    const promise = new Promise((resolve, reject) => {
      this.client.sendEvent(this.settings.coordinator, 'm.room.state', content, '', (err, res) => {
        if (err) return reject(err);
        return resolve(res);
      });
    });

    return promise;
  }

  async _listPublicRooms () {
    let rooms = await this.client.publicRooms();
    return rooms;
  }

  /**
   * Register an Actor on the network.
   * @param {Object} actor Actor to register.
   * @param {Object} actor.pubkey Hex-encoded pubkey.
   */
  async _registerActor (object) {
    if (!object.pubkey) throw new Error('Field "pubkey" is required.');
    const actor = new Actor(object);
    this._state.actors[actor.id] = actor.toObject();

    if (this.settings.connect) {
      const hmac = new HKDF({
        initial: 'f00b4r',
        salt: actor.privkeyhash
      });

      let password = actor.password || hmac.derive().toString('hex');
      let available = false;
      let registration = null;

      try {
        this.emit('message', `Checking availability: ${actor.pubkey}`);
        available = await this._checkUsernameAvailable(actor.pubkey);
        this.emit('message', Message.fromVector(['OracleBoolean', available]));
      } catch (exception) {
        this.emit('error', `Could not check availability: ${exception}`);
      }

      if (available) {
        try {
          this.emit('message', `Trying registration: ${actor.pubkey}`);
          registration = await this.register(actor.pubkey, actor.privkeyhash || password);
          this.emit('message', `Registration: ${registration}`);
        } catch (exception) {
          this.emit('error', `Could not register with coordinator: ${exception}`);
        }
      }

      try {
        this.emit('message', `Trying login: ${actor.pubkey}`);
        await this.login(actor.pubkey, actor.privkeyhash || password);
      } catch (exception) {
        this.emit('error', `Could not authenticate with coordinator: ${exception}`);
      }

      try {
        this.emit('message', `Trying join room: ${this.settings.coordinator}`);
        await this.client.joinRoom(this.settings.coordinator);
      } catch (exception) {
        this.emit('error', `Could not join coordinator: ${exception}`);
      }

      let result = await this._setState({
        content: 'Hello, world!'
      });

      this.emit('message', {
        actor: actor.pubkey,
        object: result.event_id,
        target: '/messages'
      });
    }

    this.emit('message', `Actor Registered: ${actor.id} ${JSON.stringify(actor.data, null, '  ')}`);

    return actor.data;
  }

  async _send (msg) {
    const service = this;

    const content = {
      'body': (msg && msg.object) ? msg.object.content : msg.object,
      'msgtype': 'm.text'
    };

    try {
      this.client.sendEvent(this.settings.coordinator, 'm.room.message', content, '', (err, res) => {
        if (err) return service.emit('error', `Could not send message to service: ${err}`);
      });
    } catch (exception) {
      this.emit('error', `Could not send message: ${exception}`);
    }
  }

  async login (username, password) {
    return this.client.login('m.login.password', { user: username, password: password });
  }

  async register (username, password) {
    if (!username) throw new Error('Must provide username.');
    if (!password) throw new Error('Must provide password.');
    const self = this;
    const promise = new Promise((resolve, reject) => {
      self.emit('message', `Trying registration: ${username}:${password}`);
      self.client.registerRequest({
        username: username,
        password: password,
        auth: { type: 'm.login.dummy' }
      }).catch(reject).then(resolve);
    });

    return promise;
  }

  async _checkUsernameAvailable (username) {
    const self = this;
    const promise = new Promise(async (resolve, reject) => {
      self.emit('message', `Checking username: ${username}`);
      self.client.isUsernameAvailable(username).catch((exception) => {
        resolve(false);
      }).then((result) => {
        resolve(true);
      });
    });
    return promise;
  }

  async _handleMatrixMessage (msg) {
    if (msg.getType() !== 'm.room.message') {
      return; // only use messages
    }

    this.emit('message', {
      actor: msg.event.sender,
      object: {
        content: msg.event.content.body
      },
      target: '/messages'
    });
  }

  /**
   * Start the service, including the initiation of an outbound connection
   * to any peers designated in the service's configuration.
   */
  async start () {
    this.status = 'STARTING';
    this.emit('message', '[SERVICES:MATRIX] Starting...');
    const service = this;
    const user = {
      pubkey: (service.settings.username) ? service.settings.username : this.key.pubkey,
      password: service.settings.password
    };

    this.client.once('sync', function _handleClientSync (state, prevState, res) {
      if (state === 'PREPARED') {
        service.emit('message', Message.fromVector(['MatrixClientSync', {
          state: state
        }]));
      } else {
        service.emit('error', Message.fromVector(['GenericError', {
          message: `Unhandled sync event state: ${state}`
        }]));
      }
    });

    this.client.on('Room.timeline', function _handleRoomTimeline (event, room, toStartOfTimeline) {
      if (event.getType() !== 'm.room.message') return;
      const actor = new Actor({ name: event.event.sender });
      service.emit('message', {
        actor: actor.id,
        object: {
          type: 'MatrixEvent',
          data: event.event
        },
        target: '/messages'
      });
    });

    await this._registerActor(user);
    if (this.settings.connect) await this.client.startClient({ initialSyncLimit: 10 });

    this.status = 'STARTED';
    this.emit('message', '[SERVICES:MATRIX] Started!');
    // this.log('[SERVICES:MATRIX]', 'Started!');
  }

  /**
   * Stop the service.
   */
  async stop () {
    this.status = 'STOPPING';
    // this.log('[SERVICES:MATRIX]', 'Stopping...');
    this.status = 'STOPPED';
    // this.log('[SERVICES:MATRIX]', 'Stopped!');
  }
}

module.exports = Matrix;
