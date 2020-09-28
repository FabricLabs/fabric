'use strict';

const matrix = require('matrix-js-sdk');

const Entity = require('../types/entity');
const Interface = require('../types/interface');
// TODO: compare API against {@link Service}
const Service = require('../types/service');

const COORDINATORS = [
  '!pPjIUAOkwmgXeICrzT:fabric.pub'
];

/**
 * Service for interacting with Matrix.
 * @module services/matrix
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
      channels: COORDINATORS,
      messages: []
    };

    return this;
  }

  async _listPublicRooms () {
    let rooms = await this.client.publicRooms();
    return rooms;
  }

  async _registerActor (actor) {
    const password = 'f00b4r';
    const available = false;

    try {
      available = await this._checkUsernameAvailable(actor.pubkey);
    } catch (exception) {
      // this.emit('error', 'Username already registered.');
    }

    if (available) {
      await this.register(actor.pubkey, actor.privkeyhash || password);
      await this.login(actor.pubkey, actor.privkeyhash || password);
    } else {
      await this.login(actor.pubkey, actor.privkeyhash || password);
    }

    await this.client.joinRoom(this.settings.coordinator);
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
    const promise = new Promise((resolve, reject) => {
      this.emit('message', `Trying registration: ${username}:${password}`);

      result = this.client.registerRequest({
        username: username,
        password: password,
        auth: {
          type: 'm.login.dummy'
        }
      }).then((output) => {
        resolve(output);
      });
    });

    return result;
  }

  async _checkUsernameAvailable (username) {
    const self = this;
    return new Promise(async (resolve, reject) => {
      try {
        const available = await self.client.isUsernameAvailable(username);
        return resolve(available);
      } catch (exception) {
        return reject('Username not available.');
      }
    });
  }

  /**
   * Start the service, including the initiation of an outbound connection
   * to any peers designated in the service's configuration.
   */
  async start () {
    super.start();
    this.status = 'starting';
    // this.log('[SERVICES:MATRIX]', 'Starting...');
    this.status = 'started';
    // this.log('[SERVICES:MATRIX]', 'Started!');
  }

  /**
   * Stop the service.
   */
  async stop () {
    super.stop();
    this.status = 'stopping';
    // this.log('[SERVICES:MATRIX]', 'Stopping...');
    this.status = 'stopped';
    // this.log('[SERVICES:MATRIX]', 'Stopped!');
  }
}

module.exports = Matrix;
