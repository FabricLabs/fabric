'use strict';

const redis = require('redis');
const Service = require('../types/service');
const Message = require('../types/message');

/**
 * Connect and subscribe to Redis servers (node-redis v6).
 */
class Redis extends Service {
  /**
   * Creates an instance of a Redis subscriber.
   * @param {Object} [settings] Settings for the Redis connection.
   * @param {String} [settings.host] Host for the Redis server.
   * @param {Number} [settings.port] Remote Redis service port.
   * @param {String} [settings.url] Optional redis URL (overrides host/port).
   * @returns {Redis} Instance of the Redis service, ready to run `start()`
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      host: 'localhost',
      port: 6379,
      subscriptions: []
    }, settings);

    this.socket = null;
    this._state = { status: 'STOPPED' };

    return this;
  }

  _clientOptions () {
    if (this.settings.url) {
      return { url: this.settings.url };
    }
    return {
      socket: {
        host: this.settings.host,
        port: this.settings.port
      }
    };
  }

  _emitChannelMessage (channel, message) {
    const topic = channel != null ? String(channel) : '';
    const raw = Buffer.isBuffer(message)
      ? message
      : Buffer.from(message == null ? '' : String(message));
    const path = `channels/${topic}`;
    this.emit('debug', `Redis message @ [${path}] (${raw.length} bytes) ⇒ ${raw.toString('hex')}`);
    this.emit('message', Message.fromVector(['Generic', {
      topic,
      message: raw.toString('hex'),
      encoding: 'hex'
    }]).toObject());
  }

  /**
   * Opens the connection and subscribes to the requested channels.
   * @returns {Promise<Redis>}
   */
  async start () {
    const self = this;

    this.socket = redis.createClient(this._clientOptions());
    this.socket.on('error', function _handleSocketError (error) {
      self.emit('error', `Redis socket error: ${error}`);
    });

    await this.socket.connect();

    for (let i = 0; i < this.settings.subscriptions.length; i++) {
      await this.subscribe(this.settings.subscriptions[i]);
    }

    this.status = 'STARTED';
    this.emit('ready', {
      id: this.id
    });

    return this;
  }

  /**
   * Closes the connection to the Redis server.
   * @returns {Promise<Redis>}
   */
  async stop () {
    this.status = 'STOPPING';
    if (this.socket) {
      try {
        if (typeof this.socket.isOpen === 'boolean' && this.socket.isOpen) {
          await this.socket.quit();
        }
      } catch (_) {
        try { this.socket.disconnect(); } catch (__) {}
      }
      this.socket = null;
    }
    this.status = 'STOPPED';
    return this;
  }

  /**
   * @param {string} name Channel name
   * @returns {Promise<void>}
   */
  async subscribe (name) {
    if (!this.socket) throw new Error('Redis client is not started');
    const channel = String(name);
    await this.socket.subscribe(channel, (message, subscribedChannel) => {
      this._emitChannelMessage(subscribedChannel || channel, message);
    });
  }
}

module.exports = Redis;
