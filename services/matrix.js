'use strict';

// Dependencies
const matrix = require('matrix-js-sdk');

// Fabric Types
const Entity = require('../types/entity');
const Interface = require('../types/interface');
// TODO: compare API against {@link Service}
const Service = require('../types/service');

// Local Values
const COORDINATORS = [
  '!pPjIUAOkwmgXeICrzT:fabric.pub' // Primary Coordinator
];

/**
 * Service for interacting with Matrix.
 * @module @fabric/core/services/matrix
 * @augments Interface
 */
class Matrix extends Interface {
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
      homeserver: 'https://fabric.pub',
      coordinator: COORDINATORS[0]
    }, settings);

    this.client = matrix.createClient(this.settings.homeserver);
    this._state = {
      status: 'READY',
      actors: [],
      channels: COORDINATORS,
      messages: []
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

  async _listPublicRooms () {
    let rooms = await this.client.publicRooms();
    return rooms;
  }

  async _registerActor (actor) {
    let password = 'f00b4r';
    let available = false;
    let registration = null;

    try {
      this.emit('message', `Checking availability: ${actor.pubkey}`);
      available = await this._checkUsernameAvailable(actor.pubkey);
    } catch (exception) {
      this.emit('error', `Could not check availability: ${exception}`);
    }

    this.emit('message', `Username available: ${available}`);

    if (available) {
      try {
        this.emit('message', `Trying registration: ${actor.pubkey}`);
        registration = await this.register(actor.pubkey, actor.privkeyhash || password);
      } catch (exception) {
        this.emit('error', `Could not register with coordinator: ${exception}`);
      }
    }

    this.emit('message', `Registration: ${registration}`);

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

    const entity = new Entity({
      pubkey: actor.pubkey
    });

    this.emit('message', `Actor Registered: ${entity.id} ${JSON.stringify(entity.data, null, '  ')}`);

    return entity.data;
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
    const self = this;
    const promise = new Promise(async (resolve, reject) => {
      self.emit('message', `Trying registration: ${username}:${password}`);
      let result = null;

      result = await this.client.registerRequest({
        username: username,
        password: password,
        auth: {
          type: 'm.login.dummy'
        }
      });

      resolve(result);
    });

    return promise;
  }

  async _checkUsernameAvailable (username) {
    const self = this;
    const promise = new Promise(async (resolve, reject) => {
      self.emit('message', `Checking username: ${username}`);
      let available = true;

      try {
        available = await self.client.isUsernameAvailable(username);
        self.emit('message', `Checking username ${username} as available: ${available}`);
        return resolve(available);
      } catch (exception) {
        self.emit('error', `Username check "${username}" failed: ${exception}`);
        return resolve(false);
      }
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
    // this.log('[SERVICES:MATRIX]', 'Starting...');

    await this.client.startClient({ initialSyncLimit: 10 });
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
