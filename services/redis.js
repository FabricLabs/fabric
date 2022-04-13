'use strict';

const redis = require('redis');
const Service = require('../types/service');
const Message = require('../types/message');

/**
 * Connect and subscribe to ZeroMQ servers.
 */
class Redis extends Service {
  /**
   * Creates an instance of a ZeroMQ subscriber.
   * @param {Object} [settings] Settings for the Redis connection.
   * @param {String} [settings.host] Host for the Redis server.
   * @param {Number} [settings.port] Remote ZeroMQ service port.
   * @returns {Redis} Instance of the Redis service, ready to run `start()`
   */
  constructor (settings = {}) {
    super(settings);

    // Assign settings over the defaults
    // NOTE: switch to lodash.merge if clobbering defaults
    this.settings = Object.assign({
      host: 'localhost',
      port: 6379,
      subscriptions: []
    }, settings);

    this.socket = null;
    this._state = { status: 'STOPPED' };

    return this;
  }

  /**
   * Opens the connection and subscribes to the requested channels.
   * @returns {Redis} Instance of the service.
   */
  async start () {
    const self = this;

    this.socket = redis.createClient(this.settings);
    this.socket.on('error', function _handleSocketError (error) {
      self.emit('error', `Redis socket error: ${error}`);
    });

    this.socket.on('message', function _handleSocketMessage (topic, message) {
      const path = `channels/${topic.toString()}`;
      self.emit('debug', `Redis message @ [${path}] (${message.length} bytes) ⇒ ${message.toString('hex')}`);
      self.emit('message', Message.fromVector(['Generic', {
        topic: topic.toString(),
        message: message.toString('hex'),
        encoding: 'hex'
      }]).toObject());
    });

    for (let i = 0; i < this.settings.subscriptions.length; i++) {
      this.subscribe(this.settings.subscriptions[i]);
    }

    this.status = 'STARTED';
    this.emit('ready', {
      id: this.id
    });

    return this;
  }

  /**
   * Closes the connection to the Redis server.
   * @returns {Redis} Instance of the service.
   */
  async stop () {
    this.status = 'STOPPING';
    this.socket.close();
    this.status = 'STOPPED';
    return this;
  }

  subscribe (name) {
    this.socket.subscribe(name);
  }
}

module.exports = Redis;
