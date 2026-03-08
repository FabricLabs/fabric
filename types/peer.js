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

// Dependencies
const net = require('net');
const crypto = require('crypto');
const { Level } = require('level');
const stream = require('stream');
const manager = require('fast-json-patch');
const noise = require('noise-protocol-stream');
const merge = require('lodash.merge');

// Fabric Types
const Actor = require('./actor');
const Identity = require('./identity');
const Key = require('./key');
const Machine = require('./machine');
const Message = require('./message');
const Service = require('./service');
// const Wallet = require('./wallet');

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
          max: 0,
          shuffle: 8
        }
      },
      interface: '0.0.0.0',
      interval: 60000, // 1 minute
      network: 'regtest',
      networking: true, // Ensure networking is enabled by default
      listen: true,
      peers: [],
      // LevelDB path (Node) or IndexedDB name (browser)
      // In tests, default to no persistent registry to avoid reconnecting to
      // a developer machine's stale peer list (which can hang/timeout the suite).
      peersDb: (process.env.NODE_ENV === 'test') ? null : 'stores/hub/peers',
      port: 7777,
      reconnectToKnownPeers: true,
      connectTimeout: 5000,
      state: Object.assign({
        actors: {},
        channels: {},
        contracts: {},
        documents: {},
        messages: {},
        services: {}
      }, config.state),
      upnp: false,
      key: {}
    }, config);

    // Log settings at construction
    if (this.settings.debug) {
      console.log('[FABRIC:PEER:CONSTRUCTOR] networking:', this.settings.networking);
      console.log('[FABRIC:PEER:CONSTRUCTOR] peers:', this.settings.peers);
      console.log('[FABRIC:PEER:CONSTRUCTOR] peersDb:', this.settings.peersDb);
    }

    // Network Internals
    this.upnp = null;

    // Create a server only when listening is requested
    if (this.settings.listen) {
      this.server = net.createServer(this._NOISESocketHandler.bind(this));
    } else {
      // Minimal stub when neither listening nor networking is enabled
      this.server = {
        address: () => null,
        close: (cb) => cb && cb(),
        on: () => {}
      };
    }

    this.stream = new stream.Transform({
      transform (chunk, encoding, done) {
        done(null, chunk);
      }
    });

    this.identity = new Identity(this.settings.key);
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
    this.history = [];
    this.peers = {};
    // Peers: keyed by public key (id). Persistent registry in _state.peers.
    // Map connection address (IP:port) -> peer id (public key). Learned on P2P_SESSION_OFFER/OPEN.
    this._addressToId = {};
    this.mailboxes = {};
    this.memory = {};
    this.handlers = {};
    this.messages = new Set();
    this.sessions = {};

    // Internal Stack Machine
    this.machine = new Machine({ key: this.settings.key });
    this.observer = null;

    this.meta = {
      messages: {
        inbound: 0,
        outbound: 0
      }
    };

    this._state = {
      content: this.settings.state,
      peers: {}, // Peer registry keyed by public key (id). Persisted to LevelDB.
      chains: {},
      connections: {},
      status: 'sleeping'
    };

    return this;
  }

  _resolveToAddress (idOrAddress) {
    if (!idOrAddress || typeof idOrAddress !== 'string') return null;
    // Direct match on connection address
    if (this.connections[idOrAddress]) return idOrAddress;
    // Look up by id: find which address this id is connected from
    const registry = this._state.peers || {};
    const byId = registry[idOrAddress];
    if (byId && byId.address && this.connections[byId.address]) return byId.address;
    // Check _addressToId reverse: find address that maps to this id
    for (const [addr, id] of Object.entries(this._addressToId || {})) {
      if (id === idOrAddress && this.connections[addr]) return addr;
    }
    return null;
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

  get documentation () {
    return {
      name: 'Fabric',
      description: 'Manages connections to the Fabric Network.',
      methods: {
        ack: {
          description: 'Acknowledge a message.',
          parameters: {
            message: {
              // TODO: consider making this a FabricMessageID
              type: 'FabricMessage',
              description: 'The message to acknowledge.'
            }
          },
          returns: {
            type: 'Promise',
            description: 'A Promise which resolves to the completed FabricState.'
          }
        },
        send: {
          description: 'Send a message to a connected peer.',
          parameters: {
            message: {
              type: 'FabricMessage',
              description: 'The message to send to the peer.'
            }
          },
          returns: {
            type: 'Promise',
            description: 'A Promise which resolves to the response (if any).'
          }
        },
        broadcast: {
          description: 'Broadcast a message to all connected nodes.',
          parameters: {
            message: {
              type: 'FabricMessage',
              description: 'The message to send to the node.'
            }
          },
          returns: {
            type: 'Promise',
            description: 'A Promise which resolves to the responses (if any).'
          }
        }
      }
    }
  }

  get interface () {
    return this.settings.interface || this.settings.address;
  }

  get port () {
    return this.settings.port || 7777;
  }

  get publicPeers () {
    const peers = [];
    const addressToId = this._addressToId || {};

    // Connections are keyed by IP:port. Map each to peer id (public key) when known.
    for (const address in this.connections) {
      if (!Object.prototype.hasOwnProperty.call(this.connections, address)) continue;
      const socket = this.connections[address];
      const id = addressToId[address] || address;

      peers.push({
        id,
        address,
        status: 'connected',
        lastMessage: socket._lastMessage || null
      });
    }

    // Then, include any known peers that are not currently connected.
    for (const key in this.peers) {
      if (!Object.prototype.hasOwnProperty.call(this.peers, key)) continue;

      // Skip if this peer is already represented as a connected peer.
      if (peers.find((p) => p.id === key || p.address === key)) continue;

      const peer = this.peers[key];
      const id = peer && peer.id ? peer.id : key;
      const address = peer && peer.address ? peer.address : key;

      peers.push({
        id,
        address,
        status: 'disconnected'
      });
    }

    return peers;
  }

  get knownPeers () {
    const now = new Date().toISOString();
    const byId = {};
    const registry = this._state.peers || {};
    const addressToId = this._addressToId || {};

    // Start from persisted registry (keyed by id)
    for (const key in registry) {
      if (!Object.prototype.hasOwnProperty.call(registry, key)) continue;
      const reg = registry[key];
      const id = reg.id || key;
      byId[id] = {
        id,
        address: reg.address || key,
        status: 'disconnected',
        score: reg.score != null ? reg.score : 0,
        firstSeen: reg.firstSeen,
        lastSeen: reg.lastSeen,
        nickname: reg.nickname,
        alias: reg.alias,
        lastMessage: reg.lastMessage
      };
    }

    // Overlay current connections (map address -> id, then update byId)
    for (const address in this.connections) {
      if (!Object.prototype.hasOwnProperty.call(this.connections, address)) continue;
      const socket = this.connections[address];
      const id = addressToId[address] || address;
      if (!byId[id]) byId[id] = { id, address, status: 'connected', score: 0 };
      byId[id].status = 'connected';
      byId[id].address = address;
      byId[id].lastMessage = socket._lastMessage || byId[id].lastMessage;
      if (socket._alias) byId[id].alias = socket._alias;
    }

    // Include any this.peers not yet in registry
    for (const key in this.peers) {
      if (!Object.prototype.hasOwnProperty.call(this.peers, key)) continue;
      const peer = this.peers[key];
      const id = (peer && peer.id) || key;
      if (byId[id]) continue;
      byId[id] = {
        id,
        address: key,
        status: 'disconnected',
        score: 0,
        lastSeen: now
      };
    }

    return Object.values(byId);
  }

  _resolveToAddress (idOrAddress) {
    if (!idOrAddress) return null;
    if (this.connections[idOrAddress]) return idOrAddress;
    const addressToId = this._addressToId || {};
    for (const addr in addressToId) {
      if (addressToId[addr] === idOrAddress && this.connections[addr]) return addr;
    }
    const registry = this._state.peers || {};
    const entry = registry[idOrAddress];
    if (entry && entry.address && this.connections[entry.address]) return entry.address;
    return null;
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
    console.debug('broadcasting:', message);
    for (const id in this.connections) {
      this.emit('debug', `Broadcast [!!!] — evaluating connection: ${id}`);
      if (id === origin) continue;
      this.connections[id]._writeFabric(message);
    }
  }

  connectTo (address) {
    this._connect(address);
    return this;
  }

  relayFrom (origin, message, socket = null) {
    for (const id in this.connections) {
      if (id === origin) continue;
      this.connections[id]._writeFabric(message.toBuffer(), socket);
    }
  }

  subscribe (path) {

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
    const P2P_SESSION_OFFER = Message.fromVector(vector).signWithKey(this.key);
    const message = P2P_SESSION_OFFER.toBuffer();
    if (this.settings.debug) this.emit('debug', `session_offer ${P2P_SESSION_OFFER} ${message.toString('hex')}`);

    // Send handshake
    try {
      client.encrypt.write(message);
    } catch (exception) {
      if (exception && (exception.code === 'EPIPE' || exception.code === 'ECONNRESET')) {
        this.emit('warning', `Suppressing transient write error (${exception.code}) during handshake.`);
      } else {
        this.emit('error', `Cannot write to socket: ${exception}`);
      }
    }

    return this;
  }

  /**
   * Open a Fabric connection to the target address and initiate the Fabric Protocol.
   * @param {String} target Target address.
   */
  _connect (target) {
    if (!target || typeof target !== 'string') {
      this.emit('error', '[FABRIC:PEER:_connect] target must be a non-empty string');
      return;
    }

    if (this.connections[target]) {
      this.emit('debug', `[FABRIC:PEER:_connect] Already connected to ${target}; skipping`);
      return;
    }

    this.emit('debug', `[FABRIC:PEER:_connect] Attempting to connect to: ${target}`);
    const url = new URL(`tcp://${target}`);
    const id = url.username;

    if (!url.port) target += `:${P2P_PORT}`;

    const derived = this.identity.key.derive(FABRIC_KEY_DERIVATION_PATH);
    this.emit('debug', `Local derived ID: ${JSON.stringify(derived)}`);

    // Store the user's public key if provided
    if (id) {
      this.peers[target] = {
        ...this.peers[target],
        publicKey: id
      };
    }

    this._registerActor({ name: target });
    this._registerPeer({ identity: id });
    this._upsertPeerRegistry(target, { address: target });

    // Set up the NOISE socket
    const socket = net.createConnection(url.port || P2P_PORT, url.hostname);
    // Don't keep the test runner alive just because we're connecting.
    if (typeof socket.unref === 'function') socket.unref();

    // Bound connection establishment time; otherwise Node's TCP timeout can be long.
    const connectTimeoutMs = (typeof this.settings.connectTimeout === 'number')
      ? this.settings.connectTimeout
      : 5000;
    socket.setTimeout(connectTimeoutMs);
    socket.once('timeout', () => {
      const msg = `Socket timeout: connect ${url.hostname}:${url.port || P2P_PORT} after ${connectTimeoutMs}ms`;
      this.emit('warning', msg);
      socket.destroy(new Error(msg));
    });
    socket.once('connect', () => socket.setTimeout(0));

    const client = noise({
      initiator: true,
      prologue: Buffer.from(PROLOGUE),
      // privateKey: derived.privkey,
      verify: this._verifyNOISE.bind(this)
    });

    socket.on('error', (error) => {
      this.emit('debug', `--- debug error from _connect() ---`);
      if (error && (error.code === 'EPIPE' || error.code === 'ECONNRESET')) {
        this.emit('warning', `Suppressing transient outbound socket error (${error.code}) from _connect().`);
      } else {
        const msg = `Socket error: ${error}`;
        // Avoid crashing consumers/tests that haven't registered an 'error' listener.
        if (this.listenerCount('error') > 0) this.emit('error', msg);
        else this.emit('warning', msg);
      }
    });

    socket.on('open', (info) => {
      this.emit('debug', `Socket open: ${info}`);
    });

    socket.on('close', (info) => {
      this.emit('debug', `Outbound socket closed: (${target}) ${info}`);
      socket._destroyFabric();
      // this._scheduleReconnect(target);
    });

    socket.on('end', (info) => {
      this.emit('debug', `Socket end: (${target}) ${info}`);
      // delete this.connections[target];
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
    // this.emit('debug', `Announcing alias: ${announcement.toString('utf8')}`);
    this.broadcast(announcement, origin.name);
  }

  _destroyFabric (socket, target) {
    if (socket._keepalive) clearInterval(socket._keepalive);

    delete this.connections[target];
    delete this.peers[target];
    if (this._addressToId) delete this._addressToId[target];

    this.emit('connections:close', {
      address: target,
      name: target
    });
  }

  /**
   * Load persistent peer registry from LevelDB.
   * Uses classic-level in Node, browser-level (IndexedDB) in browser.
   * @returns {Promise<void>}
   */
  async _loadPeerRegistry () {
    const location = this.settings.peersDb;
    if (!location) return;

    try {
      this._peersDb = this._peersDb || new Level(location);
      const raw = await this._peersDb.get('peers').catch(() => null);
      const peers = raw ? JSON.parse(raw) : {};
      if (peers && typeof peers === 'object') {
        // Migrate legacy address-keyed entries to id-keyed (id is the fixed public key)
        const migrated = {};
        for (const key of Object.keys(peers)) {
          const entry = peers[key];
          const id = entry && entry.id;
          if (id) {
            migrated[id] = merge({ id, address: key }, entry);
          } else {
            // No id yet (pre-handshake); keep keyed by address until we learn id
            migrated[key] = merge({ address: key }, entry);
          }
        }
        this._state.peers = migrated;
        if (this.settings.debug) this.emit('debug', `[FABRIC:PEER] Loaded peer registry: ${Object.keys(this._state.peers).length} entries`);
      }
    } catch (err) {
      this.emit('debug', `[FABRIC:PEER] No peer registry or load error: ${err && err.message}`);
      if (!this._state.peers) this._state.peers = {};
    }
  }

  /**
   * Persist peer registry to LevelDB (debounced).
   */
  _savePeerRegistry () {
    const location = this.settings.peersDb;
    if (!location) return;

    if (this._peerRegistrySaveScheduled) clearTimeout(this._peerRegistrySaveScheduled);

    this._peerRegistrySaveScheduled = setTimeout(() => {
      this._peerRegistrySaveScheduled = null;
      this._peersDb = this._peersDb || new Level(location);
      const payload = JSON.stringify(this._state.peers || {});
      this._peersDb.put('peers', payload)
        .then(() => { if (this.settings.debug) this.emit('debug', '[FABRIC:PEER] Saved peer registry'); })
        .catch((err) => this.emit('error', `Failed to save peer registry: ${err && err.message}`));
    }, 500);
  }

  /**
   * Upsert a peer into the persistent registry (state.peers) and schedule save to LevelDB.
   * @param {string} address - Peer address (e.g. host:port).
   * @param {Object} [updates] - Fields to set/merge (id, score, firstSeen, lastSeen, alias, publicKey).
   */
  _upsertPeerRegistry (key, updates = {}) {
    const registry = this._state.peers || {};
    const now = new Date().toISOString();
    const canonicalKey = updates.id || key;
    const existing = registry[canonicalKey] || registry[key];
    const base = existing ? { ...existing } : { id: canonicalKey, address: key.includes(':') ? key : undefined, score: 0, firstSeen: now, lastSeen: now };
    const merged = merge(base, updates);
    if (!merged.lastSeen) merged.lastSeen = now;
    registry[canonicalKey] = merged;
    if (key !== canonicalKey && registry[key]) delete registry[key];
    this._state.peers = registry;
    this._savePeerRegistry();
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
      this.emit('debug', `Filling peer slot ${i} of ${openCount} (max ${this.settings.constraints.peers.max}) with candidate: ${JSON.stringify(candidate, null, '  ')}`);

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

    // Verify message signature if we have the peer's public key
    if (origin && this.peers[origin] && this.peers[origin].publicKey) {
      const signer = new Key({ public: this.peers[origin].publicKey });
      if (!message.verifyWithKey(signer)) {
        this.emit('error', `Invalid message signature from ${origin}`);
        return;
      }
    }

    if (this.settings.debug) this.emit('debug', `Message author: ${message.raw.signature.toString('hex')}`);
    if (this.settings.debug) this.emit('debug', `Message signature: ${message.raw.signature.toString('hex')}`);

    switch (message.type) {
      default:
        this.emit('debug', `Unhandled message type: ${message.type}`);
        break;
      case 'GenericMessage':
      case 'PeerMessage':
      case 'ChatMessage':
        // this.emit('debug', `message ${message}`);
        // this.emit('debug', `message data: ${message.data}`);
        // Parse JSON body
        try {
          const content = JSON.parse(message.data);
          this._handleGenericMessage(content, origin, socket);
        } catch (exception) {
          this.emit('error', `Broken content body: ${exception}`);
        }

        break;
      // Lightning BOLT JSON payload fall-through (if any are sent with JSON bodies)
      case 'LightningWarning':
      case 'LightningInit':
      case 'LightningError':
      case 'LightningPing':
      case 'LightningPong':
      case 'OpenChannel':
      case 'AcceptChannel':
      case 'FundingCreated':
      case 'FundingSigned':
      case 'ChannelReady':
      case 'Shutdown':
      case 'ClosingSigned':
      case 'UpdateAddHTLC':
      case 'UpdateFulfillHTLC':
      case 'UpdateFailHTLC':
      case 'CommitmentSigned':
      case 'RevokeAndAck':
      case 'ChannelAnnouncement':
      case 'NodeAnnouncement':
      case 'ChannelUpdate':
        try {
          const content = JSON.parse(message.data);
          this.emit('lightning', { type: message.type, content, origin });
        } catch (e) {
          // If not JSON, emit raw buffer payload for lightning listeners
          this.emit('lightning', { type: message.type, raw: message.data, origin });
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
        const peerId = message.actor.id;
        const connAddress = origin.name;
        if (this.settings.debug) this.emit('debug', `Handling session offer: ${JSON.stringify(message.object)}`);
        if (this.settings.debug) this.emit('debug', `Session offer origin: ${JSON.stringify(origin)}`);

        // Same peer reconnecting from new port? Close old connection and replace with new
        const addressToId = this._addressToId || {};
        for (const [addr, id] of Object.entries(addressToId)) {
          if (id === peerId && addr !== connAddress) {
            const oldSocket = this.connections[addr];
            if (oldSocket) {
              if (oldSocket._keepalive) clearInterval(oldSocket._keepalive);
              delete this.connections[addr];
              delete this.peers[addr];
              delete this._addressToId[addr];
              if (typeof oldSocket.destroy === 'function') oldSocket.destroy();
            }
            break;
          }
        }

        this.peers[connAddress] = new Actor({
          id: peerId,
          name: connAddress,
          address: connAddress,
          connections: [ connAddress ]
        });

        this._upsertPeerRegistry(connAddress, { id: peerId, address: connAddress, lastSeen: new Date().toISOString() });
        this._addressToId[connAddress] = peerId;

        // Emit peer event
        this.emit('peer', this.peers[connAddress]);

        // Send session open event
        const vector = ['P2P_SESSION_OPEN', JSON.stringify({
          type: 'P2P_SESSION_OPEN',
          object: {
            initiator: message.actor.id,
            counterparty: this.identity.id,
            solution: message.object.challenge
          }
        })];

        const PACKET_SESSION_START = Message.fromVector(vector).signWithKey(this.key);
        const reply = PACKET_SESSION_START.toBuffer();
        if (this.settings.debug) this.emit('debug', `session_start ${PACKET_SESSION_START} ${reply.toString('hex')}`);
        this.connections[connAddress]._writeFabric(reply, socket);
        break;
      case 'P2P_SESSION_OPEN':
        if (this.settings.debug) this.emit('debug', `Handling session open: ${JSON.stringify(message.object)}`);
        const openPeerId = message.object.counterparty;
        this.peers[origin.name] = { id: openPeerId, name: origin.name, address: origin };
        this._upsertPeerRegistry(origin.name, { id: openPeerId, address: origin.name, lastSeen: new Date().toISOString() });
        this._addressToId[origin.name] = openPeerId;
        // Don't emit peer event here - it's already emitted in P2P_SESSION_OFFER
        break;
      case 'P2P_CHAT_MESSAGE':
        this.emit('chat', message);
        const relay = Message.fromVector(['ChatMessage', JSON.stringify(message)]);
        relay.signWithKey(this.key);
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
        const newScore = (instance.score || 0) + 1;

        this.actors[actor.id].adopt([
          { op: 'replace', path: '/score', value: newScore }
        ]);

        this._state.content.actors[actor.id] = this.actors[actor.id].state;
        this.commit();

        const registry = this._state.peers || {};
        const pongPeerId = (this._addressToId && this._addressToId[origin.name]) || origin.name;
        const regEntry = registry[pongPeerId] || registry[origin.name];
        this._upsertPeerRegistry(pongPeerId, { id: pongPeerId, address: origin.name, score: (regEntry && regEntry.score != null ? regEntry.score : 0) + 1, lastSeen: new Date().toISOString() });

        if (this.settings.debug) this.emit('debug', `Received pong: ${JSON.stringify(message, null, '  ')}`);
        this.emit('state', this.state);

        break;
      case 'P2P_PEER_ALIAS':
        this.emit('debug', `peer_alias ${origin.name} <Generic>${JSON.stringify(message.object || '')}`);
        this.connections[origin.name]._alias = message.object.name;
        const aliasPeerId = (this._addressToId && this._addressToId[origin.name]) || origin.name;
        this._upsertPeerRegistry(aliasPeerId, { id: aliasPeerId, address: origin.name, alias: message.object && message.object.name });
        // const alias = Message.fromVector(['PeerAlias', JSON.stringify(message)]);
        // this.relayFrom(origin.name, alias);
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
      case 'P2P_FILE_SEND':
        this.emit('file', { message, origin });
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
    // const counterparty = new Identity({ public: remotePublicKey.toString('hex') });
    this.emit('debug', `Peer transport handshake using local key: ${localPrivateKey.toString('hex')}`);
    this.emit('debug', `Peer transport handshake using local public key: ${localPublicKey.toString('hex')}`);
    this.emit('debug', `Peer transport handshake with remote public key: ${remotePublicKey.toString('hex')}`);
    // this.emit('debug', `Peer transport handshake with remote identity: ${counterparty.id}`);
  }

  _NOISESocketHandler (socket) {
    const target = `${socket.remoteAddress}:${socket.remotePort}`;
    const url = `tcp://${target}`;

    // Store a unique actor for this inbound connection
    this._registerActor({ name: target });

    // this.emit('debug', `Local NOISE key: ${JSON.stringify(this.identity.key, null, '  ')}`);
    const derived = this.identity.key.derive(FABRIC_KEY_DERIVATION_PATH);
    this.emit('debug', `Derived NOISE key: ${derived.private.toString('hex')}`);

    // Create NOISE handler
    const handler = noise({
      prologue: Buffer.from(PROLOGUE),
      // privateKey: derived.private.toString('hex'),
      verify: this._verifyNOISE.bind(this)
    });

    // Handle low-level socket errors for inbound connections
    socket.on('error', (error) => {
      this.emit('debug', `--- debug error from _NOISESocketHandler() ---`);
      if (error && (error.code === 'EPIPE' || error.code === 'ECONNRESET')) {
        this.emit('warning', `Suppressing transient inbound socket error (${error.code}) from _NOISESocketHandler().`);
      } else {
        this.emit('error', `Inbound socket error: ${error}`);
      }
    });

    // Set up NOISE event handlers
    handler.encrypt.on('handshake', this._handleNOISEHandshake.bind(this));
    handler.encrypt.on('error', (error) => {
      if (error && (error.code === 'EPIPE' || error.code === 'ECONNRESET')) {
        this.emit('warning', `Suppressing transient NOISE encrypt error (${error.code}).`);
      } else {
        this.emit('error', `NOISE encrypt error: ${error}`);
      }
    });

    handler.encrypt.on('end', (data) => {
      this.emit('debug', `Peer encrypt end: ${data}`);
      // socket.destroy();
      delete this.connections[target];
      this.peers[target].status = 'disconnected';
    });

    handler.decrypt.on('error', (error) => {
      if (error && (error.code === 'EPIPE' || error.code === 'ECONNRESET')) {
        this.emit('warning', `Suppressing transient NOISE decrypt error (${error.code}).`);
      } else {
        this.emit('error', `NOISE decrypt error: ${error}`);
      }
    });

    handler.decrypt.on('close', (data) => {
      this.emit('debug', `Peer decrypt close: ${data}`);
    });

    handler.decrypt.on('end', (data) => {
      this.emit('debug', `Peer decrypt end: (${target}) ${data}`);
      this.emit('debug', `Connections: ${Object.keys(this.connections)}`);
      socket._destroyFabric();
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

    /* actor.adopt([
      { op: 'replace', path: '/status', value: 'REGISTERED' }
    ]); */

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
        if (exception && (exception.code === 'EPIPE' || exception.code === 'ECONNRESET')) {
          this.emit('warning', `Suppressing transient write error (${exception.code}) during ping.`);
        } else {
          this.emit('debug', `Cannot write ping: ${exception}`);
        }
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

    this.emit('debug', `Scheduled: ${reconnect}`);
  }

  _selectBestPeerCandidate () {
    const candidates = [];

    for (const id of Object.entries(this.peers)) {
      candidates.push(id);
    }

    candidates.sort((a, b) => {
      return (a.score > b.score) ? 1 : 0;
    });

    return candidates[0] || null;
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
    if (!stream || !stream.encrypt) return;

    const encrypt = stream.encrypt;
    const isWritable = (encrypt.writable !== false) && !encrypt.writableEnded && !encrypt.destroyed;

    if (!isWritable) {
      this.emit('warning', 'Attempted to write to a closed or destroyed stream; skipping.');
      return;
    }

    try {
      encrypt.write(msg);
    } catch (error) {
      if (error && (error.code === 'EPIPE' || error.code === 'ECONNRESET')) {
        this.emit('warning', `Suppressing transient write error (${error.code}) during NOISE write.`);
      } else {
        this.emit('error', error);
      }
    }
  }

  /**
   * Start the Peer.
   */
  async start () {
    await this._loadPeerRegistry();

    // Log settings at start
    if (this.settings.debug) {
      this.emit('debug', `[FABRIC:PEER:START] networking: ${this.settings.networking}`);
      this.emit('debug', `[FABRIC:PEER:START] peers: ${JSON.stringify(this.settings.peers)}`);
    }

    let address = null;
    this.emit('log', 'Peer starting...');

    // Ensure initial peers from config are in the registry
    if (this.settings.peers && Array.isArray(this.settings.peers)) {
      for (const candidate of this.settings.peers) {
        this._upsertPeerRegistry(candidate, { address: candidate });
      }
    }

    if (this.settings.debug) {
      this.emit('debug', `[FABRIC:PEER] Listening on port: ${this.settings.port}`);
      this.emit('debug', `[FABRIC:PEER] Peer list: ${JSON.stringify(this.settings.peers)}`);
    }

    this._registerActor({ name: `${this.interface}:${this.port}` });

    if (this.settings.listen) {
      this.emit('log', 'Listener starting...');
      console.debug('Starting listener on', this.interface, this.port);

      try {
        address = await this.listen();
        console.debug('got address:', address)
        this.listenAddress = address;
        this.emit('log', 'Listener started!');
      } catch (exception) {
        this.emit('error', 'Could not listen:', exception);
        throw new Error('Peer failed to listen: ' + (exception && exception.message ? exception.message : exception));
      }
    }

    if (this.settings.networking && this.settings.peers && this.settings.peers.length) {
      this.emit('warning', `Networking enabled.  Connecting to peers: ${JSON.stringify(this.settings.peers)}`);
      for (const candidate of this.settings.peers) {
        this.emit('debug', `[FABRIC:PEER] Connecting to peer: ${candidate}`);
        try {
          this._connect(candidate);
          this.emit('debug', `[FABRIC:PEER] Connection attempt initiated for: ${candidate}`);
        } catch (error) {
          this.emit('error', `[FABRIC:PEER] Failed to initiate connection to ${candidate}: ${error.message}`);
        }
      }
    }

    // Reconnect to known peers from the persistent registry (if not already connected).
    // Only do this when a persistent registry is configured and the caller hasn't provided
    // an explicit peer list (prevents duplicate outbound connects and avoids test hangs).
    if (
      this.settings.networking !== false &&
      this.settings.reconnectToKnownPeers !== false &&
      this.settings.peersDb &&
      (!this.settings.peers || this.settings.peers.length === 0) &&
      this._state.peers &&
      typeof this._state.peers === 'object'
    ) {
      const registry = this._state.peers;
      const toReconnect = Object.keys(registry).filter((addr) => {
        if (this.connections[addr]) return false;
        const listenAddr = this.listenAddress || `${this.interface}:${this.port}`;
        if (addr === listenAddr) return false;
        return true;
      });
      if (toReconnect.length > 0) {
        this.emit('debug', `[FABRIC:PEER] Reconnecting to ${toReconnect.length} known peers from registry`);
        toReconnect.forEach((addr, i) => {
          setTimeout(() => {
            try {
              this._connect(addr);
              this.emit('debug', `[FABRIC:PEER] Reconnect attempt for: ${addr}`);
            } catch (err) {
              this.emit('debug', `[FABRIC:PEER] Reconnect failed for ${addr}: ${err && err.message}`);
            }
          }, i * 150);
        });
      }
    }

    if (this.settings.debug) this.emit('debug', `Observing state...`);

    try {
      this.observer = manager.observe(this._state.content);
    } catch (exception) {
      this.emit('error', `Could not observe state: ${exception}`);
    }

    await this._startHeart();

    if (this.settings.debug) this.emit('debug', `Peer ready!  State: ${JSON.stringify(this.state, null, '  ')}`);

    this.emit('ready', {
      id: this.id,
      address: address,
      pubkey: this.key.pubkey
    });

    if (this.settings.debug) this.emit('debug', `Peer started!`);

    /*
    const PACKET_PEER_ANNOUNCE = Message.fromVector(['P2P_PEER_ANNOUNCE', JSON.stringify({
      type: 'P2P_PEER_ANNOUNCE',
      object: {
        host: this._externalIP,
        port: this.settings.port
      }
    })]).signWithKey(this.key);
    const announcement = PACKET_PEER_ANNOUNCE.toBuffer();
    // this.emit('debug', `Announcing peer: ${announcement.toString('utf8')}`);
    this.connections[origin.name]._writeFabric(announcement, socket);
    */

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

    this.emit('debug', 'Closing all connections...');
    for (const id in this.connections) {
      this.connections[id].destroy();
    }

    // Cancel pending registry save and close LevelDB
    if (this._peerRegistrySaveScheduled) clearTimeout(this._peerRegistrySaveScheduled);
    if (this._peersDb) {
      try {
        await this._peersDb.close();
      } catch (e) { /* ignore */ }
      this._peersDb = null;
    }

    const terminator = async () => {
      return new Promise((resolve, reject) => {
        // Always attempt to close the server, even if address() returns null
        // This ensures cleanup even if the server failed to start properly
        if (!this.server || typeof this.server.close !== 'function') {
          return resolve();
        }

        // Check if server is listening
        const address = this.server.address();
        if (!address) {
          // Server not listening, but still try to close to be safe
          // Some server states might not have address() but still need cleanup
          try {
            this.server.close(() => resolve());
          } catch (error) {
            // If close fails, it's likely already closed - resolve anyway
            resolve();
          }
          return;
        }

        // Server is listening, close it properly
        return this.server.close(function serverClosed (error) {
          // Ignore errors if server wasn't running or already closed
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
            return reject(error);
          }
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
    this.emit('debug', `Disconnect request for address: ${address}`);
    const socket = this.connections[address];
    if (!socket) return false;

    if (socket._keepalive) clearInterval(socket._keepalive);
    if (socket.heartbeat) clearInterval(socket.heartbeat);
    delete this.connections[address];
    delete this.peers[address];
    if (typeof socket.destroy === 'function') socket.destroy();

    this._upsertPeerRegistry(address, { lastSeen: new Date().toISOString() });

    this.emit('connections:close', { address, name: address });
    return true;
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
      console.debug('Listening on', this.interface, this.port);

      // Handle server errors before attempting to listen
      const errorHandler = (error) => {
        if (error.code === 'EADDRINUSE') {
          this.emit('error', `Port ${this.port} is already in use. Please stop the process using this port or use a different port.`);
          reject(error);
        } else {
          this.emit('error', `Server socket error: ${error}`);
          // Don't reject on other errors during listen, let the callback handle it
        }
      };

      this.server.once('error', errorHandler);

      this.server.listen(this.port, this.interface, (error) => {
        // Remove the error handler since we're handling the result here
        this.server.removeListener('error', errorHandler);

        if (error) {
          if (error.code === 'EADDRINUSE') {
            this.emit('error', `Port ${this.port} is already in use. Please stop the process using this port or use a different port.`);
          }
          return reject(error);
        }

        const details = this.server.address();
        const address = `${details.address}:${details.port}`;

        this.emit('log', `Now listening on tcp://${address} [!!!]`);
        return resolve(address);
      });

      // Keep a general error handler for runtime errors
      this.server.on('error', (error) => {
        if (error.code !== 'EADDRINUSE') {
          this.emit('error', `Server socket error: ${error}`);
        }
      });
    });
  }
}

module.exports = Peer;
