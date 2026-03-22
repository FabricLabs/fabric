'use strict';

// Constants
const {
  FABRIC_KEY_DERIVATION_PATH,
  GOSSIP_MAX_HOPS,
  GOSSIP_MAX_PAYLOAD_CACHE,
  GOSSIP_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
  MAX_PEERS,
  PEERING_OFFER_MAX_HOPS,
  PEERING_OFFER_MAX_PAYLOAD_CACHE,
  PEERING_OFFER_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
  PEER_MAX_CANDIDATES_QUEUE,
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_PEER_GOSSIP,
  P2P_PEERING_OFFER,
  PEER_MAX_WIRE_HASH_CACHE,
  P2P_ROOT,
  P2P_PING,
  P2P_PONG,
  P2P_PORT,
  P2P_START_CHAIN,
  P2P_CHAIN_SYNC_REQUEST,
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
const Hash256 = require('./hash256');
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
      /** Limits relay amplification on {@link P2P_PEER_GOSSIP} (hop TTL, payload dedup, per-origin rate). */
      gossip: {
        maxHops: GOSSIP_MAX_HOPS,
        maxRelaysPerOriginPerMinute: GOSSIP_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
        maxPayloadCache: GOSSIP_MAX_PAYLOAD_CACHE,
        maxWireHashCache: PEER_MAX_WIRE_HASH_CACHE
      },
      state: Object.assign({
        actors: {},
        channels: {},
        contracts: {},
        documents: {},
        messages: {},
        services: {}
      }, config.state),
      upnp: false,
      key: {},
      /**
       * Inbound wire traffic budgeting (Bitcoin Core–style peer quality).
       * Credits accrue per rolling window; overflow de-ranks the peer (registry score)
       * and drops the message. Heavier opcodes cost more credits.
       */
      wireTraffic: {
        windowMs: 60 * 1000,
        maxCreditsPerWindow: 520,
        chainSyncCreditCost: 55,
        bitcoinBlockCreditCost: 3,
        defaultCreditCost: 1,
        overLimitPenalty: 22
      }
    }, config);

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
    /** Wire-envelope dedup (SHA-256 of full buffer); FIFO-capped via {@link Peer#_rememberWireHash}. */
    this.messages = {};
    this._wireHashOrder = [];
    /** Logical gossip payload dedup (excludes signature / hop churn). */
    this._gossipPayloadSeen = new Map();
    this._gossipPayloadOrder = [];
    /** origin address → { count, windowStart } for gossip relay rate limiting. */
    this._gossipRelayByOrigin = new Map();
    /** Logical peering-offer payload dedup (ignores per-hop re-signing). */
    this._peeringPayloadSeen = new Map();
    this._peeringPayloadOrder = [];
    /** origin address → { count, windowStart } for peering-offer relay rate limiting. */
    this._peeringRelayByOrigin = new Map();
    /** `host:port` → { credits, windowStart, penalized } — inbound wire flood / de-rank (per peer). */
    this._wireInboundByOrigin = new Map();
    /** `host:port` keys for {@link P2P_PEERING_OFFER} candidate queue dedup. */
    this._candidateKeys = new Set();
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

  /**
   * Stable id for gossip *logical* content (ignores `gossipHop` and wire signature changes).
   * @param {object} msg Generic message (`type`, `object`, …)
   * @returns {string} hex sha256
   */
  _gossipPayloadDedupKey (msg) {
    const obj = (msg && msg.object && typeof msg.object === 'object') ? { ...msg.object } : {};
    delete obj.gossipHop;
    const body = JSON.stringify({ type: msg && msg.type, object: obj });
    return crypto.createHash('sha256').update(body).digest('hex');
  }

  _rememberWireHash (hash) {
    const max = (this.settings.gossip && this.settings.gossip.maxWireHashCache) || PEER_MAX_WIRE_HASH_CACHE;
    while (this._wireHashOrder.length >= max) {
      const drop = this._wireHashOrder.shift();
      delete this.messages[drop];
    }
    this.messages[hash] = true;
    this._wireHashOrder.push(hash);
  }

  _gossipRememberPayload (key) {
    const max = (this.settings.gossip && this.settings.gossip.maxPayloadCache) || GOSSIP_MAX_PAYLOAD_CACHE;
    while (this._gossipPayloadOrder.length >= max) {
      const drop = this._gossipPayloadOrder.shift();
      this._gossipPayloadSeen.delete(drop);
    }
    this._gossipPayloadSeen.set(key, true);
    this._gossipPayloadOrder.push(key);
  }

  /**
   * @param {string} originName Connection id (e.g. `host:port`)
   * @returns {boolean}
   */
  _gossipRateLimitAllow (originName) {
    const limit = (this.settings.gossip && this.settings.gossip.maxRelaysPerOriginPerMinute) || GOSSIP_MAX_RELAYS_PER_ORIGIN_PER_MINUTE;
    const now = Date.now();
    let slot = this._gossipRelayByOrigin.get(originName);
    if (!slot || now - slot.windowStart > 60000) {
      slot = { count: 0, windowStart: now };
    }
    if (slot.count >= limit) return false;
    slot.count++;
    this._gossipRelayByOrigin.set(originName, slot);
    return true;
  }

  /**
   * Credit cost for inbound wire messages (heavier types consume more of the peer's budget).
   * @param {string|number} wireType
   * @returns {number}
   */
  _wireInboundCreditCost (wireType) {
    const w = this.settings.wireTraffic || {};
    const t = wireType != null ? String(wireType) : '';
    if (t === 'P2P_CHAIN_SYNC_REQUEST' || t === 'ChainSyncRequest' || wireType === P2P_CHAIN_SYNC_REQUEST) {
      return Number(w.chainSyncCreditCost) || 55;
    }
    if (t === 'BITCOIN_BLOCK' || t === 'BitcoinBlock') {
      return Number(w.bitcoinBlockCreditCost) || 3;
    }
    return Number(w.defaultCreditCost) || 1;
  }

  /**
   * Apply rolling-window credits; on overflow, de-rank once per window and reject the message.
   * @param {string} originName connection key (host:port)
   * @param {number} creditCost
   * @returns {boolean} false = drop message
   */
  _wireInboundRateAllowPeer (originName, creditCost) {
    if (!originName) return true;
    const w = this.settings.wireTraffic || {};
    const windowMs = Number(w.windowMs) || 60000;
    const maxCredits = Number(w.maxCreditsPerWindow) || 520;
    const penalty = Number(w.overLimitPenalty) || 22;
    const now = Date.now();
    const cost = Number.isFinite(creditCost) && creditCost > 0 ? creditCost : 1;
    let slot = this._wireInboundByOrigin.get(originName);
    if (!slot || (now - slot.windowStart) >= windowMs) {
      slot = { credits: 0, windowStart: now, penalized: false };
    }
    const next = slot.credits + cost;
    if (next > maxCredits) {
      if (!slot.penalized) {
        slot.penalized = true;
        this._derankPeerForWireTraffic(originName, penalty, 'inbound-rate');
      }
      this._wireInboundByOrigin.set(originName, slot);
      return false;
    }
    slot.credits = next;
    this._wireInboundByOrigin.set(originName, slot);
    return true;
  }

  /**
   * Lower registry {@link Peer#knownPeers} score for a connection (Bitcoin Core misbehavior analogue).
   * @param {string} originName
   * @param {number} penalty
   * @param {string} reason
   */
  _derankPeerForWireTraffic (originName, penalty, reason) {
    const peerId = (this._addressToId && this._addressToId[originName]) || originName;
    const registry = this._state.peers || {};
    const reg = registry[peerId] || registry[originName] || {};
    const cur = Number(reg.score);
    const base = Number.isFinite(cur) ? cur : 0;
    const pen = Number.isFinite(penalty) && penalty > 0 ? penalty : 20;
    const next = Math.max(0, base - pen);
    this._upsertPeerRegistry(peerId, {
      id: peerId,
      address: reg.address || originName,
      score: next,
      lastSeen: new Date().toISOString()
    });
    this.emit('warning', `[FABRIC:PEER] De-ranked peer (${reason}): ${peerId} score ${base}→${next}`);
  }

  /**
   * Stable id for peering-offer *logical* content (ignores `peeringHop` and wire signature changes).
   * @param {object} msg Generic message (`type`, `object`, …)
   * @returns {string} hex sha256
   */
  _peeringOfferPayloadDedupKey (msg) {
    const obj = (msg && msg.object && typeof msg.object === 'object') ? { ...msg.object } : {};
    delete obj.peeringHop;
    const body = JSON.stringify({ type: msg && msg.type, object: obj });
    return crypto.createHash('sha256').update(body).digest('hex');
  }

  _peeringRememberPayload (key) {
    const max = (this.settings.peering && this.settings.peering.maxPayloadCache) || PEERING_OFFER_MAX_PAYLOAD_CACHE;
    while (this._peeringPayloadOrder.length >= max) {
      const drop = this._peeringPayloadOrder.shift();
      this._peeringPayloadSeen.delete(drop);
    }
    this._peeringPayloadSeen.set(key, true);
    this._peeringPayloadOrder.push(key);
  }

  /**
   * @param {string} originName Connection id (e.g. `host:port`)
   * @returns {boolean}
   */
  _peeringRateLimitAllow (originName) {
    const limit = (this.settings.peering && this.settings.peering.maxRelaysPerOriginPerMinute) || PEERING_OFFER_MAX_RELAYS_PER_ORIGIN_PER_MINUTE;
    const now = Date.now();
    let slot = this._peeringRelayByOrigin.get(originName);
    if (!slot || now - slot.windowStart > 60000) {
      slot = { count: 0, windowStart: now };
    }
    if (slot.count >= limit) return false;
    slot.count++;
    this._peeringRelayByOrigin.set(originName, slot);
    return true;
  }

  /**
   * Enqueue a fabric candidate from {@link P2P_PEERING_OFFER}; FIFO-capped and deduped by host:port.
   * @param {string} host
   * @param {number} port
   */
  _enqueuePeeringCandidate (host, port) {
    const max = (this.settings.peering && this.settings.peering.maxCandidates) || PEER_MAX_CANDIDATES_QUEUE;
    const key = `${String(host)}:${Number(port)}`;
    if (this._candidateKeys.has(key)) return;
    while (this.candidates.length >= max) {
      const old = this.candidates.shift();
      const o = old && (old.object || old);
      if (o && o.host != null && o.port != null) {
        this._candidateKeys.delete(`${String(o.host)}:${Number(o.port)}`);
      }
    }
    this._candidateKeys.add(key);
    this.candidates.push({ host, port: Number(port) });
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
    const p = this.settings.port;
    return (typeof p === 'number' && !Number.isNaN(p)) ? p : 7777;
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
    if (this.settings.debug) this.emit('debug', `Broadcasting message (${message && message.length ? message.length : 0} bytes)`);
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
    if (this._state.status === 'STOPPING' || this._state.status === 'STOPPED') return;

    if (this._peerRegistrySaveScheduled) clearTimeout(this._peerRegistrySaveScheduled);

    this._peerRegistrySaveScheduled = setTimeout(() => {
      this._peerRegistrySaveScheduled = null;
      if (this._state.status === 'STOPPING' || this._state.status === 'STOPPED') return;
      this._peersDb = this._peersDb || new Level(location);
      // Avoid noisy errors from writes scheduled while DB is closing/closed.
      if (this._peersDb && this._peersDb.status && this._peersDb.status !== 'open') return;
      const payload = JSON.stringify(this._state.peers || {});
      this._peersDb.put('peers', payload)
        .then(() => { if (this.settings.debug) this.emit('debug', '[FABRIC:PEER] Saved peer registry'); })
        .catch((err) => {
          const message = err && err.message ? err.message : String(err);
          if (message.includes('Database is not open')) return;
          this.emit('error', `Failed to save peer registry: ${message}`);
        });
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
        const host = candidate.object ? candidate.object.host : candidate.host;
        const port = candidate.object ? candidate.object.port : candidate.port;
        this._connect(`${host}:${port}`);
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

    this._rememberWireHash(hash);

    // Body integrity: `hash` header is double-SHA256(body). `preimage` is single SHA256(body) for
    // non-sensitive sends, all-zero for sensitive, or an explicit HTLC secret — preimage is covered
    // by the Schnorr signature; do not require preimage === SHA256(body) here (HTLC secrets differ).
    const bodyBuf = message.raw.data || Buffer.alloc(0);
    const checksum = Hash256.doubleDigest(bodyBuf);
    const expectedHash = Buffer.isBuffer(message.raw.hash) ? message.raw.hash.toString('hex') : message.raw.hash;
    if (checksum !== expectedHash) {
      const from = (origin && origin.name) ? origin.name : 'unknown';
      const t = message.type || '?';
      const hint = this.settings.debug
        ? ` wire=${String(expectedHash).slice(0, 16)}… computed=${String(checksum).slice(0, 16)}…`
        : '';
      this.emit('warning', `[FABRIC:PEER] Dropping message (body hash mismatch): from=${from} type=${t}${hint}`);
      return this;
    }

    // Verify message signature if we have the peer's public key (origin is `{ name }` from sockets)
    const peerKey = origin && (origin.name != null ? origin.name : origin);
    const peerRecord = peerKey && this.peers[peerKey];
    if (peerRecord && peerRecord.publicKey) {
      const signer = new Key({ public: peerRecord.publicKey });
      if (!message.verifyWithKey(signer)) {
        this.emit('error', `Invalid message signature from ${peerKey}`);
        return;
      }
    }

    if (origin && origin.name) {
      const cost = this._wireInboundCreditCost(message.type);
      if (!this._wireInboundRateAllowPeer(origin.name, cost)) {
        if (this.settings.debug) {
          this.emit('debug', `[FABRIC:PEER] Dropped (wire traffic budget): ${origin.name} type=${message.type}`);
        }
        return this;
      }
    }

    if (this.settings.debug) this.emit('debug', `Message author: ${message.raw.signature.toString('hex')}`);
    if (this.settings.debug) this.emit('debug', `Message signature: ${message.raw.signature.toString('hex')}`);

    switch (message.type) {
      default:
        this.emit('debug', `Unhandled message type: ${message.type}`);
        break;
      case 'P2P_RELAY':
        this.relayFrom(origin.name, message);
        break;
      case 'BITCOIN_BLOCK':
      case 'BitcoinBlock':
        // Chain-tip gossip: relay so sparse meshes learn Bitcoin network tip (hash/preimage/signature as any AMP message).
        this.emit('bitcoinBlock', { message, origin, socket });
        if (origin && origin.name) this.relayFrom(origin.name, message);
        break;
      case 'P2P_CHAIN_SYNC_REQUEST':
      case 'ChainSyncRequest':
        if (!origin || !origin.name) break;
        try {
          const raw = message.data != null
            ? (typeof message.data === 'string' ? message.data : String(message.data))
            : '{}';
          const object = JSON.parse(raw || '{}');
          this.emit('chainSyncRequest', { message, origin, socket, object });
        } catch (parseErr) {
          this.emit('chainSyncRequest', { message, origin, socket, object: {} });
        }
        break;
      case 'GENERIC_MESSAGE':
      case 'GenericMessage':
      case 'P2P_BASE_MESSAGE':
      case 'PeerMessage':
      case 'CHAT_MESSAGE':
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
      case 'LIGHTNING_WARNING':
      case 'LightningWarning':
      case 'LIGHTNING_INIT':
      case 'LightningInit':
      case 'LIGHTNING_ERROR':
      case 'LightningError':
      case 'LIGHTNING_PING':
      case 'LightningPing':
      case 'LIGHTNING_PONG':
      case 'LightningPong':
      case 'LIGHTNING_OPEN_CHANNEL':
      case 'OpenChannel':
      case 'LIGHTNING_ACCEPT_CHANNEL':
      case 'AcceptChannel':
      case 'LIGHTNING_FUNDING_CREATED':
      case 'FundingCreated':
      case 'LIGHTNING_FUNDING_SIGNED':
      case 'FundingSigned':
      case 'LIGHTNING_CHANNEL_READY':
      case 'ChannelReady':
      case 'LIGHTNING_SHUTDOWN':
      case 'Shutdown':
      case 'LIGHTNING_CLOSING_SIGNED':
      case 'ClosingSigned':
      case 'LIGHTNING_UPDATE_ADD_HTLC':
      case 'UpdateAddHTLC':
      case 'LIGHTNING_UPDATE_FULFILL_HTLC':
      case 'UpdateFulfillHTLC':
      case 'LIGHTNING_UPDATE_FAIL_HTLC':
      case 'UpdateFailHTLC':
      case 'LIGHTNING_COMMITMENT_SIGNED':
      case 'CommitmentSigned':
      case 'LIGHTNING_REVOKE_AND_ACK':
      case 'RevokeAndAck':
      case 'LIGHTNING_CHANNEL_ANNOUNCEMENT':
      case 'ChannelAnnouncement':
      case 'LIGHTNING_NODE_ANNOUNCEMENT':
      case 'NodeAnnouncement':
      case 'LIGHTNING_CHANNEL_UPDATE':
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
      case 'INVENTORY_REQUEST':
        // Upstream Inventory request (typically for documents). Emit an 'inventory'
        // event so higher-level services (e.g. hub) can respond appropriately.
        this.emit('inventory', { message, origin, socket });
        break;
      case 'INVENTORY_RESPONSE':
        // Document inventory reply (may include per-item L1 HTLC offers).
        this.emit('inventoryResponse', { message, origin, socket });
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
      case P2P_PEER_GOSSIP: {
        if (!origin || !origin.name) break;
        const g = this.settings.gossip || {};
        const maxHops = g.maxHops != null ? g.maxHops : GOSSIP_MAX_HOPS;
        const payloadKey = this._gossipPayloadDedupKey(message);
        if (this._gossipPayloadSeen.has(payloadKey)) break;
        const obj = message.object || {};
        let hop = obj.gossipHop != null ? Number(obj.gossipHop) : maxHops;
        if (!Number.isFinite(hop) || hop < 0) hop = maxHops;
        hop = Math.min(hop, maxHops);
        if (hop <= 0) break;
        if (!this._gossipRateLimitAllow(origin.name)) break;
        this.emit('peeringGossip', { message, origin });
        this._gossipRememberPayload(payloadKey);
        const relayBody = Object.assign({}, message, {
          object: Object.assign({}, obj, { gossipHop: hop - 1 })
        });
        const gossipRelay = Message.fromVector(['GENERIC', JSON.stringify(relayBody)]).signWithKey(this.key);
        this.relayFrom(origin.name, gossipRelay);
        break;
      }
      case P2P_PEERING_OFFER: {
        if (!origin || !origin.name) break;
        const p = this.settings.peering || {};
        const maxHops = p.maxHops != null ? p.maxHops : PEERING_OFFER_MAX_HOPS;
        const payloadKey = this._peeringOfferPayloadDedupKey(message);
        if (this._peeringPayloadSeen.has(payloadKey)) break;
        const obj = message.object || {};
        let hop = obj.peeringHop != null ? Number(obj.peeringHop) : maxHops;
        if (!Number.isFinite(hop) || hop < 0) hop = maxHops;
        hop = Math.min(hop, maxHops);
        if (hop <= 0) break;
        if (!this._peeringRateLimitAllow(origin.name)) break;
        this.emit('peeringOffer', { message, origin });
        this._peeringRememberPayload(payloadKey);
        const transport = obj.transport || 'fabric';
        if (transport === 'fabric' && obj.host && obj.port) {
          const connCount = Object.keys(this.connections || {}).length;
          const maxPeers = (this.settings.constraints && this.settings.constraints.peers && this.settings.constraints.peers.max) || MAX_PEERS;
          if (connCount < maxPeers) {
            this._enqueuePeeringCandidate(obj.host, obj.port);
          }
        }
        const relayBody = Object.assign({}, message, {
          object: Object.assign({}, obj, { peeringHop: hop - 1 })
        });
        const offerRelay = Message.fromVector(['GENERIC', JSON.stringify(relayBody)]).signWithKey(this.key);
        this.relayFrom(origin.name, offerRelay);
        break;
      }
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

  _handleNOISEHandshake (_localPrivateKey, localPublicKey, remotePublicKey) {
    if (this.settings.debug) {
      // Never log private key material — public keys only for transport diagnostics.
      this.emit('debug', `Peer transport handshake using local public key: ${localPublicKey.toString('hex')}`);
      this.emit('debug', `Peer transport handshake with remote public key: ${remotePublicKey.toString('hex')}`);
    }
  }

  _NOISESocketHandler (socket) {
    const target = `${socket.remoteAddress}:${socket.remotePort}`;
    const url = `tcp://${target}`;

    // Store a unique actor for this inbound connection
    this._registerActor({ name: target });

    const derived = this.identity.key.derive(FABRIC_KEY_DERIVATION_PATH);
    if (this.settings.debug) {
      this.emit('debug', 'NOISE inbound: session key derived for handshake (private key not logged)');
    }

    // Create NOISE handler
    const handler = noise({
      prologue: Buffer.from(PROLOGUE),
      // privateKey: derived.private.toString('hex'),
      verify: this._verifyNOISE.bind(this)
    });

    // Handle low-level socket errors for inbound connections
    socket.on('error', (error) => {
      if (this.settings.debug) this.emit('debug', `--- debug error from _NOISESocketHandler() ---`);
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
      if (this.settings.debug) this.emit('debug', `Peer encrypt end: ${data}`);
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
      if (this.settings.debug) this.emit('debug', `Peer decrypt close: ${data}`);
    });

    handler.decrypt.on('end', (data) => {
      if (this.settings.debug) {
        this.emit('debug', `Peer decrypt end: (${target}) ${data}`);
        this.emit('debug', `Connections: ${Object.keys(this.connections)}`);
      }
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
    this._rememberWireHash(hash);
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
      if (this.settings.debug) console.debug('Starting listener on', this.interface, this.port);

      try {
        address = await this.listen();
        if (this.settings.debug) console.debug('got address:', address);
        this.listenAddress = address;
        this.emit('log', 'Listener started!');
      } catch (exception) {
        // Do not emit('error') here — with no listener Node throws ERR_UNHANDLED_ERROR; callers get the throw below.
        this.emit('warning', 'Could not listen:', exception);
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
      const c = this.connections[id];
      if (c && typeof c.destroy === 'function') c.destroy();
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
      if (this.settings.debug) console.debug('Listening on', this.interface, this.port);

      // Handle server errors before attempting to listen
      const errorHandler = (error) => {
        if (error.code === 'EADDRINUSE') {
          // Don't emit('error') here - caller gets rejection; emit would cause ERR_UNHANDLED_ERROR if no listener
          this.server.close(() => reject(error));
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
          // Don't emit('error') for EADDRINUSE - caller gets rejection; emit would cause ERR_UNHANDLED_ERROR if no listener
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

class Swarm extends Actor {
  constructor (config = {}) {
    super(config);

    this.name = 'Swarm';
    this.settings = Object.assign({
      name: 'fabric',
      seeds: [],
      peers: [],
      contract: 0xC0D3F33D
    }, config);

    this.agent = new Peer(this.settings);

    this.nodes = {};
    this.peers = {};

    return this;
  }

  broadcast (msg) {
    if (this.settings.verbosity >= 5) console.log('broadcasting:', msg);
    this.agent.broadcast(msg);
  }

  connect (address) {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:SWARM]', `Connecting to: ${address}`);

    try {
      this.agent._connect(address);
    } catch (E) {
      this.error('Error connecting:', E);
    }
  }

  trust (source) {
    super.trust(source);
    const swarm = this;

    swarm.agent.on('ready', function (agent) {
      swarm.emit('agent', agent);
    });

    swarm.agent.on('message', function (message) {
      swarm.emit('message', message);
    });

    swarm.agent.on('state', function (state) {
      console.log('[FABRIC:SWARM]', 'Received state from agent:', state);
      swarm.emit('state', state);
    });

    swarm.agent.on('change', function (change) {
      console.log('[FABRIC:SWARM]', 'Received change from agent:', change);
      swarm.emit('change', change);
    });

    swarm.agent.on('patches', function (patches) {
      console.log('[FABRIC:SWARM]', 'Received patches from agent:', patches);
      swarm.emit('patches', patches);
    });

    swarm.agent.on('peer', function (peer) {
      console.log('[FABRIC:SWARM]', 'Received peer from agent:', peer);
      swarm._registerPeer(peer);
    });

    swarm.agent.on('connections:open', function (connection) {
      swarm.emit('connections:open', connection);
    });

    swarm.agent.on('connections:close', function (connection) {
      swarm.emit('connections:close', connection);
      swarm._fillPeerSlots();
    });

    swarm.agent.on('collections:post', function (message) {
      swarm.emit('collections:post', message);
    });

    swarm.agent.on('socket:data', function (message) {
      swarm.emit('socket:data', message);
    });

    swarm.agent.on('ready', function (info) {
      swarm.log(`swarm is ready (${info.id})`);
      swarm.emit('ready');
      swarm._fillPeerSlots();
    });

    return this;
  }

  _broadcastTypedMessage (type, msg) {
    if (!type) return new Error('Message type must be supplied.');
    this.agent._broadcastTypedMessage(type, msg);
  }

  _registerPeer (peer) {
    const swarm = this;
    if (!swarm.peers[peer.id]) swarm.peers[peer.id] = peer;
    swarm.emit('peer', peer);
  }

  _scheduleReconnect (peer) {
    const swarm = this;
    this.log('schedule reconnect:', peer);

    if (swarm.peers[peer.id]) {
      if (swarm.peers[peer.id].timer) return true;
      swarm.peers[peer.id].timer = setTimeout(function () {
        clearTimeout(swarm.peers[peer.id].timer);
        swarm.connect(peer);
      }, 60000);
    }
  }

  _fillPeerSlots () {
    const swarm = this;
    const slots = MAX_PEERS - Object.keys(this.nodes).length;
    const peers = Object.keys(this.peers).map(function (id) {
      if (swarm.settings.verbosity >= 5) console.log('[FABRIC:SWARM]', '_fillPeerSlots()', 'Checking:', swarm.peers[id]);
      return swarm.peers[id].address;
    });
    const candidates = swarm.settings.peers.filter(function (address) {
      return !peers.includes(address);
    });

    if (slots) {
      for (let i = 0; (i < candidates.length && i < slots); i++) {
        swarm._scheduleReconnect(candidates[i]);
      }
    }
  }

  async _connectSeedNodes () {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:SWARM]', 'Connecting to seed nodes...', this.settings.seeds);
    for (const id in this.settings.seeds) {
      if (this.settings.verbosity >= 5) console.log('[FABRIC:SWARM]', 'Iterating on seed:', this.settings.seeds[id]);
      this.connect(this.settings.seeds[id]);
    }
  }

  async start () {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:SWARM]', 'Starting...');
    await this.agent.start();
    await this._connectSeedNodes();
    if (this.settings.verbosity >= 4) console.log('[FABRIC:SWARM]', 'Started!');
    return this;
  }

  async stop () {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:SWARM]', 'Stopping...');
    await this.agent.stop();
    if (this.settings.verbosity >= 4) console.log('[FABRIC:SWARM]', 'Stopped!');
    return this;
  }
}

module.exports = Peer;
module.exports.Swarm = Swarm;
