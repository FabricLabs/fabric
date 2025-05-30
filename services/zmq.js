'use strict';

// Dependencies
const zeromq = require('zeromq/v5-compat');

// Fabric Types
const Service = require('../types/service');
const Message = require('../types/message');

/**
 * Connect and subscribe to ZeroMQ publishers.
 */
class ZMQ extends Service {
  /**
   * Creates an instance of a ZeroMQ subscriber.
   * @param {Object} [settings] Settings for the ZMQ connection.
   * @param {String} [settings.host] Host for the ZMQ publisher.
   * @param {Number} [settings.port] Remote ZeroMQ service port.
   * @returns {ZMQ} Instance of the ZMQ service, ready to run `start()`
   */
  constructor (settings = {}) {
    super(settings);

    // Assign settings over the defaults
    // NOTE: switch to lodash.merge if clobbering defaults
    this.settings = Object.assign({
      host: '127.0.0.1',
      port: 29000,
      subscriptions: [
        'hashblock',
        'rawblock',
        'hashtx',
        'rawtx'
      ]
    }, settings);

    this.socket = null;
    this._state = { status: 'STOPPED' };

    return this;
  }

  /**
   * Opens the connection and subscribes to the requested channels.
   * @returns {ZMQ} Instance of the service.
   */
  async start () {
    const self = this;

    this.socket = zeromq.socket('sub');

    // Add connection event handlers
    this.socket.on('connect', () => {
      console.log(`[ZMQ] Connected to ${this.settings.host}:${this.settings.port}`);
    });

    this.socket.on('disconnect', () => {
      console.log(`[ZMQ] Disconnected from ${this.settings.host}:${this.settings.port}`);
    });

    this.socket.on('error', (error) => {
      console.error('[ZMQ] Error:', error);
    });

    this.socket.connect(`tcp://${this.settings.host}:${this.settings.port}`);
    this.socket.on('message', function _handleSocketMessage (topic, message) {
      const path = `channels/${topic.toString()}`;
      if (self.settings.debug) self.emit('debug', `[ZMQ] Received message on topic: ${topic.toString()}, length: ${message.length}`);
      self.emit('debug', `ZMQ message @ [${path}] (${message.length} bytes) ⇒ ${message.toString('hex')}`);
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
    this.emit('ready');

    return this;
  }

  /**
   * Closes the connection to the ZMQ publisher.
   * @returns {ZMQ} Instance of the service.
   */
  async stop () {
    this.status = 'STOPPING';
    if (this.socket) this.socket.close();
    this.status = 'STOPPED';
    return this;
  }

  subscribe (name) {
    this.socket.subscribe(name);
  }
}

module.exports = ZMQ;
