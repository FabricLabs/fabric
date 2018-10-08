'use strict';

const net = require('net');
const crypto = require('crypto');
const stream = require('stream');

const Key = require('./key');
const Machine = require('./machine');
const Message = require('./message');
const Scribe = require('./scribe');

// TODO: implement the noise protocol: http://noiseprotocol.org/noise.html
const P2P_IDENT_REQUEST = 0x01; // 1, or the identity
const P2P_IDENT_RESPONSE = 0x11;
const P2P_ROOT = 0x00000000;
const P2P_PING = 0x00000012; // same ID as Lightning (18)
const P2P_PONG = 0x00000013; // same ID as Lightning (19)
const P2P_INSTRUCTION = 0x00000020; // TODO: select w/ no overlap
const P2P_BASE_MESSAGE = 0x00000031; // TODO: select w/ no overlap
const P2P_STATE_COMMITTMENT = 0x00000032; // TODO: select w/ no overlap
const P2P_STATE_CHANGE = 0x00000033; // TODO: select w/ no overlap

const ZERO_LENGTH_PLAINTEXT = '';

/**
 * An in-memory representation of a node in our network.
 */
class Peer extends Scribe {
  /**
   * Create an instance of {@link Peer}.
   * @param       {Vector} config - Initialization Vector for this peer.
   */
  constructor (config) {
    super(config);

    this.name = 'Peer';
    this.config = Object.assign({
      address: '0.0.0.0',
      port: 7777
    }, config || {});

    this.stream = new stream.Transform({
      transform (chunk, encoding, callback) {
        // TODO: parse as encrypted data
        callback(null, chunk);
      }
    });

    // TODO: attempt to use handler binding
    // probably bug with this vs. self
    // this.stream.on('data', this._handler.bind(this));

    this.key = this.config.key || new Key();
    this.hex = this.key.public.encodeCompressed('hex');
    this.pkh = crypto.createHash('sha256').update(this.hex).digest('hex');

    this.address = this.config.address;
    this.port = this.config.port;

    this.connections = {};
    this.peers = {};
    this.memory = {};
    this.messages = new Set();
    this.machine = new Machine();

    return this;
  }

  start () {
    this.log('Peer starting...');

    if (!this.server) {
      this.listen();
    }
  }

  _connect (address) {
    let self = this;
    let parts = address.split(':');
    let known = Object.keys(self.connections);

    if (parts.length !== 2) return self.debug('Invalid address:', address);
    if (known.includes(address)) return self.connections[address];

    // TODO: refactor to use local functions + specific unbindings
    try {
      self.connections[address] = new net.Socket();

      self.connections[address].on('error', function (err) {
        self.debug('[PEER]', `could not connect to peer ${address} — Reason:`, err);
      });

      self.connections[address].on('close', function (err) {
        if (err) self.debug('socket closed on error:', err);
        self.connections[address].removeAllListeners();
        // TODO: consider using `process.nextTick` to only clean up after event?
        delete self.connections[address];
        self.emit('connections:close', {
          address: address
        });
      });

      // TODO: unify as _dataHandler
      self.connections[address].on('data', async function (data) {
        let message = self._parseMessage(data);
        // disconnect from any peer sending invalid messages
        if (!message) this.destroy();

        let response = await self._handleMessage({
          origin: address,
          message: message
        });

        if (response) {
          this.write(response.asRaw());
        }
      });

      // TODO: replace with handshake
      self.connections[address].connect(parts[1], parts[0], function () {
        self.emit('connections:open', {
          address: address,
          status: 'unauthenticated',
          initiator: true
        });

        self.log(`connection to ${address} established!`);

        // TODO: check peer ID, eject if self or known
        let message = Message.fromVector([P2P_IDENT_REQUEST, self.id]);
        self.connections[address].write(message.asRaw());
      });
    } catch (E) {
      self.log('[PEER]', 'failed to connect:', E);
    }

    return self.connections[address];
  }

  _parseMessage (data) {
    if (!data) return false;

    let self = this;
    let message = null;

    try {
      message = Message.fromRaw(data);
    } catch (E) {
      self.debug('[PEER]', 'error parsing message:', E);
    }

    return message;
  }
  
  _handleConnection (socket) {
    let self = this;
    let address = [socket.remoteAddress, socket.remotePort].join(':');

    self.log('incoming connection:', address);

    self.emit('connections:open', {
      address: address,
      status: 'connected',
      initiator: false
    });

    socket.on('close', function terminate () {
      self.log('connection closed:', address);
      self.emit('connections:close', { address: address });
    });

    // TODO: unify as _dataHandler
    socket.on('data', async function (data) {
      let message = self._parseMessage(data);
      // disconnect from any peer sending invalid messages
      if (!message) this.destroy();

      let response = await self._handleMessage({
        origin: address,
        message: message
      });

      if (response) {
        this.write(response.asRaw());
      }
    });

    // add this socket to the list of known connections
    this.connections[address] = socket;
  }
  
  _registerPeer (peer) {
    let self = this;

    if (!peer) return false;
    if (!peer.id) {
      self.log(`Peer attribute 'id' is required.`);
      return false;
    }

    self.peers[peer.id] = peer;
    self.emit('peer', peer);

    return true;
  }

  async _handleMessage (packet) {
    if (!packet) return false;

    let self = this;
    let response = null;
    let message = packet.message;

    if (!message) return self.error('Hard failure:', packet);

    if (self.messages.has(message.id)) {
      self.log('received duplicate message:', message);
      return false;
    } else {
      self.memory[message.id] = message;
      self.messages.add(message.id);
    }

    switch (message.type) {
      default:
        self.log('[PEER]', `unhandled message type "${message.type}"`);
        break;
      case P2P_IDENT_REQUEST:
        self.log('message was an identity request.  sending node id...');
        response = Message.fromVector([P2P_IDENT_RESPONSE, self.id]);
        break;
      case P2P_IDENT_RESPONSE:
        self.log('message was an identity response!  registering peer:', message.data);
        if (!self.peers[message.data]) {
          let peer = {
            id: message.data,
            address: packet.origin
          };
          self._registerPeer(peer);
        }
        break;
      case P2P_BASE_MESSAGE:
        self._handleBasePacket(packet);
        break;
      case P2P_ROOT:
        response = Message.fromVector([P2P_STATE_COMMITTMENT, self.state]);
        self.log('type was ROOT, sending state root:', response);
        self.log('type was ROOT, state was:', self.state);
        break;
      case P2P_PING:
        response = Message.fromVector([P2P_PONG, message.id]);
        self.log(`type was PING (${message.id}), sending PONG:`, response);
        break;
      case P2P_INSTRUCTION:
        // TODO: use Fabric.Script / Fabric.Machine
        let stack = message.data.split(' ');
        switch (stack[1]) {
          case 'SIGN':
            let signature = self.key._sign(stack[0]);
            let buffer = Buffer.from(signature);
            let script = [buffer.toString('hex'), 'CHECKSIG'].join(' ');

            response = Message.fromVector([P2P_INSTRUCTION, script]);
            break;
          default:
            self.log('[PEER]', `unhandled instruction "${stack[1]}"`);
            break;
        }

        break;
    }

    return response;
  }

  _handleBasePacket (packet) {
    let message = null;

    try {
      message = JSON.parse(packet.message.data);
    } catch (E) {
      return this.log('Error parsing message:', E);
    }

    switch (message.type) {
      default:
        this.log('unhandled base packet type:', message.type);
        break;
      case 'collections:post':
        this.emit('collections:post', message.data);
        break;
    }
  }

  broadcast (message) {
    if (typeof message !== 'string') message = JSON.stringify(message);
    let id = crypto.createHash('sha256').update(message).digest('hex');

    if (this.messages.has(id)) {
      this.log('attempted to broadcast duplicate message');
      return false;
    } else {
      this.memory[id] = message;
      this.messages.add(id);
    }

    for (let id in this.peers) {
      let peer = this.peers[id];
      this.log('creating message for:', peer);
      // TODO: select type byte for state updates
      let msg = Message.fromVector([P2P_BASE_MESSAGE, message]);
      this.connections[peer.address].write(msg.asRaw());
    }
  }

  _broadcastTypedMessage (type, message) {
    if (!message) message = '';
    if (typeof message !== 'string') message = JSON.stringify(message);

    let id = crypto.createHash('sha256').update(message).digest('hex');

    if (this.messages.has(id)) {
      this.log('attempted to broadcast duplicate message');
      return false;
    } else {
      this.memory[id] = message;
      this.messages.add(id);
    }

    for (let id in this.peers) {
      let peer = this.peers[id];
      this.log('creating message for:', peer);
      // TODO: select type byte for state updates
      let msg = Message.fromVector([type, message]);
      this.connections[peer.address].write(msg.asRaw());
    }
  }

  /**
   * Start listening for connections.
   * @fires Peer#ready
   * @return {Peer} Chainable method.
   */
  listen () {
    let self = this;
    self.server = net.createServer(self._handleConnection.bind(self));
    self.server.listen(self.config.port, self.config.address, function () {
      if (self.config.debug) {
        self.log('[PEER]', `${self.id} now listening on tcp://${self.address}:${self.port}`);
      }
      self.emit('ready', {
        id: self.id
      });
    });
    return self;
  }
}

module.exports = Peer;
