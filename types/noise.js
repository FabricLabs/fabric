'use strict';

// Constants
const PROTOCOL_NAME = 'Noise_XK_secp256k1_ChaChaPoly_SHA256';
const NOISE_PROLOGUE = 'lightning';
const NOISE_VERSION_BYTE = Buffer.from('00', 'hex');

// Dependencies
const net = require('net');
const crypto = require('crypto');
const merge = require('lodash.merge');

// Cryptography
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

// Types Used
const Reader = require('./reader');
const Service = require('./service');
const Key = require('./key');
const Actor = require('./actor');
const HKDF = require('./hkdf');
const Hash256 = require('./hash256');

class NOISE extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      persistent: false,
      interface: '0.0.0.0',
      port: 9735,
      timeout: 60000
    }, settings);

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
    if (!this.key) this.key = new Key(this.settings);

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
    this.connections[actor.id].on('data', async (data) => {
      const response = 'Hello back, client!';
      const trimmed = data.toString().trim();
      if (trimmed === response) {
        self.emit('log', `[CLIENT] Received ${response} — saying goodbye...`);
        this.connections[actor.id].write('Goodbye, server.');
        await self.disconnect(actor.id);
      } else {
        console.log('[CLIENT] Received unexpected data:', trimmed);
      }
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

  async disconnect (id) {
    if (!this.connections[id]) return true;

    const pair = `${this.connections[id].remoteAddress}:${this.connections[id].remotePort}`;

    try {
      this.connections[id].destroy();
    } catch (exception) {
      console.error(`Exception closing socket ${pair} 0x${id}: ${exception}`);
    }

    if (this.connections[id]._timeout) clearTimeout(this.connections[id]._timeout);

    delete this.connections[id];

    // All clean, emit event
    this.emit('connections:close', {
      id: id
    });

    return true;
  }

  async _serverErrorHandler (error) {
    this.emit('error', error);
  }

  /**
   * Handler for inbound connections to the local host.
   * @param {net.Socket} c Instance of the connection itself.
   * @returns {NOISE} Current instance of the {@link NOISE} service.
   */
  async _inboundConnectionHandler (c) {
    const self = this;
    const pair = `${c.remoteAddress}:${c.remotePort}`;
    const actor = new Actor(pair);

    this.emit('log', `[SERVER] New inbound connection, return pair: ${pair} 0x${actor.id}`);

    // If we already have this connection, abort
    if (this.connections[actor.id]) {
      this.emit('warning', `[SERVER] Connection ${pair} already exists.`);
      c.destroy(); // TODO: test various network conditions (safe closure vs. network interruption)
      return this;
    }

    // Track internal map of connections
    this.connections[actor.id] = c;

    // Bind Event Listeners
    c.on('close', () => {
      self.emit('log', `[SERVER] Client disconnected: ${pair} 0x${actor.id}`);
      self.disconnect(actor.id);
    });

    c.on('data', (data) => {
      const hello = 'Hello, world!';
      const trimmed = data.toString().trim();
      if (trimmed === hello) {
        self.emit('log', `[SERVER] Received ${hello}.  Sending response...`);
        c.write('Hello back, client!\r\n');
      } else {
        this.emit('log', `[SERVER] Unknown input: ${trimmed}`);
      }
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

  async _updatePresence (actorID) {
    const service = this;
    const c = service.connections[actorID];

    if (!c) return service.emit('error', `No such actor: ${actorID}`);
    if (c._timeout) clearTimeout(c._timeout);

    c._timeout = setTimeout(() => {
      c.destroy();
      delete service.connections[actorID];
    }, service.settings.timeout);

    return true;
  }
}

module.exports = NOISE;
