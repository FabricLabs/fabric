'use strict';

// Dependencies
const zeromq = require('zeromq/v5-compat');

// Fabric Types
const Service = require('../types/service');
const Message = require('../types/message');
const { MAX_MESSAGE_SIZE } = require('../constants');

/** bitcoind topic → message type for the field-encoded form. */
const ZMQ_MESSAGE_TYPES = Object.freeze({
  rawblock: 'BitcoinBlock',
  rawtx: 'BitcoinTransaction',
  hashtx: 'BitcoinTransactionHash',
  hashblock: 'BitcoinBlockHash'
});
/** Hex characters that fit a field body beside its `present` / `extra` fields. */
const ZMQ_MAX_FIELD_HEX = (MAX_MESSAGE_SIZE - 64) * 2;

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
    this._paused = new Set();
    this._state = {
      status: 'STOPPED',
      reconnectAttempts: 0
    };

    return this;
  }

  /** Avoid process crash when nothing listens for `error` (Node EventEmitter default). */
  _emitErrorSafe (err) {
    if (this.listenerCount('error') > 0) this.emit('error', err);
    else this.emit('warning', `[ZMQ] ${err && err.message ? err.message : err}`);
  }

  async connect () {
    this._state.status = 'CONNECTING';
    this.socket = zeromq.socket('sub');

    // Add connection event handlers
    this.socket.on('connect', () => {
      this.emit('debug', `[ZMQ] Connected to ${this.settings.host}:${this.settings.port}`);
      this._state.status = 'CONNECTED';
      this._state.reconnectAttempts = 0;  // Reset reconnection attempts on successful connect
    });

    this.socket.on('disconnect', () => {
      this.emit('debug', `[ZMQ] Disconnected from ${this.settings.host}:${this.settings.port}`);
      this._state.status = 'DISCONNECTED';
    });

    this.socket.on('error', (error) => {
      this._emitErrorSafe(error);
    });

    this.socket.on('close', async (msg) => {
      this.emit('debug', `[ZMQ] Socket closed: ${msg}`);
      // Only attempt reconnection if we haven't stopped the service intentionally
      if (this._state.status !== 'STOPPED' && this._state.status !== 'STOPPING') {
        if (this._state.reconnectAttempts < this.settings.maxReconnectAttempts) {
          this._state.reconnectAttempts++;
          this.emit('debug', `[ZMQ] Attempting to reconnect (${this._state.reconnectAttempts}/${this.settings.maxReconnectAttempts})...`);
          setTimeout(async () => {
            try {
              await this.start();
            } catch (err) {
              this._emitErrorSafe(err);
            }
          }, this.settings.reconnectInterval);
        } else {
          this.emit('warning', '[ZMQ] Max reconnection attempts reached. Giving up.');
          this._emitErrorSafe(new Error('Max reconnection attempts reached'));
        }
      }
    });

    this.socket.on('message', (topic, message) => this._handleSocketMessage(topic, message));

    this.socket.connect(`tcp://${this.settings.host}:${this.settings.port}`);

    return this;
  }

  /**
   * One bitcoind notification: emit it as a field-body `Message`, or as the raw
   * `[topic, bytes]` pair when the codec can't hold it. Never throws.
   * @param {Buffer} topic
   * @param {Buffer} message
   */
  _handleSocketMessage (topic, message) {
    const name = topic.toString();
    const type = ZMQ_MESSAGE_TYPES[name];
    if (!type) return;
    // Raw blocks (and large transactions) exceed one AMP frame. Anything the
    // field codec can't hold is emitted as bitcoind's own `[topic, bytes]`
    // pair, which `Bitcoin#_handleZMQMessage` reads directly. Nothing thrown
    // here may escape the socket callback.
    if (message && message.length * 2 <= ZMQ_MAX_FIELD_HEX) {
      try {
        this.emit('message', Message.fromLegacyBody(type, { content: message.toString('hex') }));
        return;
      } catch (err) {
        this.emit('warning', `[ZMQ] ${name} not field-encoded (${err && err.message ? err.message : err}); passing raw bytes`);
      }
    }
    this.emit('message', [name, message]);
  }

  /**
   * Opens the connection and subscribes to the requested channels.
   * @returns {ZMQ} Instance of the service.
   */
  async start () {
    await this.connect();

    for (let i = 0; i < this.settings.subscriptions.length; i++) {
      const name = this.settings.subscriptions[i];
      if (!this._paused.has(name)) this.subscribe(name);
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
    const socket = this.socket;
    // Pause and resume after stop only record topics; a closed socket is never touched.
    this.socket = null;
    if (socket) socket.close();
    this.status = 'STOPPED';
    return this;
  }

  subscribe (name) {
    this.socket.subscribe(name);
  }

  /**
   * Stop receiving the named topics. The publisher filters them, so nothing
   * for them crosses the socket. Kept across reconnects until {@link ZMQ#resume}.
   * @param {String[]} names Topics from `settings.subscriptions`.
   * @returns {String[]} The topics newly paused.
   */
  pause (names = []) {
    const changed = [];
    for (const name of names) {
      if (!this.settings.subscriptions.includes(name) || this._paused.has(name)) continue;
      this._paused.add(name);
      changed.push(name);
      if (this.socket) this.socket.unsubscribe(name);
    }
    return changed;
  }

  /**
   * Receive topics paused by {@link ZMQ#pause} again.
   * @param {String[]} names Topics to resume.
   * @returns {String[]} The topics newly resumed.
   */
  resume (names = []) {
    const changed = [];
    for (const name of names) {
      if (!this._paused.has(name)) continue;
      this._paused.delete(name);
      changed.push(name);
      if (this.socket) this.socket.subscribe(name);
    }
    return changed;
  }

  /** @returns {String[]} Topics currently paused. */
  get paused () {
    return Array.from(this._paused);
  }
}

module.exports = ZMQ;
