'use strict';

const net = require('net');
const merge = require('lodash.merge');
const Service = require('./service');
const Key = require('./key');
const Actor = require('./actor');

const NOISE_VERSION_BYTE = Buffer.from('00', 'hex');

class NOISE extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      interface: '0.0.0.0',
      port: 9735
    }, this.settings, settings);

    this.key = null;
    this.server = null;
    this.address = null;

    this.connections = {};

    this._state = {
      connections: {},
      status: 'STOPPED'
    };

    return this;
  }

  async start () {
    if (!this.key) this.key = new Key();

    // Create TCP server
    this.server = net.createServer(this._inboundConnectionHandler.bind(this));

    // Event Handlers
    this.server.on('error', this._serverErrorHandler.bind(this));

    const self = this;
    const promise = new Promise((resolve, reject) => {
      self.server.listen(self.settings.port, self.settings.interface, async function _server (error) {
        if (error) return reject(error);
        try {
          await self._handleServerReady();
          self.emit('ready');
          resolve(self);
        } catch (exception) {
          reject(exception);
        }
      });
    });

    return promise;
  }

  async stop () {
    if (this.server) await this.server.close();
  }

  async connect (address) {
    const self = this;
    const parts = new URL(address);
    const pair = `${parts.hostname}:${parts.port}`;
    const actor = new Actor(pair);

    if (this.connections[actor.id]) return this.emit('error', `Already connected to ${pair} 0x${actor.id}`);

    this.connections[actor.id] = new net.Socket();
    this.connections[actor.id].on('data', (data) => {
      self.emit('log', `[CLIENT] Received: ${data.toString()}`);

      if (data.toString() === 'Hello, world!') {
        this.write('Hello back!\r\n');
      } else {
        console.log('received:', data.toString());
      }

      this.close();
    });

    this.connections[actor.id].on('end', () => {
      self.emit('log', '[CLIENT] Disconnected.');
    });

    this.connections[actor.id].connect(parts.port, parts.hostname, function (error) {
      self.emit('log', '[CLIENT] Connected!');
      if (error) return self.emit('error', `Could not connect: ${error}`);
      // TODO: NOISE Protocol Act 1
      this.write('Hello, world!\r\n');
    });

    return this.connections[actor.id];
  }

  async _serverErrorHandler (error) {
    this.emit('error', error);
  }

  async _inboundConnectionHandler (c) {
    const pair = `${c.remoteAddress}:${c.remotePort}`;
    const actor = new Actor(pair);

    this.emit('log', `[SERVER] New inbound connection, return pair: ${pair} 0x${actor.id}`);

    if (this.connections[actor.id]) {
      this.emit('warning', `[SERVER] Connection ${pair} already exists.`);
      c.destroy();
      return this;
    }

    this.connections[actor.id] = c;

    c.on('close', () => {
      console.log('client disconnected');
      delete this.connections[actor.id];
    });

    c.on('data', (data) => {
      console.log('[SERVER]', 'Data from client:', data.toString());
    });

    return this;
  }

  async _handleServerReady (error) {
    if (error) return this.emit('error', `Unable to start server: ${error}`);
    const service = this.server.address();
    this.address = `${this.key.pubkey}@${service.address}:${service.port}`;
    this._state.status = 'READY';
    await this.commit();
    return this;
  }
}

module.exports = NOISE;
