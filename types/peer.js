'use strict';

const {
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_ROOT,
  P2P_PING,
  P2P_PONG,
  P2P_INSTRUCTION,
  P2P_BASE_MESSAGE,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_STATE_ROOT
} = require('../constants');

const net = require('net');
const crypto = require('crypto');
const stream = require('stream');

const Key = require('./key');
const Machine = require('./machine');
const Message = require('./message');
const Session = require('./session');
const Scribe = require('./scribe');
const Wallet = require('./wallet');

// TODO: implement the noise protocol: http://noiseprotocol.org/noise.html
const ZERO_LENGTH_PLAINTEXT = '';

/**
 * An in-memory representation of a node in our network.
 */
class Peer extends Scribe {
  /**
   * Create an instance of {@link Peer}.
   * @param       {Vector} config - Initialization Vector for this peer.
   */
  constructor (config = {}) {
    super(config);

    this.name = 'Peer';
    this.settings = this.config = Object.assign({
      address: '0.0.0.0',
      networking: true,
      listen: false,
      port: 7777
    }, config);

    if (this.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Creating Wallet with settings:', this.settings);
    this.wallet = new Wallet(this.settings);

    this.server = net.createServer(this._handleConnection.bind(this));
    this.stream = new stream.Transform({
      transform (chunk, encoding, callback) {
        // TODO: parse as encrypted data
        callback(null, chunk);
      }
    });

    // TODO: attempt to use handler binding
    // probably bug with this vs. self
    // this.stream.on('data', this._handler.bind(this));

    // TODO: load wallet from key
    this.key = new Key(this.settings.key);
    this.wallet = new Wallet(this.settings);

    // this.hex = this.key.public.encodeCompressed('hex');
    // this.pkh = crypto.createHash('sha256').update(this.hex).digest('hex');

    this.address = this.config.address;
    this.port = this.config.port;

    this.connections = {};
    this.peers = {};
    this.memory = {};
    this.messages = new Set();
    this.machine = new Machine();

    this.meta = {
      messages: {
        inbound: 0,
        outbound: 0
      }
    };

    return this;
  }

  get id () {
    return this.wallet.shard[0].string;
  }

  async start () {
    const peer = this;
    if (this.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Peer starting...');

    try {
      await peer.wallet.start();
    } catch (E) {
      console.error('Could not start wallet:', E);
    }

    if (this.settings.listen) {
      await peer.listen();
    }

    peer.emit('ready', {
      id: peer.id
    });

    return peer;
  }

  async stop () {
    this.log('Peer stopping...');

    // TODO: close only when listening actively
    await this.server.close();

    return this;
  }

  async _setState (value) {
    if (!value) return new Error('You must provide a State to set the value to.');
    this.state.state = value;
    return this.state.state;
  }

  _connect (address) {
    let self = this;
    let parts = address.split(':');
    let known = Object.keys(self.connections);

    if (this.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Connecting to address:', address);

    if (parts.length !== 2) return console.debug('Invalid address:', address);
    if (known.includes(address)) return self.connections[address];

    // TODO: refactor to use local functions + specific unbindings
    try {
      self.connections[address] = new net.Socket();

      self.connections[address].on('error', function (err) {
        console.debug('[PEER]', `could not connect to peer ${address} — Reason:`, err);
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
      self.connections[address].on('data', async function peerDataHandler (data) {
        if (self.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Received data from peer:', data);
        self.meta.messages.inbound++;
        let message = null;

        // debug message for listeners
        self.emit('socket:data', data);

        try {
          message = self._parseMessage(data);
        } catch (exception) {
          console.error('[FABRIC:PEER]', 'Could not parse inbound messsage:', exception);
        }

        console.log('[FABRIC:PEER]', 'Inbound message type:', message.type);
        console.log('[FABRIC:PEER]', 'Total inbound messages:', self.meta.messages.inbound);

        // disconnect from any peer sending invalid messages
        if (!message) return this.destroy();

        let response = await self._handleMessage({
          origin: address,
          message: message
        });

        if (response) {
          self.meta.messages.outbound++;
          this.write(response.asRaw());
        }
      });

      // TODO: replace with handshake
      // NOTE: the handler is only called once per connection!
      self.connections[address].connect(parts[1], parts[0], function () {
        if (self.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Connection created...');
        const session = new Session();
        // const m = new Message();
        // TODO: check peer ID, eject if self or known
        const vector = ['IdentityRequest', self.id];
        const message = Message.fromVector(vector);

        self.meta.messages.outbound++;
        self.connections[address].write(message.asRaw());

        self.emit('connections:open', {
          address: address,
          status: 'unauthenticated',
          initiator: true
        });

        if (self.settings.verbosity >= 4) console.log('[FABRIC:PEER]', `Connection to ${address} established!`);
      });
    } catch (E) {
      self.log('[PEER]', 'failed to connect:', E);
    }

    return self.connections[address];
  }

  _parseMessage (data) {
    if (!data) return false;
    if (this.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Parsing message:', data);

    let self = this;
    let message = null;

    try {
      message = Message.fromRaw(data);
    } catch (E) {
      console.debug('[FABRIC:PEER]', 'error parsing message:', E);
    }

    if (this.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Parsed message into:', message.type, message.data);
    return message;
  }

  _handleConnection (socket) {
    let self = this;
    let address = [socket.remoteAddress, socket.remotePort].join(':');

    if (this.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Incoming connection from address:', address);

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
    socket.on('data', async function incomingDataHandler (data) {
      console.log('[FABRIC:PEER]', 'Incoming socket data:', data);
      self.emit('socket:data', data);
      let message = null;

      try {
        message = self._parseMessage(data);
      } catch (exception) {
        console.error('[FABRIC:PEER]', 'Could not parse data into message:', message);
      }

      // disconnect from any peer sending invalid messages
      if (!message) return this.destroy();
      if (self.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Parsed into Message:', message.raw);
      if (self.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Message type:', message.type);
      if (self.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Message data:', message.data);

      let response = await self._handleMessage({
        origin: address,
        message: message
      });

      if (response) {
        if (self.settings.verbosity >= 4) console.log('[FABRIC:PEER]', 'Writing response:', response);
        this.write(response.asRaw());
      } else {
        console.warn('[FABRIC:PEER]', 'No response found for message type:', message.type);
      }
    });

    // add this socket to the list of known connections
    this.connections[address] = socket;

    // Request incoming Peer's identity
    // TODO: check peer ID, eject if self or known
    const vector = ['IdentityRequest', self.id];
    const message = Message.fromVector(vector);
    if (self.settings.verbosity >= 4) console.log(`Network message (raw bytes):`, message.asRaw());

    // TODO: use `sendTo` method (not yet defined on Peer)
    self.meta.messages.outbound++;
    self.connections[address].write(message.asRaw());

    // TODO: set peer ID to actual BTC address
    this._registerPeer({ id: 'foo', address: address });
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

    console.log('[FABRIC:PEER]', 'Peer registered:', peer);

    return true;
  }

  async _handleMessage (packet) {
    if (!packet) return false;
    if (this.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Handling packet from peer:', packet.message.id);

    let self = this;
    let response = null;
    let message = packet.message;

    if (!message) return console.error('Hard failure:', packet);
    if (self.messages.has(message.id)) {
      if (self.settings.verbosity >= 4) console.warn('[FABRIC:PEER]', 'Received duplicate message:', message.id, message.type, message.data);
      return false;
    } else {
      self.memory[message.id] = message;
      self.messages.add(message.id);
    }

    // Build a response to various message types
    switch (message.type) {
      default:
        console.log('[PEER]', `unhandled message type "${message.type}"`);
        break;
      case 'GenericMessage':
        console.warn('[FABRIC:PEER]', 'Received Generic Message:', message.data);
        break;
      case 'IdentityRequest':
        console.log('[FABRIC:PEER]', 'Peer sent IdentityRequest.  Responding with IdentityResponse (node id)...', self.id);
        response = Message.fromVector(['IdentityResponse', self.id]);
        break;
      case 'IdentityResponse':
        if (!self.peers[message.data]) {
          let peer = {
            id: message.data,
            address: packet.origin
          };
          self._registerPeer(peer);
        }
        response = Message.fromVector(['StateRoot', JSON.stringify(self.state)]);
        break;
      case 'PeerMessage':
        console.trace('[FABRIC:PEER]', 'Received "PeerMessage" on socket:', message.raw);
        break;
      case 'StateRoot':
        if (self.settings.verbosity >= 5) console.log('[AUDIT]', 'Message was a state root:', message.data);

        // TODO: test protocol flow (i.e., understand StateRoot)
        // console.log('[AUDIT]', 'Message was a state root:', message);

        try {
          const state = JSON.parse(message.data);
          self.emit('state', state);
        } catch (E) {
          console.error('[FABRIC:PEER]', 'Could not parse StateRoot:', E);
        }
        break;
      case 'StateChange':
        console.log('message was a state change:', message.data);
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
            console.log('[PEER]', `unhandled peer instruction "${stack[1]}"`);
            break;
        }

        break;
    }

    // Emit for listeners
    self.emit('message', message);

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
        console.log('unhandled base packet type:', message.type);
        break;
      case 'collections:post':
        this.emit('collections:post', message.data);
        break;
    }
  }

  broadcast (message) {
    // TODO: coerce type, prefer `Message`
    if (typeof message !== 'string') message = JSON.stringify(message);
    let id = crypto.createHash('sha256').update(message).digest('hex');

    if (this.messages.has(id)) {
      console.log('attempted to broadcast duplicate message');
      return false;
    } else {
      this.memory[id] = message;
      this.messages.add(id);
    }

    for (let id in this.peers) {
      let peer = this.peers[id];
      // TODO: select type byte for state updates
      // TODO: require `Message` type before broadcast (or, preferrably, cast as necessary)
      // let msg = Message.fromVector([P2P_BASE_MESSAGE, message]);
      let msg = Message.fromVector(['PeerMessage', message]);

      try {
        this.connections[peer.address].write(msg.asRaw());
      } catch (exception) {
        console.error('[FABRIC:PEER]', `Could not wriite message to connection "${peer.address}":`, exception);
      }
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
    self.server.listen(self.config.port, self.config.address, function listenReady () {
      if (self.config.verbosity >= 3) {
        self.log('[PEER]', `${self.id} now listening on tcp://${self.address}:${self.port}`);
      }
    });
    return self;
  }
}

module.exports = Peer;
