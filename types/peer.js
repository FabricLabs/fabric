'use strict';

// Constants
const {
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_ROOT,
  P2P_PING,
  P2P_PONG,
  P2P_START_CHAIN,
  P2P_INSTRUCTION,
  P2P_BASE_MESSAGE,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_STATE_ROOT,
  ZERO_LENGTH_PLAINTEXT
} = require('../constants');

// Internals
const net = require('net');
const crypto = require('crypto');
const stream = require('stream');
const manager = require('fast-json-patch');
const noise = require('noise-protocol-stream');

// Dependencies
const merge = require('lodash.merge');
const upnp = require('nat-upnp');

// Fabric Types
const Actor = require('./actor');
const Identity = require('./identity');
const Signer = require('./signer');
const Key = require('./key');
const Machine = require('./machine');
const Message = require('./message');
const Service = require('./service');
const Session = require('./session');
const Reader = require('./reader');
const Wallet = require('./wallet');

// Constants
const PROLOGUE = 'FABRIC';

/**
 * An in-memory representation of a node in our network.
 */
class Peer extends Service {
  /**
   * Create an instance of {@link Peer}.
   * @param {Object} [config] Initialization Vector for this peer.
   * @param {Boolean} [config.listen] Whether or not to listen for connections.
   * @param {Boolean} [config.upnp] Whether or not to use UPNP for automatic configuration.
   * @param {Number} [config.port=7777] Port to use for P2P connections.
   * @param {Array} [config.peers=[]] List of initial peers.
   */
  constructor (config = {}) {
    super(config);

    this.name = 'Peer';
    this.settings = merge({
      constraints: {
        peers: {
          max: 32,
          shuffle: 8
        }
      },
      interface: '0.0.0.0',
      network: 'regtest',
      networking: true,
      listen: true,
      peers: [],
      port: 7777,
      upnp: false,
      key: {}
    }, config);

    // Network Internals
    this.upnp = null;
    this.server = net.createServer(this._NOISESocketHandler.bind(this));
    this.stream = new stream.Transform({
      transform (chunk, encoding, callback) {
        // TODO: parse as encrypted data
        callback(null, chunk);
      }
    });

    this.identity = new Identity(this.settings.key);
    this.signer = new Signer(this.settings.key);
    this.key = new Key(this.settings.key);
    this.wallet = new Wallet(this.settings.key);

    // this.hex = this.key.public.encodeCompressed('hex');
    // this.pkh = crypto.createHash('sha256').update(this.hex).digest('hex');

    // Public Details
    this.public = {
      ip: null,
      port: this.settings.port
    };

    // Internal properties
    this.chains = {};
    this.candidates = [];
    this.connections = {};
    this.peers = {};
    this.memory = {};
    this.handlers = {};
    this.messages = new Set();

    // Internal Stack Machine
    this.machine = new Machine();
    this.observer = null;

    this.meta = {
      messages: {
        inbound: 0,
        outbound: 0
      }
    };

    this._state = {
      content: {
        messages: {}
      },
      peers: {},
      chains: {},
      connections: {},
      status: 'sleeping'
    };

    return this;
  }

  get id () {
    return this.key.pubkey;
  }

  get pubkeyhash () {
    // TODO: switch to child pubkey
    // path: m/7777'/0'/0/0
    return this.key.pubkeyhash;
  }

  get state () {
    // TODO: use Proxy
    return Object.assign({}, this._state);
  }

  /**
   * @deprecated
   */
  get address () {
    return this.settings.interface || this.settings.address;
  }

  get interface () {
    return this.settings.interface || this.settings.address;
  }

  get port () {
    return this.settings.port || 7777;
  }

  set state (value) {
    this._state.content = value;
  }

  broadcast (message, origin = null) {
    for (const id in this.peers) {
      if (id === origin) continue;
      this.connections[id]._writeFabric(message);
    }
  }

  commit () {
    const state = new Actor(this.state);

    if (this.observer) {
      try {
        const patches = manager.generate(this.observer);
        if (!patches.length) return;
        this.history.push(patches);
        this.emit('changes', patches);
        // @deprecated
        this.emit('patches', patches);
        this.emit('commit', {
          type: 'FabricCommit',
          object: {
            delta: patches,
            snapshot: state.toGenericMessage().object
          }
        });
      } catch (exception) {
        this.emit('error', `Could not commit: ${exception}`);
      }
    }
  }

  relayFrom (origin, message, socket = null) {
    // this.emit('debug', `Relaying message from ${origin}: ${message}`);
    for (const id in this.peers) {
      if (id === origin) continue;
      // this.emit('debug', `Relaying message: ${message}`);
      // this.emit('debug', `Relaying to peer: ${id}`);
      this.connections[id]._writeFabric(message.toBuffer(), socket);
    }
  }

  _connect (target) {
    const url = new URL(`tcp://${target}`);
    const socket = net.createConnection(url.port, url.hostname);
    const client = noise({
      initiator: true,
      prologue: Buffer.from(PROLOGUE),
      // privateKey: this.identity.key.private,
      verify: this._verifyNOISE.bind(this)
    });

    socket.on('error', (error) => {
      this.emit('error', `Socket error: ${error}`);
    });

    // Start stream
    client.encrypt.pipe(socket).pipe(client.decrypt);
    // TODO: output stream
    // client.decrypt.pipe(this.stream);

    // Handle trusted Fabric messages
    client.decrypt.on('data', (data) => {
      this._handleFabricMessage(data, { name: target }, client);
    });

    // Start handshake
    const vector = ['P2P_SESSION_OFFER', JSON.stringify({
      type: 'P2P_SESSION_OFFER',
      actor: {
        id: this.identity.id
      },
      object: {
        challenge: crypto.randomBytes(8).toString('hex'),
      }
    })];

    // Create offer message
    const P2P_SESSION_OFFER = Message.fromVector(vector)._setSigner(this.signer).sign();
    const message = P2P_SESSION_OFFER.toBuffer();
    this.emit('debug', `session_offer ${P2P_SESSION_OFFER} ${message.toString('hex')}`);

    // Send handshake
    client.encrypt.write(message);

    // Map write function
    socket._writeFabric = (msg) => {
      this._writeFabric(msg, client);
    };

    this.connections[target] = socket;
    this.emit('connections:open', {
      id: target,
      url: url
    });
  }

  _fillPeerSlots () {
    if (this.connections.length >= this.settings.constraints.peers.max) return;
    const openCount = this.settings.constraints.peers.max - Object.keys(this.connections).length;
    for (let i = 0; i < openCount; i++) {
      if (!this.candidates.length) continue;
      const candidate = this.candidates.shift();
      // this.emit('debug', `Filling peer slot ${i} of ${openCount} (max ${this.settings.constraints.peers.max}) with candidate: ${JSON.stringify(candidate, null, '  ')}`);
      this._connect(`${candidate.object.host}:${candidate.object.port}`);
    }
  }

  _handleFabricMessage (buffer, origin = null, socket = null) {
    // this.emit('debug', `Peer handler decrypted data: ${buffer.toString('hex')}`);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const message = Message.fromBuffer(buffer);
    // this.emit('debug', `Got Fabric message: ${message}`);

    // Have we seen this message before?
    if (this._state.content.messages[hash]) {
      // this.emit('debug', `Duplicate message: ${hash}`);
      return;
    }

    this._state.content.messages[hash] = buffer.toString('hex');
    // this.emit('debug', `Stored message: [${hash}] <${buffer.byteLength} bytes> ${buffer.toString('hex')}`);

    switch (message.type) {
      default:
        this.emit('debug', `Unhandled message type: ${message.type}`);
        break;
      case 'GenericMessage':
      case 'PeerMessage':
      case 'ChatMessage':
        // Parse JSON body
        try {
          const content = JSON.parse(message.data);
          this._handleGenericMessage(content, origin, socket);
        } catch (exception) {
          this.emit('error', `Broken content body: ${exception}`);
        }

        break;
    }

    this.commit();
  }

  _handleGenericMessage (message, origin = null, socket = null) {
    // this.emit('debug', `Generic Message: ${JSON.stringify(message)}`);
    switch (message.type) {
      default:
        this.emit('debug', `Unhandled Generic Message: ${message.type}`);
        break;
      case 'P2P_SESSION_OFFER':
        this.emit('debug', `Handling session offer: ${JSON.stringify(message.object)}`);
        this.emit('debug', `Session offer origin: ${JSON.stringify(origin)}`);
        this.emit('debug', `connections: ${JSON.stringify(Object.keys(this.connections))}`);

        // Peer is valid
        // TODO: remove this assumption (validate above)
        this.peers[origin.name] = { id: message.actor.id, name: origin.name, address: origin.name };
        this.emit('peer', this.peers[origin.name]);

        // Send session open event
        const vector = ['P2P_SESSION_OPEN', JSON.stringify({
          type: 'P2P_SESSION_OPEN',
          object: {
            initiator: message.actor.id,
            counterparty: this.identity.id,
            solution: message.object.challenge
          }
        })];

        const PACKET_SESSION_START = Message.fromVector(vector)._setSigner(this.signer).sign();
        const reply = PACKET_SESSION_START.toBuffer();
        this.emit('debug', `session_start ${PACKET_SESSION_START} ${reply.toString('hex')}`);
        this.connections[origin.name]._writeFabric(reply, socket);
        break;
      case 'P2P_SESSION_OPEN':
        this.emit('debug', `Handling session open: ${JSON.stringify(message.object)}`);
        this.peers[origin.name] = { id: message.object.counterparty, name: origin.name, address: origin };
        this.emit('peer', this.peers[origin.name]);

        const PACKET_PEER_ANNOUNCE = Message.fromVector(['P2P_PEER_ANNOUNCE', JSON.stringify({
          type: 'P2P_PEER_ANNOUNCE',
          object: {
            host: this._externalIP,
            port: this.settings.port
          }
        })])._setSigner(this.signer).sign();

        const announcement = PACKET_PEER_ANNOUNCE.toBuffer();
        // this.emit('debug', `Announcing peer: ${announcement.toString('utf8')}`);
        this.connections[origin.name]._writeFabric(announcement, socket);
        break;
      case 'P2P_CHAT_MESSAGE':
        this.emit('chat', message);
        const relay = Message.fromVector(['ChatMessage', JSON.stringify(message)])._setSigner(this.signer);
        this.relayFrom(origin.name, relay);
        break;
      case 'P2P_STATE_ANNOUNCE':
        const state = new Actor(message.object.state);
        this.emit('debug', `state_announce <Generic>${JSON.stringify(message.object || '')} ${state.toGenericMessage()}`);
        break;
      case 'P2P_PEER_ANNOUNCE':
        this.emit('debug', `peer_announce <Generic>${JSON.stringify(message.object || '')}`);
        const candidate = new Actor(message.object);
        this.candidates.push(candidate.toGenericMessage());
        this._fillPeerSlots();

        const announce = Message.fromVector(['PeerAnnounce', JSON.stringify(message)]);
        this.relayFrom(origin.name, announce);
        break;
    }
  }

  _NOISESocketHandler (socket) {
    const target = `${socket.remoteAddress}:${socket.remotePort}`;
    const url = `tcp://${target}`;
    const handler = noise({
      prologue: Buffer.from(PROLOGUE),
      // privateKey: this.identity.key.private,
      verify: this._verifyNOISE.bind(this)
    });

    handler.encrypt.pipe(socket).pipe(handler.decrypt);

    // Emitted after the connection is accepted in the verify function
    handler.encrypt.on('handshake', (localPrivateKey, localPublicKey, remotePublicKey) => {
      // const counterparty = new Identity({ public: remotePublicKey.toString('hex') });
      this.emit('debug', `Peer encrypt handshake local key: ${localPublicKey.toString('hex')}`);
      this.emit('debug', `Peer encrypt handshake with remote key: ${remotePublicKey.toString('hex')}`);
      // this.emit('debug', `Peer encrypt handshake with remote identity: ${counterparty.id}`);
    });

    handler.decrypt.on('close', (data) => {
      this.emit('debug', `Peer decrypt close: ${data}`);
    });

    handler.decrypt.on('data', (data) => {
      this._handleFabricMessage(data, { name: target });
    });

    socket._writeFabric = (msg) => {
      this._writeFabric(msg, handler);
    };

    this.connections[target] = socket;
    this.emit('connections:open', {
      id: target,
      url: url
    });
  }

  _verifyNOISE (localPrivateKey, localPublicKey, remotePublicKey, done) {
    // Is the message valid?
    if (1 === 1) {
      done(null, true);
    } else {
      done(null, false);
    }
  }

  _writeFabric (msg, stream) {
    const hash = crypto.createHash('sha256').update(msg).digest('hex');
    this._state.content.messages[hash] = msg.toString('hex');
    this.commit();
    if (stream) stream.encrypt.write(msg);
  }

  /**
   * Start the Peer.
   */
  async start () {
    let address = null;

    this.emit('log', 'Peer starting...');

    if (this.settings.upnp) {
      // TODO: convert callbacks to promises
      this.emit('log', 'UPNP starting...');
      this.upnp = upnp.createClient();
      this.upnp.portMapping({
        description: '@fabric/core#playnet',
        public: this.settings.port,
        private: this.settings.port,
        ttl: 10
      }, (error) => {
        if (error) {
          this.emit('warning', 'Could not create UPNP mapping.  Other nodes may fail when connecting to this node.');
        } else {
          this.upnp.getMappings((error, results) => {
            if (!results || !results.length) return;
            const mapping = results.find((x) => x.private.port === this.settings.port );
            // this.emit('debug', `UPNP mappings: ${JSON.stringify(results, null, '  ')}`);
            // this.emit('debug', `Our rule: ${JSON.stringify(mapping, null, '  ')}`);

            this.upnp.externalIp((error, ip) => {
              if (error) {
                this.emit('warning', `Could not get external IP: ${error}`);
              } else {
                // this.emit('debug', `UPNP external: ${JSON.stringify(ip, null, '  ')}`);
                this._externalIP = ip;
                this.emit('upnp', {
                  host: ip,
                  port: this.settings.port
                });
              }
            });
          });
        }
      });
    }

    this.emit('log', 'Wallet starting...');

    try {
      await this.wallet.start();
    } catch (exception) {
      this.emit('error', `Could not start wallet: ${exception}`);
    }

    if (this.settings.listen) {
      this.emit('log', 'Listener starting...');

      try {
        address = await this.listen();
        this.emit('log', 'Listener started!');
      } catch (exception) {
        this.emit('error', 'Could not listen:', exception);
      }
    }

    if (this.settings.networking) {
      this.emit('warning', `Networking enabled.  Connecting to peers: ${JSON.stringify(this.settings.peers)}`);
      for (const candidate of this.settings.peers) {
        this._connect(candidate);
      }
    }

    try {
      this.observer = manager.observe(this._state.content);
    } catch (exception) {
      this.emit('error', `Could not observe state: ${exception}`);
    }

    this.emit('ready', {
      id: this.id,
      address: address,
      pubkey: this.key.pubkey
    });

    return this;
  }

  /**
   * Stop the peer.
   */
  async stop () {
    const peer = this;

    // Alert listeners
    peer.emit('log', 'Peer stopping...');

    if (peer.settings.upnp && peer.upnp) {
      peer.upnp.close();
    }

    for (const id in peer.connections) {
      peer.emit('log', `Closing connection: ${id}`);
      const connection = peer.connections[id];
      const closer = async function () {
        return new Promise((resolve, reject) => {
          // Give socket a timeout to close cleanly, destroy if failed
          let deadline = setTimeout(function () {
            peer.emit('warning', `[FABRIC:PEER] end() timed out for peer "${id}" so calling destroy...`);
            connection.destroy();
            resolve();
          }, 5000);

          // TODO: notify remote peer of closure
          // Use end(SOME_CLOSE_MESSAGE, ...)
          return connection.end(function socketClosed (error) {
            if (error) return reject(error);
            clearTimeout(deadline);
            resolve();
          });
        });
      }
      await closer();
    }

    const terminator = async function () {
      return new Promise((resolve, reject) => {
        if (!peer.server.address()) return resolve();
        return peer.server.close(function serverClosed (error) {
          if (error) return reject(error);
          resolve();
        });
      });
    }

    await terminator();

    return this;
  }

  async _setState (value) {
    if (!value) return new Error('You must provide a State to set the value to.');
    this.state.state = value;
    return this.state.state;
  }

  // TODO: use in _connect
  async _sessionStart (socket, target) {
    const self = this;
    const address = `${target.address}:${target.port}`;

    self.emit('debug', `Starting session with address: ${target.pubkey}@${address}`);
    self.connections[address].session = new Session({ recipient: target.pubkey });
    await self.connections[address].session.start();

    self.emit('debug', `Session created: ${JSON.stringify(self.connections[address].session)}`);

    // First time seeing our local address, use it
    // TODO: evaluate trust model
    if (!self.public.ip) {
      self.public.ip = socket.localAddress;
      self.emit('log', `Local socket was null, changed to: ${self.public.ip}`);
    }

    // TODO: consolidate with similar _handleConnection segment
    // TODO: check peer ID, eject if self or known

    // TODO re-enable (disabled to reduce spammy messaging)
    // /*
    // TODO: re-evaluate use of IdentityRequest
    // const vector = ['IdentityRequest', self.id];
    const vector = ['StartSession', JSON.stringify({
      id: self.connections[address].session.id,
      identity: self.id,
      advertise: `${self.key.pubkey}@${self.public.ip}:${self.public.port}`,
      signature: self.connections[address].session.key._sign(self.id)
    })];

    const message = Message.fromVector(vector);

    if (!socket.writable) {
      self.emit('error', `Socket is not writable.`);
      return false;
    }

    self.sendToSocket(address, message);

    // Emit notification of a newly opened connection
    self.emit('connections:open', {
      address: address,
      status: 'unauthenticated',
      initiator: true
    });

    this.emit('log', `Connection to ${address} established!`);
  }

  async _processCompleteDataPacket (socket, address, data) {
    // Constants
    const self = this;
    // TODO: actually decrypt packet
    const decrypted = socket.session.decrypt(data);

    this.emit('debug', `Handling data packet:`, data);

    // Variables
    let message = null;

    try {
      message = self._parseMessage(decrypted);
    } catch (exception) {
      console.error('[FABRIC:PEER]', 'Could not parse inbound messsage:', exception);
    }

    // disconnect from any peer sending invalid messages
    if (!message) return socket.destroy();

    const response = await self._handleMessage({
      message: message,
      origin: address,
      peer: {
        address: address,
        id: socket.id
      }
    });

    if (response) {
      self.meta.messages.outbound++;
      self.sendToSocket(address, response);
    }
  }

  async _handleSocketData (socket, address, data) {
    this.emit('debug', `Received data from peer: ${data}`);

    if (!socket.session) {
      this.emit('error', `Received data on socket without a session!  Violator: ${address}`);
      return false;
    }

    socket._reader._addData(data);

    return true;
  }

  _disconnect (address) {
    if (!this.connections[address]) return false;

    // Halt any heartbeat
    if (this.connections[address].heartbeat) {
      clearInterval(this.connections[address].heartbeat);
    }

    // Destroy the connection
    this.connections[address].destroy();

    // Remove connection from map
    delete this.connections[address];
  }

  _parseMessage (data) {
    if (!data) return false;
    if (this.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Parsing message:', data);

    // Variables
    let message = null;

    try {
      message = Message.fromRaw(data);
    } catch (exception) {
      this.emit('debug', `[FABRIC:PEER] error parsing message: ${exception}`);
    }

    if (this.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Parsed message into:', message.type, message.data);
    return message;
  }

  async _handleConnection (socket) {
    const self = this;
    const address = [socket.remoteAddress, socket.remotePort].join(':');
    // const server = noise({
      /* verify: function (localPrivateKey, localPublicKey, remotePublicKey, finish) {
        // Calling finish with an error as first argument will also emit an error event on the stream pair.
        // The callback must be called explicitly with true to accept.
        if (true || TRUSTED_PUBLIC_KEY.equals(remotePublicKey)) {
          finish(null, true);
        } else {
          finish(null, false);
        }
      } */
    // });

    self.emit('log', `[FABRIC:PEER] [0x${self.id}] Incoming connection from address: ${address}`);

    self.emit('connections:open', {
      address: address,
      status: 'connected',
      initiator: false
    });

    /*
    server.encrypt.pipe(socket).pipe(server.decrypt);

    // Emitted after the connection is accepted in the verify function
    server.encrypt.on('handshake', function (localPrivateKey, localPublicKey, remotePublicKey) {
      console.log('server encrypt handshake:', remotePublicKey);
    });

    // Reading and writing will only work after the connection is accepted
    server.decrypt.on('data', function (data) {
      console.log('incoming connection decrypted data:', data);
    }); */

    // TODO: use known key
    socket.session = new Session();
    socket._reader = new Reader();

    // Bind Reader events (Fabric)
    socket._reader.on('debug', function (msg) {
      self.emit('debug', msg);
    });

    socket._reader.on('message', function (msg) {
      self._processCompleteDataPacket.apply(self, [ socket, address, msg ]);
    });

    // Bind Socket events (Peer)
    socket.on('close', function terminate () {
      self.emit('log', `connection closed: ${address}`);
      self.emit('connections:close', { address: address });
      self._disconnect(address);
    });

    socket.on('data', function inboundPeerHandler (data) {
      try {
        self._handleSocketData.apply(self, [ socket, address, data ]);
      } catch (exception) {
        self.emit('error', `Could not handle socket data: ${exception}`);
      }
    });

    // add this socket to the list of known connections
    this.connections[address] = socket;

    self._maintainConnection(address);
  }

  _maintainConnection (address) {
    const peer = this;
    if (!peer.connections[address]) return new Error(`Connection for address "${address}" does not exist.`);
    /* peer.connections[address]._player = setInterval(function () {
      peer._pingConnection.apply(peer, [ address ]);
    }, 60000); */
  }

  _pingConnection (address) {
    const ping = Message.fromVector(['Ping', `${Date.now().toString()}`]);

    try {
      this.sendToSocket(address, ping);
    } catch (exception) {
      this.emit('error', `Couldn't deliver message to socket: ${exception}`);
    }
  }

  _updateLiveness (address) {
    // Return Error if no connection
    if (!this.connections[address]) {
      const error = `No connection for address: ${address}`;
      this.emit('error', error);
      return new Error(error);
    }

    // Set the _lastMessage property
    this.connections[address]._lastMessage = Date.now();

    // Make chainable
    return this;
  }

  _registerHandler (type, method) {
    if (this.handlers[type]) return new Error(`Handler for method "${type}" is already registered.`);
    this.handlers[type] = method.bind(this);
    return this.handlers[type];
  }

  _registerPeer (peer) {
    if (this.settings.verbosity >= 6) console.warn('[AUDIT]', 'Registering peer:', peer);
    let self = this;

    if (!peer) return false;
    if (!peer.id) {
      self.log(`Peer attribute 'id' is required.`);
      return false;
    }

    self.peers[peer.id] = peer;

    // console.log('[FABRIC:PEER]', `[@ID:$${self.id}]`, 'Peer registered:', peer);
    // console.log('[FABRIC:PEER]', `[@ID:$${self.id}]`, 'Peer list:', self.peers);

    self.emit('peer', peer);

    // TODO: document peer announcement
    // TODO: eliminate use of JSON in messaging
    const announcement = Message.fromVector(['PeerCandidate', JSON.stringify(peer)]);

    try {
      self.relayFrom(peer.id, announcement);
    } catch (exception) {
      self.emit('error', `Could not relay peer registration: ${exception}`);
    }

    return true;
  }

  async _requestStateFromAllPeers () {
    const message = Message.fromVector(['StateRequest']);
    this.broadcast(message);
  }

  async _handleMessage (packet) {
    if (!packet) return false;

    // Constants
    const self = this;
    const message = packet.message;
    const origin = packet.origin;

    // Variables
    let relay = false;
    let response = null;

    this._updateLiveness(origin);

    if (!message) return this.emit('error', `Hard failure: ${packet}`);
    if (this.messages.has(message.id)) {
      // this.emit('debug', `Received duplicate message ${message.id} from [${origin}] in packet: ${JSON.stringify(packet, null, '  ')}`);
      return false;
    } else {
      this.memory[message.id] = message;
      this.messages.add(message.id);
    }

    this.emit('log', `Evaluting message with purported type "${message.type}":`);

    // Build a response to various message types
    switch (message.type) {
      case 'ChatMessage':
        relay = true;
        this.emit('debug', `Message: ${JSON.stringify({
          type: message.type,
          data: message.data,
          size: message.data.length
        }, null, '  ')}`);
        this.emit('debug', `Data (${typeof message.data}): \n\t${message.data}`);

        try {
          const data = JSON.parse(message.data);
          this.emit('debug', `Parsed (${typeof data}): ${JSON.stringify(data, null, '  ')}`);
          this.emit('log', `[${data.object.created}] @${data.actor}: ${data.object.content}`);
          this.emit('message', message.data);
        } catch (exception) {
          this.emit('error', `Could not process ChatMessage: ${exception}`);
        }
        break;
      case 'Generic':
        relay = true;
        break;
      case 'Ping':
        response = Message.fromVector(['Pong', message.id]);
        break;
      case 'Pong':
        // self.emit('message', `Received Pong: ${message}`);
        break;
      case 'StartChain':
        break;
      case 'GenericMessage':
        // console.warn('[FABRIC:PEER]', 'Received Generic Message:', message.data);
        relay = true;
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

          // TODO: remove in favor of StartSession
          // Why?  Duplicate "peer" event is sent within _registerPeer
          // Try to register peer...
          /* try {
            self._registerPeer(peer);
          } catch (exception) {
            self.emit('error', `Could not register peer ${message.data} because: ${exception}`);
          } */
        }

        response = Message.fromVector(['StateRoot', JSON.stringify(self.state)]);
        break;
      case 'DocumentPublish':
        this.emit('log', `Document published from peer: ${message.data}`);
        this.emit('DocumentPublish', message.data);
        break;
      case 'DocumentRequest':
        this.emit('DocumentRequest', message.data);
        break;
      case 'BlockCandidate':
        break;
      case 'PeerCandidate':
        let candidate = null;

        try {
          candidate = JSON.parse(message.data);
        } catch (exception) {
          console.error('[FABRIC:PEER]', `[@ID:$${self.id}]`, 'Could not parse PeerCandidate message:', message.data, exception);
        }

        self.emit('peer:candidate', candidate);
        break;
      case 'PeerMessage':
        // console.error('[FABRIC:PEER]', `[@ID:$${self.id}]`, `Received "PeerMessage" from ${packet.origin} on socket:`, message.raw);
        // console.error('[FABRIC:PEER]', `[@ID:$${self.id}]`, `Packet origin:`, packet.origin);
        // TODO: use packet's peer ID, not socket address
        // Likely need to track connection?
        self.relayFrom(packet.origin, message);
        break;
      case 'StartSession':
        if (self.settings.verbosity >= 6) console.warn('[AUDIT]', '[FABRIC:PEER]', `[0x${self.id}]`, 'Received "StartSession" message on socket:', message.raw);
        let session = null;

        try {
          session = JSON.parse(message.data.toString('utf8'));
        } catch (exception) {
          console.error('[FABRIC:PEER]', 'Session body could not be parsed:', exception);
        }

        if (self.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Proposed session:', session);

        // TODO: avoid using JSON in overall protocol
        // TODO: validate signature
        let valid = true;
        // TODO: restore session identity
        if (valid && session/* && session.identity */) {
          if (self.settings.verbosity >= 6) console.log('[AUDIT]', 'Session is valid...');

          let peer = {
            id: session.identity,
            address: packet.origin,
            advertise: `${self.pubkeyhash}@${self.public.ip}:${self.public.port}`,
            status: 'unfunded'
          };

          if (self.settings.verbosity >= 5) console.log('[FABRIC:PEER]', 'Peer to register:', peer);

          // TODO: document peer registration process
          self._registerPeer(peer);

          // TODO: use message type for next phase of session (i.e., NOISE)
          response = Message.fromVector(['StartSession', { identity: self.id }]);
          if (self.settings.verbosity >= 6) console.log('[AUDIT]', 'Will send response:', response);
        }

        break;
      case 'StateRoot':
        if (self.settings.verbosity >= 5) console.log('[AUDIT]', 'Message was a state root:', message.data);

        // TODO: test protocol flow (i.e., understand StateRoot)
        console.log('[AUDIT]', 'Message was a state root:', message.raw, message.data);

        try {
          const state = JSON.parse(message.data);
          self.emit('state', state);
          response = {
            'type': 'Receipt',
            'data': state
          };
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
      default:
        console.error('[PEER]', `unhandled message type "${message.type}"`);
        self.emit('error', `Unhandled message type "${message.type}"`);
        break;
    }

    // Emit for listeners
    // self.emit('message', message);

    if (relay) {
      self.relayFrom(origin, message);
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
      case 'collections:post':
        this.emit('collections:post', message.data);
        break;
      default:
        console.log('unhandled base packet type:', message.type);
        break;
    }
  }

  async sendToSocket (address, raw) {
    if (raw instanceof Message) {
      raw = raw.asRaw();
    }

    if (!this.connections[address]) {
      this.emit('error', `Could not deliver message to unconnected address: ${address}`);
      return false;
    }

    if (!this.connections[address].session) {
      this.emit('error', `Connection does not have a Session: ${address}`);
      return false;
    }

    if (!this.connections[address].writable) {
      this.emit('error', `Connection is not writable: ${address}`);
      return false;
    }

    this.emit('debug', `Writing ${raw.length} bytes to socket: \n\t${raw.toString('hex')}`);
    // const signature = await this.connections[address].session._appendMessage(raw);
    // self.emit('debug', `Signature: ${signature}`);

    try {
      const result = this.connections[address].write(raw);
      if (!result) {
        this.emit('warning', 'Stream result false.');
      }
    } catch (exception) {
      this.emit('error', `Exception writing to $[${address}]: ${exception}`);
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
      // TODO: select type byte for state updates
      let msg = Message.fromVector([type, message]);
      this.sendToSocket(peer.address, msg);
    }
  }

  /**
   * Start listening for connections.
   * @fires Peer#ready
   * @return {Peer} Chainable method.
   */
  async listen () {
    const self = this;
    const promise = new Promise((resolve, reject) => {
      self.server.listen(self.port, self.interface, function listenComplete (error) {
        if (error) return reject(error);

        const details = self.server.address();
        const address = `tcp://${details.address}:${details.port}`;

        self.emit('log', `Now listening on ${address} [!!!]`);
        return resolve(address);
      });
    });

    return promise;
  }
}

module.exports = Peer;
