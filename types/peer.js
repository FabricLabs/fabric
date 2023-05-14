'use strict';

// Constants
const {
  FABRIC_KEY_DERIVATION_PATH,
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_ROOT,
  P2P_PING,
  P2P_PONG,
  P2P_PORT,
  P2P_START_CHAIN,
  P2P_INSTRUCTION,
  P2P_BASE_MESSAGE,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_STATE_ROOT
} = require('../constants');

// Internals
const net = require('net');
const crypto = require('crypto');
const stream = require('stream');
const manager = require('fast-json-patch');
const noise = require('noise-protocol-stream');

// Dependencies
const merge = require('lodash.merge');
const upnp = require('nat-upnp-2');

// Fabric Types
const Actor = require('./actor');
const Identity = require('./identity');
const Signer = require('./signer');
const Key = require('./key');
const Machine = require('./machine');
const Message = require('./message');
const Service = require('./service');
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
      interval: 60000, // 1 minute
      network: 'regtest',
      networking: true,
      listen: true,
      peers: [],
      port: 7777,
      state: Object.assign({
        actors: {},
        channels: {},
        contracts: {},
        messages: {}
      }, config.state),
      upnp: false,
      key: {}
    }, config);

    // Network Internals
    this.upnp = null;
    this.server = net.createServer(this._NOISESocketHandler.bind(this));
    this.stream = new stream.Transform({
      transform (chunk, encoding, done) {
        done(null, chunk);
      }
    });

    this.identity = new Identity(this.settings.key);
    this.signer = new Signer(this.settings.key);
    this.key = new Key(this.settings.key);
    // this.wallet = new Wallet(this.settings.key);

    // this.hex = this.key.public.encodeCompressed('hex');
    // this.pkh = crypto.createHash('sha256').update(this.hex).digest('hex');

    // Public Details
    this.public = {
      ip: null,
      port: this.settings.port
    };

    // Internal properties
    this.actors = {};
    this.contracts = {};
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
      content: this.settings.state,
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

  beat () {
    const initial = new Actor(this.state);
    const now = (new Date()).toISOString();

    this.commit();
    this.emit('beat', {
      created: now,
      initial: initial.toGenericMessage(),
      state: this.state
    });

    return this;
  }

  /**
   * Write a {@link Buffer} to all connected peers.
   * @param {Buffer} message Message buffer to send.
   */
  broadcast (message, origin = null) {
    for (const id in this.connections) {
      if (id === origin) continue;
      this.connections[id]._writeFabric(message);
    }
  }

  relayFrom (origin, message, socket = null) {
    for (const id in this.connections) {
      if (id === origin) continue;
      this.connections[id]._writeFabric(message.toBuffer(), socket);
    }
  }

  _beginFabricHandshake (client) {
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
    if (this.settings.debug) this.emit('debug', `session_offer ${P2P_SESSION_OFFER} ${message.toString('hex')}`);

    // Send handshake
    try {
      client.encrypt.write(message);
    } catch (exception) {
      this.emit('error', `Cannot write to socket: ${exception}`);
    }

    return this;
  }

  /**
   * Open a Fabric connection to the target address and initiate the Fabric Protocol.
   * @param {String} target Target address.
   */
  _connect (target) {
    const url = new URL(`tcp://${target}`);
    const id = url.username;

    if (!url.port) target += `:${P2P_PORT}`;

    this._registerActor({ name: target });
    this._registerPeer({ identity: id });

    // Set up the NOISE socket
    const socket = net.createConnection(url.port || P2P_PORT, url.hostname);
    const client = noise({
      initiator: true,
      prologue: Buffer.from(PROLOGUE),
      // privateKey: derived.privkey,
      verify: this._verifyNOISE.bind(this)
    });

    socket.on('error', (error) => {
      this.emit('error', `Socket error: ${error}`);
    });

    socket.on('open', (info) => {
      this.emit('debug', `Socket open: ${info}`);
    });

    socket.on('close', (info) => {
      this.emit('debug', `Outbound socket closed: (${target}) ${info}`);
      socket._destroyFabric();
    });

    socket.on('end', (info) => {
      this.emit('debug', `Socket end: (${target}) ${info}`);
    });

    // Handle trusted Fabric messages
    client.decrypt.on('data', (data) => {
      this._handleFabricMessage(data, { name: target }, client);
    });

    // Start stream
    client.encrypt.pipe(socket).pipe(client.decrypt);

    // TODO: output stream
    // client.decrypt.pipe(this.stream);

    this._registerNOISEClient(target, socket, client);
    this._beginFabricHandshake(client);

    this.emit('connections:open', {
      address: target,
      id: target,
      url: url
    });
  }

  _announceAlias (alias, origin = null, socket = null) {
    const PACKET_PEER_ALIAS = Message.fromVector(['P2P_PEER_ALIAS', JSON.stringify({
      type: 'P2P_PEER_ALIAS',
      object: {
        name: alias
      }
    })]);

    const announcement = PACKET_PEER_ALIAS.toBuffer();
    this.broadcast(announcement, origin.name);
  }

  _destroyFabric (socket, target) {
    if (socket._keepalive) clearInterval(socket._keepalive);

    delete this.connections[target];
    delete this.peers[target];

    this.emit('connections:close', {
      address: target,
      name: target
    });
  }

  /**
   * Attempt to fill available connection slots with new peers.
   * @returns {Peer} Instance of the peer.
   */
  _fillPeerSlots () {
    if (this.connections.length >= this.settings.constraints.peers.max) return;
    const openCount = this.settings.constraints.peers.max - Object.keys(this.connections).length;
    for (let i = 0; i < openCount; i++) {
      if (!this.candidates.length) continue;
      const candidate = this.candidates.shift();
      // this.emit('debug', `Filling peer slot ${i} of ${openCount} (max ${this.settings.constraints.peers.max}) with candidate: ${JSON.stringify(candidate, null, '  ')}`);
      
      try {
        this._connect(`${candidate.object.host}:${candidate.object.port}`);
      } catch (exception) {
        this.emit('error', `Unable to fill open peer slot ${i}: ${exception}`);
      }

      // Place the candidate back in the list
      this.candidates.push(candidate);
    }

    return this;
  }

  /**
   * Handle a Fabric {@link Message} buffer.
   * @param {Buffer} buffer
   * @returns {Peer} Instance of the Peer.
   */
  _handleFabricMessage (buffer, origin = null, socket = null) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const message = Message.fromBuffer(buffer);
    if (this.settings.debug) this.emit('debug', `Got Fabric message: ${message}`);

    // Have we seen this message before?
    if (this.messages[hash]) {
      // this.emit('debug', `Duplicate message: ${hash}`);
      return;
    }

    // Store message for later
    this.messages[hash] = buffer.toString('hex');

    const checksum = crypto.createHash('sha256').update(message.body, 'utf8').digest('hex');
    if (checksum !== message.raw.hash.toString('hex')) throw new Error('Message received with incorrect hash.');

    // TODO: verify signatures
    // const signer = new Signer({ public: message.raw.author });
    // this.emit('debug', `Message signer: ${signer}`);
    if (this.settings.debug) this.emit('debug', `Message author: ${message.raw.signature.toString('hex')}`);
    if (this.settings.debug) this.emit('debug', `Message signature: ${message.raw.signature.toString('hex')}`);

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

    return this;
  }

  _handleGenericMessage (message, origin = null, socket = null) {
    if (this.settings.debug) this.emit('debug', `Generic message:\n\tFrom: ${JSON.stringify(origin)}\n\tType: ${message.type}\n\tBody:\n\`\`\`\n${JSON.stringify(message.object, null, '  ')}\n\`\`\``);

    // Lookup the appropriate Actor for the message's origin
    const actor = new Actor(origin);

    switch (message.type) {
      default:
        this.emit('debug', `Unhandled Generic Message: ${message.type} ${JSON.stringify(message, null, '  ')}`);
        break;
      case 'P2P_SESSION_OFFER':
        if (this.settings.debug) this.emit('debug', `Handling session offer: ${JSON.stringify(message.object)}`);
        if (this.settings.debug) this.emit('debug', `Session offer origin: ${JSON.stringify(origin)}`);
        if (this.settings.debug) this.emit('debug', `connections: ${JSON.stringify(Object.keys(this.connections))}`);

        // Peer is valid
        // TODO: remove this assumption (validate above)
        // TODO: check for existing peer, update instead of replace
        this.peers[origin.name] = {
          id: message.actor.id,
          name: origin.name,
          address: origin.name,
          connections: [ origin.name ]
        };

        // Emit peer event
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
        if (this.settings.debug) this.emit('debug', `session_start ${PACKET_SESSION_START} ${reply.toString('hex')}`);
        this.connections[origin.name]._writeFabric(reply, socket);
        break;
      case 'P2P_SESSION_OPEN':
        if (this.settings.debug) this.emit('debug', `Handling session open: ${JSON.stringify(message.object)}`);
        this.peers[origin.name] = { id: message.object.counterparty, name: origin.name, address: origin };
        this.emit('peer', this.peers[origin.name]);
        break;
      case 'P2P_CHAT_MESSAGE':
        this.emit('chat', message);
        const relay = Message.fromVector(['ChatMessage', JSON.stringify(message)])._setSigner(this.signer);
        // this.emit('debug', `Relayed chat message: ${JSON.stringify(relay.toGenericMessage())}`);
        this.relayFrom(origin.name, relay);
        break;
      case 'P2P_STATE_ANNOUNCE':
        const state = new Actor(message.object.state);
        this.emit('debug', `state_announce <Generic>${JSON.stringify(message.object || '')} ${state.toGenericMessage()}`);
        break;
      case 'P2P_PING':
        const now = (new Date()).toISOString();
        const P2P_PONG = Message.fromVector(['GENERIC', JSON.stringify({
          actor: {
            id: this.identity.id
          },
          created: now,
          type: 'P2P_PONG',
          object: {
            created: now
          }
        })]);

        this.connections[origin.name]._writeFabric(P2P_PONG.toBuffer());
        break;
      case 'P2P_PONG':
        // Update the peer's score for succesfully responding to a ping
        // TODO: ensure no pong is handled when a ping was not previously sent
        const instance = this.state.actors[actor.id] ? this.state.actors[actor.id] : {};

        this.actors[actor.id].adopt([
          { op: 'replace', path: '/score', value: (instance.score || 0) + 1 }
        ]);

        this._state.content.actors[actor.id] = this.actors[actor.id].state;
        this.commit();

        this.emit('state', this.state);
        break;
      case 'P2P_PEER_ALIAS':
        this.emit('debug', `peer_alias ${origin.name} <Generic>${JSON.stringify(message.object || '')}`);
        this.connections[origin.name]._alias = message.object.name;
        break;
      case 'P2P_PEER_ANNOUNCE':
        this.emit('debug', `peer_announce <Generic>${JSON.stringify(message.object || '')}`);
        const candidate = new Actor(message.object);
        this.candidates.push(candidate.toGenericMessage());
        // this._fillPeerSlots();

        // const announce = Message.fromVector(['PeerAnnounce', JSON.stringify(message)]);
        // this.relayFrom(origin.name, announce);
        break;
      case 'P2P_DOCUMENT_PUBLISH':
        break;
      case 'CONTRACT_PUBLISH':
        // TODO: reject and punish mis-behaving peers
        this.emit('debug', `Handling peer contract publish: ${JSON.stringify(message.object)}`);
        this._registerContract(message.object);
        break;
      case 'CONTRACT_MESSAGE':
        // TODO: reject and punish mis-behaving peers
        if (this.settings.debug) this.emit('debug', `Handling contract message: ${JSON.stringify(message.object)}`);
        if (this.settings.debug) this.emit('debug', `Contract state: ${JSON.stringify(this.state.contracts[message.object.contract])}`);
        manager.applyPatch(this._state.content.contracts[message.object.contract], message.object.ops);
        this.commit();
        break;
    }
  }

  _handleNOISEHandshake (localPrivateKey, localPublicKey, remotePublicKey) {
    this.emit('debug', `Peer transport handshake using local key: ${localPrivateKey.toString('hex')}`);
    this.emit('debug', `Peer transport handshake using local public key: ${localPublicKey.toString('hex')}`);
    this.emit('debug', `Peer transport handshake with remote public key: ${remotePublicKey.toString('hex')}`);
  }

  _NOISESocketHandler (socket) {
    const target = `${socket.remoteAddress}:${socket.remotePort}`;
    const url = `tcp://${target}`;

    // Store a unique actor for this inbound connection
    this._registerActor({ name: target });

    // Create NOISE handler
    const handler = noise({
      prologue: Buffer.from(PROLOGUE),
      // privateKey: this.identity.key.private,
      verify: this._verifyNOISE.bind(this)
    });

    // Set up NOISE event handlers
    handler.encrypt.on('handshake', this._handleNOISEHandshake.bind(this));
    handler.encrypt.on('error', (error) => {
      this.emit('error', `NOISE encrypt error: ${error}`);
    });

    handler.encrypt.on('end', (data) => {
      this.emit('debug', `Peer encrypt end: ${data}`);
    });

    handler.decrypt.on('error', (error) => {
      this.emit('error', `NOISE decrypt error: ${error}`);
    });

    handler.decrypt.on('close', (data) => {
      this.emit('debug', `Peer decrypt close: ${data}`);
    });

    handler.decrypt.on('end', (data) => {
      this.emit('debug', `Peer decrypt end: ${data}`);
    });

    handler.decrypt.on('data', (data) => {
      this._handleFabricMessage(data, { name: target });
    });

    socket._destroyFabric = () => {
      this._destroyFabric(socket, target);
    };

    socket._writeFabric = (msg) => {
      this._writeFabric(msg, handler);
    };

    // Store socket in collection
    this.connections[target] = socket;

    // Begin NOISE stream
    handler.encrypt.pipe(socket).pipe(handler.decrypt);

    this.emit('connections:open', {
      id: target,
      url: url
    });
  }

  _publishDocument (hash, rate = 0) {
    this._state.content.documents[hash] = document;

    this.commit();

    const PACKET_DOCUMENT_PUBLISH = Message.fromVector(['P2P_DOCUMENT_PUBLISH', JSON.stringify({
      type: 'P2P_DOCUMENT_PUBLISH',
      object: {
        hash: hash,
        rate: rate
      }
    })]);

    const message = PACKET_DOCUMENT_PUBLISH.toBuffer();
    if (this.settings.debug) this.emit('debug', `Broadcasting document publish: ${message.toString('utf8')}`);
    this.broadcast(message);
  }

  _registerActor (object) {
    this.emit('debug', `Registering actor: ${JSON.stringify(object, null, '  ')}`);
    const actor = new Actor(object);

    if (this.actors[actor.id]) return this;

    this.actors[actor.id] = actor;
    this.commit();
    this.emit('actorset', this.actors);

    return this;
  }

  _registerContract (object) {
    this.emit('debug', `Registering contract: ${JSON.stringify(object, null, '  ')}`);
    const actor = new Actor(object);

    if (this.contracts[actor.id]) return this;

    this.contracts[actor.id] = actor;
    this._state.content.contracts[actor.id] = object.state;

    this.commit();
    this.emit('contractset', this.contracts);

    return this;
  }

  _registerNOISEClient (name, socket, client) {
    // Assign socket properties
    // Failure counter
    socket._failureCount = 0;
    socket._lastMessage = null;
    socket._messageLog = [];

    // Enable keepalive
    socket._keepalive = setInterval(() => {
      const now = (new Date()).toISOString();
      const P2P_PING = Message.fromVector(['GENERIC', JSON.stringify({
        actor: {
          id: this.identity.id
        },
        created: now,
        type: 'P2P_PING',
        object: {
          created: now
        }
      })]);

      try {
        client.encrypt.write(P2P_PING.toBuffer());
      } catch (exception) {
        this.emit('debug', `Cannot write ping: ${exception}`)
      }
    }, 60000);

    // TODO: reconcile APIs for these methods
    // Map destroy function
    socket._destroyFabric = () => {
      this._destroyFabric(socket, name);
    };

    // Map write function
    socket._writeFabric = (msg) => {
      this._writeFabric(msg, client);
    };

    this.connections[name] = socket;

    return this;
  }

  _registerPeer (data) {
    const peer = new Actor({
      type: 'Peer',
      data: data
    });

    if (this.peers[peer.id]) return this;

    this.peers[peer.id] = peer;

    return this;
  }

  _scheduleReconnect (target, when = 250) {
    this.emit('debug', `Scheduled reconnect to ${target} in ${when} milliseconds...`);
    const reconnect = setTimeout(() => {
      this._connect(target);
    }, when);
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
    this.messages[hash] = msg.toString('hex');
    this.commit();
    if (stream) stream.encrypt.write(msg);
  }

  /**
   * Start the Peer.
   */
  async start () {
    let address = null;

    this.emit('log', 'Peer starting...');

    // Register self
    this._registerActor({ name: `${this.interface}:${this.port}` });

    this.emit('log', 'Wallet starting...');

    try {
      // await this.wallet.start();
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

    if (this.settings.upnp && this.settings.listen) {
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

    try {
      this.observer = manager.observe(this._state.content);
    } catch (exception) {
      this.emit('error', `Could not observe state: ${exception}`);
    }

    await this._startHeart();

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
    // Alert listeners
    this.emit('log', 'Peer stopping...');
    this._state.status = 'STOPPING';

    // Stop the heart
    if (this._heart) clearInterval(this._heart);

    if (this.settings.upnp && this.upnp) {
      this.emit('debug', 'Closing UPNP...');
      try {
        this.upnp.close()
      } catch (exception) {
        this.emit('debug', `Could not stop UPNP: ${exception}`);
      };
    }

    this.emit('debug', 'Closing all connections...');
    for (const id in this.connections) {
      this.connections[id].destroy();
    }

    const terminator = async () => {
      return new Promise((resolve, reject) => {
        if (!this.server.address()) return resolve();
        return this.server.close(function serverClosed (error) {
          if (error) return reject(error);
          resolve();
        });
      });
    }

    this.emit('debug', 'Closing network...');
    await terminator();

    this._state.status = 'STOPPED';
    this.commit();

    this.emit('log', 'Peer stopped!');

    return this;
  }

  async _setState (value) {
    if (!value) return new Error('You must provide a State to set the value to.');
    this._state.content = value;
    return this.state;
  }

  _disconnect (address) {
    if (!this.connections[address]) return false;

    // Halt any heartbeat
    if (this.connections[address].heartbeat) {
      clearInterval(this.connections[address].heartbeat);
    }

    // Destroy the connection
    // this.connections[address].destroy();

    // Remove connection from map
    delete this.connections[address];
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

  async _requestStateFromAllPeers () {
    const message = Message.fromVector(['StateRequest']);
    this.broadcast(message);
  }

  /**
   * Start listening for connections.
   * @return {Peer} Chainable method.
   */
  async listen () {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.interface, (error) => {
        if (error) return reject(error);

        const details = this.server.address();
        const address = `${details.address}:${details.port}`;

        this.emit('log', `Now listening on tcp://${address} [!!!]`);
        return resolve(address);
      });

      this.server.on('error', (error) => {
        this.emit('error', `Server socket error: ${error}`);
      });
    });
  }
}

module.exports = Peer;
