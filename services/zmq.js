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

    this.settings = Object.assign({
      host: '127.0.0.1',
      port: 29000,
      subscriptions: [
        'hashblock',
        'rawblock',
        'hashtx',
        'rawtx'
      ],
      reconnectInterval: 5000,  // 5 seconds between reconnection attempts
      maxReconnectAttempts: 10  // Maximum number of reconnection attempts
    }, settings);

    this.socket = null;
    this._state = {
      status: 'STOPPED',
      reconnectAttempts: 0
    };

    return this;
  }

  async connect () {
    this._state.status = 'CONNECTING';
    this.socket = zeromq.socket('sub');

    // Add connection event handlers
    this.socket.on('connect', () => {
      console.log(`[ZMQ] Connected to ${this.settings.host}:${this.settings.port}`);
      this._state.status = 'CONNECTED';
      this._state.reconnectAttempts = 0;  // Reset reconnection attempts on successful connect
    });

    this.socket.on('disconnect', () => {
      console.log(`[ZMQ] Disconnected from ${this.settings.host}:${this.settings.port}`);
      this._state.status = 'DISCONNECTED';
    });

    this.socket.on('error', (error) => {
      console.error('[ZMQ] Error:', error);
    });

    this.socket.on('close', async (msg) => {
      console.error('[ZMQ] Socket closed:', msg);
      // Only attempt reconnection if we haven't stopped the service intentionally
      if (this._state.status !== 'STOPPED' && this._state.status !== 'STOPPING') {
        if (this._state.reconnectAttempts < this.settings.maxReconnectAttempts) {
          this._state.reconnectAttempts++;
          console.log(`[ZMQ] Attempting to reconnect (${this._state.reconnectAttempts}/${this.settings.maxReconnectAttempts})...`);
          setTimeout(async () => {
            try {
              await this.start();
            } catch (err) {
              console.error('[ZMQ] Reconnection failed:', err);
            }
          }, this.settings.reconnectInterval);
        } else {
          console.error('[ZMQ] Max reconnection attempts reached. Giving up.');
          this.emit('error', new Error('Max reconnection attempts reached'));
        }
      }
    });

    this.socket.on('message', (topic, message) => {
      switch (topic.toString()) {
        case 'rawblock':
          const block = Message.fromVector(['BitcoinBlock', { content: message.toString('hex') }]);
          this.emit('message', block);
          break;
        case 'rawtx':
          const transaction = Message.fromVector(['BitcoinTransaction', { content: message.toString('hex') }]);
          this.emit('message', transaction);
          break;
        case 'hashtx':
          const txHash = Message.fromVector(['BitcoinTransactionHash', { content: message.toString('hex') }]);
          this.emit('message', txHash);
          break;
        case 'hashblock':
          const blockHash = Message.fromVector(['BitcoinBlockHash', { content: message.toString('hex') }]);
          this.emit('message', blockHash);
          break;
      }
    });

    this.socket.connect(`tcp://${this.settings.host}:${this.settings.port}`);

    return this;
  }

  /**
   * Opens the connection and subscribes to the requested channels.
   * @returns {ZMQ} Instance of the service.
   */
  async start () {
    await this.connect();

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
