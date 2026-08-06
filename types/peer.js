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
  P2P_PEER_GOSSIP,
  P2P_PEERING_OFFER,
  P2P_PEER_ALIAS,
  P2P_CHAT_MESSAGE,
  P2P_INVENTORY_REQUEST,
  P2P_INVENTORY_RESPONSE,
  DOCUMENT_REQUEST_TYPE,
  PEER_MAX_WIRE_HASH_CACHE,
  PEER_MAX_LOGICAL_REGISTER_CACHE,
  PEER_SCORE_BODY_HASH_MISMATCH_PENALTY,
  PEER_SCORE_INVALID_SIGNATURE_PENALTY,
  PEER_SCORE_SIGNER_PIN_MISMATCH_PENALTY,
  PEER_SCORE_SESSION_KEY_VIOLATION_PENALTY,
  PEER_SCORE_CONTRACT_OPS_FORBIDDEN_PENALTY,
  PEER_SCORE_LOGICAL_REGISTER_HIJACK_PENALTY,
  PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_PENALTY,
  PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_WINDOW_MS,
  PEER_MAX_RELAY_NEST_DEPTH,
  PEER_BAN_TTL_MS,
  PEER_RELAY_CREDIT_COST,
  PEER_SCORE_RELAY_NEST_EXCEEDED_PENALTY,
  CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
  PEER_MAX_PENDING_SEALED_DELIVERIES,
  PEER_MAX_DOCUMENT_RELAY_ROUTES,
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  P2P_PORT,
  P2P_CHAIN_SYNC_REQUEST,
  P2P_FLUSH_CHAIN,
  P2P_FORWARD,
  P2P_RELAY
} = require('../constants');

const {
  wrapOnionPath,
  tryDecodeForward,
  xOnlyFromKey,
  xOnlyEquals,
  toXOnlyPeerId
} = require('../functions/fabricOnion');

/** Max UTF-8 code units for first-class P2P_CHAT_MESSAGE body (text only). */
const P2P_CHAT_MAX_CHARS = 2000;
/** Max UTF-8 code units for first-class P2P_PEER_ALIAS body (nickname). */
const P2P_PEER_ALIAS_MAX_CHARS = 64;

// Dependencies
const net = require('net');
const crypto = require('crypto');
const { Level } = require('level');
const stream = require('stream');
const manager = require('fast-json-patch');
const noise = require('noise-protocol-stream');
const merge = require('lodash.merge');
const { EventEmitter } = require('events');
// noise-protocol-stream uses one shared EventEmitter for all handshake callbacks.
// Concurrent mesh dials exceed the default MaxListeners=10 and spam warnings.
if ((EventEmitter.defaultMaxListeners || 10) < 64) {
  EventEmitter.defaultMaxListeners = 64;
}

// L1 document binding (hub / HTLC contentHash)
const {
  fabricCanonicalJson,
  whitelistedDocumentFields
} = require('../functions/publishedDocumentEnvelope');
const {
  purchaseContentHashHex,
  resolveDocumentContentHashHex,
  contentHashHexFromObject
} = require('../functions/documentPaymentHash');
const {
  normalizeFabricDocumentOfferEnvelopeForHandlers
} = require('../functions/publishedDocumentEnvelope');
const inventoryHtlc = require('../functions/inventoryHtlc');
const {
  buildForwardedDocumentRequest
} = require('../functions/documentMarket');
const {
  DEFAULT_CHUNK_BYTES,
  advertiseDocumentBlobs,
  splitBlobs,
  DocumentBlobTransferBook,
  parseFileSendObject
} = require('../functions/documentBlobManifest');
const {
  KEY_REVEAL_TYPE,
  prepareSealedSale,
  advertiseSealedDocument,
  buildKeyRevealMessage,
  openSealedDelivery,
  openWithClaimPreimage,
  requestMatchesPaymentHash,
  requestUnlocksContentKey
} = require('../functions/documentSealedExchange');

// Strict JSON
const {
  messageDataToString,
  tryParsePersistedJson,
  tryParseWireJsonBody,
  utf8FromPersistedRaw
} = require('../functions/wireJson');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Identity = require('./identity');
const Key = require('./key');
const Machine = require('./machine');
const Message = require('./message');
const Service = require('./service');

// Contract negotiation payload verification (CONTRACT_PROPOSAL wire frames)
const { verifyContractProposalPayload } = require('../functions/contractProposal');
// const Wallet = require('./wallet');

// Constants
const PROLOGUE = 'FABRIC';

/**
 * Safe debug label for a derived Key — never log private material.
 * @private
 */
function peerDebugDerivedPublicSummary (keyInstance) {
  if (!keyInstance || !keyInstance.settings) return '(unavailable)';
  const pubHex = typeof keyInstance.settings.public === 'string'
    ? keyInstance.settings.public.trim()
    : '';
  if (!pubHex) return '(no public key)';
  if (pubHex.length > 28) return `${pubHex.slice(0, 12)}…${pubHex.slice(-10)}`;
  return pubHex;
}

/**
 * Lowercase hex for comparing {@link P2P_FLUSH_CHAIN} authorized pubkeys.
 * @private
 */
function normalizePeerPubkeyHex (pk) {
  if (pk == null) return '';
  if (Buffer.isBuffer(pk)) {
    const h = pk.toString('hex').toLowerCase();
    if (pk.length === 32) return h;
    if (pk.length === 33 && (h.startsWith('02') || h.startsWith('03'))) return h.slice(2);
    return h;
  }
  const s = String(pk).trim();
  const h = (s.startsWith('0x') || s.startsWith('0X')) ? s.slice(2) : s;
  const lo = h.toLowerCase();
  if (lo.length === 66 && (lo.startsWith('02') || lo.startsWith('03'))) return lo.slice(2);
  return lo;
}

/**
 * Mesh types that MUST be forwarded bit-identical (author + signature preserved).
 * Relays never hop-re-sign these — wire-hash dedup and end-to-end / multisig verify depend on it.
 * Local agents may still *originate* new messages of these types signed with their own key.
 * @private
 */
const RELAY_AS_IS_TYPES = new Set([
  'BITCOIN_BLOCK',
  'BitcoinBlock',
  'P2P_CHAT_MESSAGE',
  'P2P_PEER_ALIAS',
  'CONTRACT_PUBLISH',
  'CONTRACT_MESSAGE',
  'CONTRACT_PROPOSAL',
  'ContractProposal',
  P2P_PEER_GOSSIP,
  'P2P_PEER_GOSSIP',
  P2P_PEERING_OFFER,
  'P2P_PEERING_OFFER',
  // Bit-identical mesh forward when local peer does not hold the document.
  'DOCUMENT_REQUEST',
  'DocumentRequest',
  // Inventory request/response: prior-hop / buyer author must survive TCP peer pin checks.
  'P2P_INVENTORY_REQUEST',
  'P2P_INVENTORY_RESPONSE',
  'INVENTORY_REQUEST',
  'INVENTORY_RESPONSE',
  // Source-signed onion layers: author is path builder, not the TCP peer.
  'P2P_FORWARD',
  // Mesh flood envelope: outer is attacker/path-builder signed; forward bit-identical.
  // Without this, the next hop pin-checks AMP author against the honest forwarder and bans them.
  'P2P_RELAY'
]);

const RELAY_AS_IS_NUMERIC = new Set([
  P2P_PEER_GOSSIP,
  P2P_PEERING_OFFER,
  P2P_PEER_ALIAS,
  P2P_CHAT_MESSAGE,
  P2P_INVENTORY_REQUEST,
  P2P_INVENTORY_RESPONSE,
  DOCUMENT_REQUEST_TYPE,
  P2P_FORWARD,
  P2P_RELAY
]);

/**
 * Outer / generic types whose local registration side-effects are first-writer-wins.
 * Exact wire duplicates are already dropped via {@link Peer#messages} (buffer hash).
 * These types also no-op when the *logical* payload was already registered — including
 * re-signed copies of the same body (different AMP signature → different wire hash).
 * @private
 */
const LOGICAL_REGISTER_ONCE_TYPES = new Set([
  'CONTRACT_PUBLISH',
  'P2P_CONTRACT_PUBLISH',
  'DOCUMENT_PUBLISH',
  'DocumentPublish',
  'P2P_DOCUMENT_PUBLISH',
  'CONTRACT_PROPOSAL',
  'ContractProposal',
  'P2P_CONTRACT_PROPOSAL',
  'P2P_PEER_ANNOUNCE',
  'P2P_STATE_ANNOUNCE',
  // Tip / operator / identity registration frames (re-sign ≠ new event)
  'BitcoinBlock',
  'BITCOIN_BLOCK',
  'P2P_FLUSH_CHAIN',
  'FlushChain',
  'P2P_PEER_ALIAS',
  'DocumentContentKeyReveal'
]);

/**
 * @param {string|number|null|undefined} type
 * @returns {boolean}
 * @private
 */
function isRelayAsIsWireType (type) {
  if (type == null) return false;
  if (typeof type === 'number') {
    return RELAY_AS_IS_NUMERIC.has(type);
  }
  return RELAY_AS_IS_TYPES.has(String(type));
}

/**
 * Generic / base carriers may wrap a relay-as-is body (Hub transitional path).
 * Pin-check against the TCP peer would wrongly reject multisig / prior-hop authors.
 * @param {Message} message
 * @returns {boolean}
 * @private
 */
function isRelayAsIsGenericCarrier (message) {
  const outer = message && (message.type || message.friendlyType);
  if (!outer) return false;
  const carriers = new Set([
    'GENERIC_MESSAGE',
    'GenericMessage',
    'P2P_BASE_MESSAGE',
    'CHAT_MESSAGE',
    'ChatMessage'
  ]);
  if (!carriers.has(String(outer))) return false;
  try {
    const raw = messageDataToString(message.data);
    const pr = tryParseWireJsonBody(raw);
    if (!pr.ok || !pr.value || typeof pr.value !== 'object' || Array.isArray(pr.value)) {
      return false;
    }
    return isRelayAsIsWireType(pr.value.type);
  } catch (e) {
    return false;
  }
}

/**
 * @classdesc P2P node: TCP/NOISE sessions, gossip, and relay of {@link Message} (AMP) frames. Extends {@link Service}
 * (hence {@link Actor}). Opcode and receipt semantics must stay aligned with <strong>@fabric/http</strong> and Hub when you add types —
 * see {@link Message} wire vs friendly names and <code>constants</code> opcodes.
 * @class Peer
 * @extends Service
 */
class Peer extends Service {
  /**
   * Create an instance of {@link Peer}.
   * @param {Object} [config] Initialization Vector for this peer.
   * @param {Boolean} [config.listen] Whether or not to listen for connections.
   * @param {Boolean} [config.upnp] Whether or not to use UPNP for automatic configuration.
   * @param {Number} [config.port=7777] Port to use for P2P connections.
   * @param {Number} [config.listenPortAttempts=20] When the listen port is in use (`EADDRINUSE`),
   *   try the next port up to this many times (same host).
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
      listenPortAttempts: 20,
      reconnectToKnownPeers: true,
      // When true, answers INVENTORY_REQUEST: `offerBtc` (L1 offers) and `kind: 'documents'`
      // (Hub / browser catalog) using local `_state.content.documents` (+ optional rates/collections).
      serveLocalDocumentInventory: false,
      // When false (default), DOCUMENT_REQUEST queues for operator approve/deny.
      // When true, auto-sends P2P_FILE_SEND if held (convenient but amplifies egress).
      autoFulfillDocumentRequests: false,
      // When true (default), priced publishes seal AES-GCM; HTLC preimage = content key.
      sealPricedDocuments: true,
      // Attach P2TR HTLC fields on offerBtc inventory responses.
      attachInventoryHtlc: false,
      inventoryHtlcLocktimeHeight: null,
      inventoryBlobChunkBytes: DEFAULT_CHUNK_BYTES,
      // Privacy-preserving DocumentRequest rewrite + fee skim when maxSats set.
      relayPrivateDocumentRequests: false,
      documentRelayFeeSats: null,
      documentRelayFeeBps: 100,
      documentRelayMinRemainingSats: 1,
      documentRelayMaxHops: 4,
      // Re-send canonical DocumentPublish + pricing to new inbound peers.
      announceDocumentsOnPeerConnect: false,
      // If local inventory doesn't answer, optionally relay INVENTORY_REQUEST.
      relayInventoryRequest: false,
      // Optionally relay INVENTORY_RESPONSE to peers other than the sender.
      relayInventoryResponse: false,
      connectTimeout: 5000,
      // Relay amplification controls for P2P_PEER_GOSSIP.
      gossip: {
        maxHops: GOSSIP_MAX_HOPS,
        maxRelaysPerOriginPerMinute: GOSSIP_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
        maxPayloadCache: GOSSIP_MAX_PAYLOAD_CACHE,
        maxWireHashCache: PEER_MAX_WIRE_HASH_CACHE
      },
      // Mesh chat amplify controls (local `chat` event still fires when limited).
      chat: {
        maxRelaysPerOriginPerMinute: CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE
      },
      maxPendingSealedDeliveries: PEER_MAX_PENDING_SEALED_DELIVERIES,
      maxDocumentRelayRoutes: PEER_MAX_DOCUMENT_RELAY_ROUTES,
      state: Object.assign({
        actors: {},
        channels: {},
        contracts: {},
        documents: {},
        documentRates: {},
        documentSealed: {},
        documentContentKeys: {},
        messages: {},
        services: {}
      }, config.state),
      upnp: false,
      key: {},
      // Inbound wire traffic budgeting (Bitcoin Core-style peer quality).
      wireTraffic: {
        windowMs: 60 * 1000,
        maxCreditsPerWindow: 520,
        chainSyncCreditCost: 55,
        flushChainCreditCost: 120,
        bitcoinBlockCreditCost: 3,
        relayCreditCost: PEER_RELAY_CREDIT_COST,
        defaultCreditCost: 1,
        overLimitPenalty: 22,
        sessionKeyViolationPenalty: PEER_SCORE_SESSION_KEY_VIOLATION_PENALTY
      },
      // Registry-score misbehavior penalties (see SECURITY.md).
      peerScore: {
        bodyHashMismatchPenalty: PEER_SCORE_BODY_HASH_MISMATCH_PENALTY,
        invalidSignaturePenalty: PEER_SCORE_INVALID_SIGNATURE_PENALTY,
        signerPinMismatchPenalty: PEER_SCORE_SIGNER_PIN_MISMATCH_PENALTY,
        contractOpsForbiddenPenalty: PEER_SCORE_CONTRACT_OPS_FORBIDDEN_PENALTY,
        logicalRegisterHijackPenalty: PEER_SCORE_LOGICAL_REGISTER_HIJACK_PENALTY,
        logicalRegisterDuplicatePenalty: PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_PENALTY,
        logicalRegisterDuplicateWindowMs: PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_WINDOW_MS,
        relayNestExceededPenalty: PEER_SCORE_RELAY_NEST_EXCEEDED_PENALTY,
        disconnectOnHardMisbehavior: true,
        banOnHardMisbehavior: true,
        banTtlMs: PEER_BAN_TTL_MS,
        maxRelayNestDepth: PEER_MAX_RELAY_NEST_DEPTH
      },
      // Inbound P2P_FLUSH_CHAIN: sender registry score must be strictly greater than this (relay uses same threshold).
      flushChainMinTrustedScore: 800,
      // Inbound P2P_FLUSH_CHAIN: allowed signer pubkeys (hex/Buffers); empty = reject all until configured.
      flushChainAuthorizedPubkeys: []
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
    /** Pending DOCUMENT_REQUEST entries when {@link Peer#settings.autoFulfillDocumentRequests} is false. */
    this.pendingDocumentRequests = Object.create(null);
    /**
     * Authorized sealed-document key reveals: `"documentId|paymentHashHex"` → meta.
     * Populated only after verified settlement (never from public hash echo).
     */
    this._authorizedDocumentKeyReveals = new Map();
    /** contractId → Set of lowercase compressed pubkeys allowed to apply state ops. */
    this._contractPatchAllowList = Object.create(null);
    /** Buyer-side verified blob reassembly (DocumentBlobIndex). */
    this.blobTransfers = new DocumentBlobTransferBook();
    /** Ciphertext awaiting content-key reveal: documentId → meta. */
    this.pendingSealedDeliveries = Object.create(null);
    this._pendingDocumentRequestSeq = 0;
    /** Private reverse routes for rewritten DocumentRequests (never gossiped). */
    this._documentRelayRoutes = Object.create(null);
    this._documentRelaySeen = new Set();
    // Peers: keyed by public key (id). Persistent registry in _state.peers.
    // Map connection address (IP:port) -> peer id (public key). Learned on P2P_SESSION_OFFER/OPEN.
    this._addressToId = {};
    /** Inbound address -> NOISE static pubkey hex (FLUSH_CHAIN allowlist only; never for AMP verify). */
    this._inboundNoiseStaticPubkeyByAddress = Object.create(null);
    this.mailboxes = {};
    this.memory = {};
    this.handlers = {};
    /** Wire-envelope dedup (SHA-256 of full buffer); FIFO-capped via {@link Peer#_rememberWireHash}. */
    this.messages = {};
    this._wireHashOrder = [];
    /**
     * Logical first-writer-wins registrations (content-addressed keys).
     * Catches re-signed duplicates of CONTRACT_PUBLISH / DOCUMENT_PUBLISH / etc.
     * @type {Map<string, { type: string, signer: string|null, at: number }>}
     */
    this._logicalRegisterOnce = new Map();
    this._logicalRegisterOrder = [];
    /** Logical gossip payload dedup (excludes signature / hop churn). */
    this._gossipPayloadSeen = new Map();
    this._gossipPayloadOrder = [];
    /** origin address → { count, windowStart } for gossip relay rate limiting. */
    this._gossipRelayByOrigin = new Map();
    /** origin address → { count, windowStart } for chat mesh relay rate limiting. */
    this._chatRelayByOrigin = new Map();
    /** Logical peering-offer payload dedup (ignores advisory peeringHop; frames relay as-is). */
    this._peeringPayloadSeen = new Map();
    this._peeringPayloadOrder = [];
    /** origin address → { count, windowStart } for peering-offer relay rate limiting. */
    this._peeringRelayByOrigin = new Map();
    /** `host:port` → { credits, windowStart, penalized } — inbound wire flood / de-rank (per peer). */
    this._wireInboundByOrigin = new Map();
    /** `host:port` → { windowStart, penalized } — soft logical-duplicate derank once per window. */
    this._logicalDupPenaltyByOrigin = new Map();
    /**
     * Temporary bans after hard misbehavior: `addr:<host:port>` or `pk:<hex>` → { until, reason }.
     * @type {Map<string, { until: number, reason: string }>}
     */
    this._peerBans = new Map();
    /** `host:port` keys for {@link P2P_PEERING_OFFER} candidate queue dedup. */
    this._candidateKeys = new Set();
    /**
     * `host:port` strings we opened via {@link Peer#_connect} (outbound dials).
     * {@link P2P_SESSION_OFFER} must not destroy these when the same peer also opens an inbound
     * socket (mesh star): otherwise RPC paths that use the listen address (e.g. ChainSyncRequest)
     * see `peer not connected` while an ephemeral inbound key remains.
     */
    this._outboundDialTargets = new Set();
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

  /**
   * Stable id for gossip *logical* content (ignores advisory `gossipHop`; frames are forwarded bit-identical).
   * Mesh frames are relayed bit-identical; wire-hash dedup also prevents loops.
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

  /**
   * Content-addressed key for first-writer-wins registration types.
   * @param {string} type wire / generic type name
   * @param {object|null|undefined} object message body / object
   * @returns {string|null}
   */
  _logicalRegistrationKey (type, object) {
    const t = String(type || '');
    if (!LOGICAL_REGISTER_ONCE_TYPES.has(t)) return null;
    const obj = (object && typeof object === 'object' && !Array.isArray(object)) ? object : null;
    if (!obj) return null;

    if (t === 'CONTRACT_PUBLISH' || t === 'P2P_CONTRACT_PUBLISH') {
      return `contract:${new Actor(obj).id}`;
    }
    if (t === 'DOCUMENT_PUBLISH' || t === 'DocumentPublish') {
      const docId = obj.id != null ? String(obj.id) : '';
      if (!docId) return null;
      try {
        const hash = purchaseContentHashHex(docId, obj);
        return `document:${docId}:${hash}`;
      } catch (_) {
        return `document:${docId}`;
      }
    }
    if (t === 'P2P_DOCUMENT_PUBLISH') {
      const docId = obj.hash != null ? String(obj.hash) : (obj.id != null ? String(obj.id) : '');
      if (!docId) return null;
      const rate = obj.rate != null ? String(obj.rate) : '';
      const ch = obj.contentHash != null ? String(obj.contentHash) : '';
      return `docprice:${docId}:${rate}:${ch}`;
    }
    if (t === 'CONTRACT_PROPOSAL' || t === 'ContractProposal' || t === 'P2P_CONTRACT_PROPOSAL') {
      const root = obj.chain && obj.chain.merkleRoot != null
        ? String(obj.chain.merkleRoot)
        : (obj.merkleRoot != null ? String(obj.merkleRoot) : '');
      if (!root) return null;
      const cid = obj.contractId != null ? String(obj.contractId) : '';
      return `proposal:${cid}:${root}`;
    }
    if (t === 'P2P_PEER_ANNOUNCE') {
      return `announce:${new Actor(obj).id}`;
    }
    if (t === 'P2P_STATE_ANNOUNCE') {
      const stateObj = (obj.state && typeof obj.state === 'object') ? obj.state : obj;
      return `state:${new Actor(stateObj).id}`;
    }
    if (t === 'BitcoinBlock' || t === 'BITCOIN_BLOCK') {
      const tip = obj.tip != null ? String(obj.tip)
        : (obj.hash != null ? String(obj.hash)
          : (obj.blockHash != null ? String(obj.blockHash)
            : (obj.content != null ? String(obj.content) : '')));
      if (!tip) return null;
      return `btcblock:${tip.toLowerCase()}`;
    }
    if (t === 'P2P_FLUSH_CHAIN' || t === 'FlushChain') {
      const snap = obj.snapshotBlockHash != null ? String(obj.snapshotBlockHash).trim().toLowerCase() : '';
      if (!snap) return null;
      return `flush:${snap}`;
    }
    if (t === 'P2P_PEER_ALIAS') {
      const alias = obj.alias != null ? String(obj.alias).trim() : '';
      const signer = obj.signer != null ? normalizePeerPubkeyHex(obj.signer) : '';
      if (!alias || !signer) return null;
      return `alias:${signer}:${alias}`;
    }
    if (t === 'DocumentContentKeyReveal') {
      const docId = obj.documentId != null ? String(obj.documentId).trim() : '';
      if (!docId) return null;
      const pay = obj.paymentHashHex != null ? String(obj.paymentHashHex).toLowerCase() : '';
      const key = obj.keyHex != null ? String(obj.keyHex).toLowerCase() : '';
      return `keyreveal:${docId}:${pay || key}`;
    }
    return null;
  }

  /**
   * Claim a logical registration key (first writer wins).
   * @param {string} type
   * @param {object|null|undefined} object
   * @param {string|null} [signerPubkeyHex]
   * @returns {{ duplicate: boolean, key: (string|null), prior: (object|null) }}
   */
  _claimLogicalRegistration (type, object, signerPubkeyHex = null) {
    const key = this._logicalRegistrationKey(type, object);
    if (!key) return { duplicate: false, key: null, prior: null };
    const prior = this._logicalRegisterOnce.get(key) || null;
    if (prior) return { duplicate: true, key, prior };
    const max = (this.settings.logicalRegister && this.settings.logicalRegister.maxCache) ||
      PEER_MAX_LOGICAL_REGISTER_CACHE;
    while (this._logicalRegisterOrder.length >= max) {
      const drop = this._logicalRegisterOrder.shift();
      this._logicalRegisterOnce.delete(drop);
    }
    const entry = {
      type: String(type || ''),
      signer: signerPubkeyHex ? normalizePeerPubkeyHex(signerPubkeyHex) : null,
      at: Date.now()
    };
    this._logicalRegisterOnce.set(key, entry);
    this._logicalRegisterOrder.push(key);
    return { duplicate: false, key, prior: null };
  }

  /**
   * Lower registry score and optionally destroy the TCP connection (hard misbehavior).
   * Hard disconnects also install a temporary ban (address + known pubkey).
   * @param {string|null|undefined} originName
   * @param {string} reason
   * @param {Object} [opts]
   * @param {number} [opts.penalty]
   * @param {boolean} [opts.disconnect]
   */
  _applyPeerMisbehavior (originName, reason, opts = {}) {
    const penalty = Number(opts.penalty);
    const pen = Number.isFinite(penalty) && penalty > 0 ? penalty : 20;
    const wantDisconnect = opts.disconnect === true;
    const ps = this.settings.peerScore || {};
    const hardDisconnect = ps.disconnectOnHardMisbehavior !== false;
    if (originName) {
      this._derankPeerForWireTraffic(originName, pen, reason);
    }
    this.emit('warning',
      `[FABRIC:PEER] Misbehavior (${reason}) from ${originName || 'unknown'} penalty=${pen}` +
      (wantDisconnect && hardDisconnect ? ' disconnect=1' : ''));
    if (wantDisconnect && hardDisconnect && originName) {
      if (ps.banOnHardMisbehavior !== false) {
        this._banPeer(originName, reason);
      }
      const conn = this.connections && this.connections[originName];
      if (conn && typeof conn.destroy === 'function') conn.destroy();
      // Drop registry of the live socket so reconnect/ban checks apply immediately.
      if (this.connections) delete this.connections[originName];
      if (this.peers && this.peers[originName] && typeof this.peers[originName] === 'object') {
        this.peers[originName].status = 'disconnected';
      }
    }
  }

  /**
   * Ban a connection address (and mapped pubkey when known) for {@link Peer#settings.peerScore.banTtlMs}.
   * @param {string} originName
   * @param {string} reason
   */
  _banPeer (originName, reason) {
    if (!originName) return;
    const ps = this.settings.peerScore || {};
    const ttl = Number(ps.banTtlMs);
    const banMs = Number.isFinite(ttl) && ttl > 0 ? ttl : PEER_BAN_TTL_MS;
    const until = Date.now() + banMs;
    const entry = { until, reason: String(reason || 'misbehavior') };
    this._peerBans.set(`addr:${originName}`, entry);
    const peerId = (this._addressToId && this._addressToId[originName]) || null;
    const reg = (this._state.peers && (this._state.peers[peerId] || this._state.peers[originName])) || null;
    const pk = normalizePeerPubkeyHex(
      (reg && reg.publicKey) ||
      (this.peers[originName] && this.peers[originName].publicKey) ||
      peerId
    );
    if (pk && pk.length >= 64) {
      this._peerBans.set(`pk:${pk}`, entry);
    }
    this.emit('warning',
      `[FABRIC:PEER] Banned ${originName}${pk ? ` pk=${pk.slice(0, 16)}…` : ''} until=${new Date(until).toISOString()} (${entry.reason})`);
  }

  /**
   * @param {string|null|undefined} originName
   * @param {string|null|undefined} [pubkeyHex]
   * @returns {boolean}
   */
  _isPeerBanned (originName = null, pubkeyHex = null) {
    const now = Date.now();
    for (const [k, v] of this._peerBans) {
      if (!v || !(v.until > now)) this._peerBans.delete(k);
    }
    if (originName && this._peerBans.has(`addr:${originName}`)) return true;
    const pk = normalizePeerPubkeyHex(pubkeyHex);
    if (pk && this._peerBans.has(`pk:${pk}`)) return true;
    if (originName) {
      const peerId = (this._addressToId && this._addressToId[originName]) || null;
      const reg = (this._state.peers && (this._state.peers[peerId] || this._state.peers[originName])) || null;
      const mapped = normalizePeerPubkeyHex(
        (reg && reg.publicKey) ||
        (this.peers[originName] && this.peers[originName].publicKey) ||
        peerId
      );
      if (mapped && this._peerBans.has(`pk:${mapped}`)) return true;
    }
    return false;
  }

  /**
   * Soft (once/window) or hijack (CONTRACT_PUBLISH other signer) penalty for logical duplicates.
   * @param {string|null|undefined} originName
   * @param {string} type
   * @param {Object} claim
   * @param {Object|null} [claim.prior]
   * @param {string|null} [claim.prior.signer]
   * @param {string|null} [signerPubkeyHex]
   */
  _logicalRegisterDuplicateMisbehavior (originName, type, claim, signerPubkeyHex = null) {
    const ps = this.settings.peerScore || {};
    const t = String(type || '');
    const current = signerPubkeyHex ? normalizePeerPubkeyHex(signerPubkeyHex) : null;
    const priorSigner = claim && claim.prior && claim.prior.signer
      ? normalizePeerPubkeyHex(claim.prior.signer)
      : null;
    const isHijack = (t === 'CONTRACT_PUBLISH' || t === 'P2P_CONTRACT_PUBLISH') &&
      priorSigner && current && priorSigner !== current;

    if (isHijack) {
      const penalty = Number(ps.logicalRegisterHijackPenalty) || PEER_SCORE_LOGICAL_REGISTER_HIJACK_PENALTY;
      this._applyPeerMisbehavior(originName, `logical-register-hijack:${t}`, {
        penalty,
        disconnect: false
      });
      return;
    }

    if (!originName) return;
    const windowMs = Number(ps.logicalRegisterDuplicateWindowMs) ||
      PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_WINDOW_MS;
    const penalty = Number(ps.logicalRegisterDuplicatePenalty) ||
      PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_PENALTY;
    const now = Date.now();
    let slot = this._logicalDupPenaltyByOrigin.get(originName);
    if (!slot || (now - slot.windowStart) >= windowMs) {
      slot = { windowStart: now, penalized: false };
    }
    if (slot.penalized) {
      this._logicalDupPenaltyByOrigin.set(originName, slot);
      return;
    }
    slot.penalized = true;
    this._logicalDupPenaltyByOrigin.set(originName, slot);
    this._applyPeerMisbehavior(originName, `logical-register-duplicate:${t}`, {
      penalty,
      disconnect: false
    });
  }

  /**
   * Claim logical registration; on duplicate, apply misbehavior and return claim.
   * @param {string} type
   * @param {object|null|undefined} object
   * @param {string|null} [signerPubkeyHex]
   * @param {string|null} [originName]
   * @returns {{ duplicate: boolean, key: (string|null), prior: (object|null) }}
   */
  _claimLogicalRegistrationOrPunish (type, object, signerPubkeyHex = null, originName = null) {
    const claim = this._claimLogicalRegistration(type, object, signerPubkeyHex);
    if (claim.duplicate) {
      this._logicalRegisterDuplicateMisbehavior(originName, type, claim, signerPubkeyHex);
    }
    return claim;
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
   * @param {string} originName Connection id (e.g. `host:port`)
   * @returns {boolean}
   */
  _chatRateLimitAllow (originName) {
    const limit = (this.settings.chat && this.settings.chat.maxRelaysPerOriginPerMinute) ||
      CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE;
    const now = Date.now();
    let slot = this._chatRelayByOrigin.get(originName);
    if (!slot || now - slot.windowStart > 60000) {
      slot = { count: 0, windowStart: now };
    }
    if (slot.count >= limit) return false;
    slot.count++;
    this._chatRelayByOrigin.set(originName, slot);
    return true;
  }

  _capPendingSealedDeliveries () {
    const max = Number(this.settings.maxPendingSealedDeliveries);
    const cap = Number.isFinite(max) && max > 0 ? max : PEER_MAX_PENDING_SEALED_DELIVERIES;
    const ids = Object.keys(this.pendingSealedDeliveries);
    if (ids.length <= cap) return;
    ids.sort((a, b) => {
      const ta = (this.pendingSealedDeliveries[a] && this.pendingSealedDeliveries[a].updated) || 0;
      const tb = (this.pendingSealedDeliveries[b] && this.pendingSealedDeliveries[b].updated) || 0;
      return ta - tb;
    });
    const drop = ids.length - cap;
    for (let i = 0; i < drop; i++) {
      delete this.pendingSealedDeliveries[ids[i]];
    }
  }

  _capDocumentRelayRoutes () {
    const max = Number(this.settings.maxDocumentRelayRoutes);
    const cap = Number.isFinite(max) && max > 0 ? max : PEER_MAX_DOCUMENT_RELAY_ROUTES;
    const ids = Object.keys(this._documentRelayRoutes);
    if (ids.length <= cap) return;
    ids.sort((a, b) => {
      const ta = (this._documentRelayRoutes[a] && this._documentRelayRoutes[a].created) || 0;
      const tb = (this._documentRelayRoutes[b] && this._documentRelayRoutes[b].created) || 0;
      return ta - tb;
    });
    const drop = ids.length - cap;
    for (let i = 0; i < drop; i++) {
      delete this._documentRelayRoutes[ids[i]];
    }
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
    if (t === 'P2P_FLUSH_CHAIN' || t === 'FlushChain' || wireType === P2P_FLUSH_CHAIN) {
      return Number(w.flushChainCreditCost) || 120;
    }
    if (t === 'BITCOIN_BLOCK' || t === 'BitcoinBlock') {
      return Number(w.bitcoinBlockCreditCost) || 3;
    }
    if (t === 'P2P_FORWARD' || wireType === P2P_FORWARD) {
      return Number(w.forwardCreditCost) || 4;
    }
    if (t === 'P2P_RELAY' || wireType === P2P_RELAY) {
      return Number(w.relayCreditCost) || PEER_RELAY_CREDIT_COST;
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
   * Stable id for peering-offer *logical* content (ignores advisory `peeringHop`).
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
    };
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
    if (!idOrAddress || typeof idOrAddress !== 'string') return null;
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

  /**
   * Local node x-only pubkey (AMP {@code author} / {@code P2P_FORWARD.nextPeer} encoding).
   * @returns {Buffer}
   */
  _localXOnlyPeerId () {
    return xOnlyFromKey(this.key);
  }

  /**
   * Resolve a live connection address for an x-only (or compressed) peer pubkey.
   * @param {Buffer|string} peerId
   * @returns {string|null} connection key ({@code host:port}) or null
   */
  _resolveAddressByXOnly (peerId) {
    let want;
    try {
      want = toXOnlyPeerId(peerId);
    } catch (err) {
      return null;
    }
    if (xOnlyEquals(want, this._localXOnlyPeerId())) return null;

    const connections = this.connections || {};
    for (const addr of Object.keys(connections)) {
      const rec = this.peers[addr];
      if (!rec || rec.publicKey == null) continue;
      try {
        if (xOnlyEquals(want, toXOnlyPeerId(rec.publicKey))) return addr;
      } catch (err) {
        // ignore malformed registry keys
      }
    }

    const registry = this._state.peers || {};
    for (const key of Object.keys(registry)) {
      const entry = registry[key];
      if (!entry) continue;
      const pk = entry.publicKey || entry.pubkey;
      if (pk == null) continue;
      try {
        if (!xOnlyEquals(want, toXOnlyPeerId(pk))) continue;
      } catch (err) {
        continue;
      }
      const addr = entry.address || key;
      if (addr && connections[addr]) return addr;
      const resolved = this._resolveToAddress(addr) || this._resolveToAddress(key);
      if (resolved) return resolved;
    }
    return null;
  }

  /**
   * Send {@code payload} along a source-routed onion path of Fabric peer pubkeys.
   * Builds nested {@code P2P_FORWARD} layers and writes the outer frame only to
   * {@code path[0]} (immediate hop). Destination learns the last hop's IP, not
   * the originator's. See {@link module:@fabric/core/functions/fabricOnion}.
   *
   * @param {Array<Buffer|string>} path hop pubkeys; first = next TCP peer, last = deliverer
   * @param {Message|Buffer} payload innermost application Message (should already be signed)
   * @returns {boolean} true if the outer frame was written to the first hop
   */
  sendOnion (path, payload) {
    if (!Array.isArray(path) || !path.length) {
      this.emit('warning', '[FABRIC:PEER] sendOnion: empty path');
      return false;
    }
    let outer;
    try {
      outer = wrapOnionPath({ path, payload, key: this.key });
    } catch (err) {
      this.emit('warning', `[FABRIC:PEER] sendOnion wrap failed: ${err && err.message ? err.message : err}`);
      return false;
    }
    const first = path[0];
    const addr = this._resolveAddressByXOnly(first) || this._resolveToAddress(
      typeof first === 'string' ? first : null
    );
    if (!addr || !this.connections[addr] || !this.connections[addr]._writeFabric) {
      this.emit('warning', '[FABRIC:PEER] sendOnion: first hop not connected');
      this.emit('onion:undeliverable', { path, reason: 'first-hop-missing' });
      return false;
    }
    this.connections[addr]._writeFabric(outer.toBuffer());
    this.emit('onion:sent', { pathLength: path.length, firstHop: addr });
    return true;
  }

  /**
   * Handle inbound {@code P2P_FORWARD}: peel when {@code nextPeer} is local, else
   * forward the bit-identical outer frame to that peer only (no mesh flood).
   * @private
   */
  _handleP2PForward (message, origin, socket) {
    const fields = tryDecodeForward(message);
    if (!fields) {
      this.emit('warning', '[FABRIC:PEER] P2P_FORWARD body undecodable');
      return this;
    }
    if (fields.ttl < 1) {
      if (this.settings.debug) {
        this.emit('debug', '[FABRIC:PEER] Dropped P2P_FORWARD with ttl=0');
      }
      return this;
    }

    const local = this._localXOnlyPeerId();
    if (xOnlyEquals(fields.nextPeer, local)) {
      this.emit('onion:peel', {
        ttl: fields.ttl,
        origin: origin && origin.name,
        innerBytes: fields.inner.length
      });
      if (fields.inner.length > 0) {
        // Peeled inners must not hard-disconnect / derank the TCP last hop:
        // relays forward bit-identical outers, so a malicious originator can
        // launder a bad inner through an honest relay (see SECURITY.md / P2P_FORWARD).
        this._handleFabricMessage(fields.inner, origin, socket, { peeledForward: true });
      }
      return this;
    }

    const addr = this._resolveAddressByXOnly(fields.nextPeer);
    if (!addr || !this.connections[addr] || !this.connections[addr]._writeFabric) {
      this.emit('warning', '[FABRIC:PEER] P2P_FORWARD next hop not connected');
      this.emit('onion:undeliverable', {
        nextPeer: fields.nextPeer.toString('hex'),
        origin: origin && origin.name,
        reason: 'next-hop-missing'
      });
      return this;
    }
    if (origin && origin.name && addr === origin.name) {
      this.emit('warning', '[FABRIC:PEER] P2P_FORWARD refuses bounce to origin');
      return this;
    }

    // Bit-identical forward — do not re-sign; path builder signature stays intact.
    const wire = (message && typeof message.toBuffer === 'function')
      ? message.toBuffer()
      : null;
    if (!wire || !wire.length) {
      this.emit('warning', '[FABRIC:PEER] P2P_FORWARD missing wire buffer');
      return this;
    }
    this.connections[addr]._writeFabric(wire);
    this.emit('onion:forward', {
      nextHop: addr,
      ttl: fields.ttl,
      origin: origin && origin.name
    });
    return this;
  }

  /**
   * Relay an AMP message only to connected peers whose persistent registry score is strictly greater than
   * {@link Peer#settings.flushChainMinTrustedScore} (default 800). Used for `P2P_FLUSH_CHAIN`.
   * @param {string|null} origin - Connection key to skip (inbound sender), or null when originating locally.
   * @param {Message|Buffer} message
   * @param {number} [minScoreExclusive] - Override trust threshold (relay if peer score &gt; this value).
   */
  relayFromTrustedPeers (origin, message, minScoreExclusive = null) {
    const threshold = (minScoreExclusive != null && Number.isFinite(Number(minScoreExclusive)))
      ? Number(minScoreExclusive)
      : (Number(this.settings.flushChainMinTrustedScore) || 800);
    const buf = Buffer.isBuffer(message) ? message : message.toBuffer();
    for (const id in this.connections) {
      if (origin && id === origin) continue;
      const score = this._registryScoreForConnectionAddress(id);
      if (!(score > threshold)) continue;
      this.connections[id]._writeFabric(buf);
    }
  }

  /**
   * Best-effort registry score for a live connection key (`host:port`), using mapped Fabric id when known.
   * @param {string} connAddress
   * @returns {number}
   */
  _registryScoreForConnectionAddress (connAddress) {
    const reg = this._state.peers || {};
    const mappedId = this._addressToId && this._addressToId[connAddress];
    let best = 0;
    for (const key of [mappedId, connAddress]) {
      if (!key) continue;
      const e = reg[key];
      if (!e) continue;
      const s = Number(e.score);
      if (Number.isFinite(s) && s > best) best = s;
    }
    return best;
  }

  /**
   * FLUSH_CHAIN trust score bound to verified sender key.
   *
   * Prevents trusting attacker-controlled `P2P_SESSION_OFFER.actor.id` aliases
   * by refusing `_addressToId`-mapped scores unless that mapped registry entry
   * is explicitly bound to the same verified sender pubkey.
   *
   * @param {string} connAddress
   * @param {string} senderPubkeyHex - verified sender pubkey hex (from NOISE/static or trusted peer record)
   * @returns {number}
   */
  _registryScoreForFlushChainSender (connAddress, senderPubkeyHex) {
    const reg = this._state.peers || {};
    const senderHex = normalizePeerPubkeyHex(senderPubkeyHex);
    const candidates = new Set();
    if (connAddress) candidates.add(connAddress);
    if (senderHex) candidates.add(senderHex);

    const mappedId = this._addressToId && this._addressToId[connAddress];
    if (mappedId && senderHex) {
      const mapped = reg[mappedId];
      if (mapped && typeof mapped === 'object') {
        const mappedPk = normalizePeerPubkeyHex(mapped.publicKey);
        // Only trust mapped id score when mapped record is key-bound.
        if (mappedPk && mappedPk === senderHex) candidates.add(mappedId);
      }
    }

    let best = 0;
    for (const key of candidates) {
      const e = reg[key];
      if (!e) continue;
      const s = Number(e.score);
      if (Number.isFinite(s) && s > best) best = s;
    }

    return best;
  }

  /**
   * Sign and send `P2P_FLUSH_CHAIN` to all connected peers with registry score &gt; threshold.
   * Body JSON: `{ snapshotBlockHash, network?, label? }`.
   *
   * **Receivers** (see `P2P_FLUSH_CHAIN` handler) require **both**:
   * 1. Sender pubkey in {@link Peer#settings.flushChainAuthorizedPubkeys} (non-empty allowlist), and
   * 2. Registry score above {@link Peer#settings.flushChainMinTrustedScore}.
   * Registry score bumps on `P2P_PONG` only when that pong answers an outbound ping on the same
   * connection (`_fabricPingOutstanding`), so unsolicited pongs cannot inflate trust alone.
   *
   * @param {Object} object
   * @returns {number} number of sockets written
   */
  sendFlushChainToTrustedPeers (object) {
    const body = JSON.stringify(object && typeof object === 'object' ? object : {});
    const msg = Message.fromVector(['P2P_FLUSH_CHAIN', body]).signWithKey(this.key);
    const buf = msg.toBuffer();
    const threshold = Number(this.settings.flushChainMinTrustedScore) || 800;
    let n = 0;
    for (const id in this.connections) {
      if (!(this._registryScoreForConnectionAddress(id) > threshold)) continue;
      this.connections[id]._writeFabric(buf);
      n++;
    }
    return n;
  }

  subscribe (_path) {

  }

  _beginFabricHandshake (client) {
    const keyClaim = this._buildSessionKeyExchangeClaim(this.identity.id);
    // Start handshake
    const vector = ['P2P_SESSION_OFFER', JSON.stringify({
      type: 'P2P_SESSION_OFFER',
      actor: {
        id: this.identity.id,
        pubkey: keyClaim.pubkey,
        parentPubkey: keyClaim.parentPubkey,
        parentXpub: keyClaim.parentXpub,
        parentSignature: keyClaim.parentSignature
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

    if (this._isPeerBanned(target)) {
      this.emit('warning', `[FABRIC:PEER:_connect] Refusing dial to banned peer ${target}`);
      return;
    }

    this.emit('debug', `[FABRIC:PEER:_connect] Attempting to connect to: ${target}`);
    const url = new URL(`tcp://${target}`);
    const id = url.username;

    if (!url.port) target += `:${P2P_PORT}`;

    this._outboundDialTargets.add(target);

    const _derived = this.identity.key.derive(FABRIC_KEY_DERIVATION_PATH);
    this.emit('debug', `[FABRIC:PEER:_connect] Local derived key (public hex, truncated): ${peerDebugDerivedPublicSummary(_derived)} path=${FABRIC_KEY_DERIVATION_PATH}`);

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
      // privateKey: _derived.privkey — enable when NOISE static === Fabric derived key.
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

  /**
   * Broadcast a personal nickname as first-class {@link P2P_PEER_ALIAS}
   * (UTF-8 body = nickname text only).
   * @param {string} alias
   * @param {{name: (string|undefined)}|null} [origin] Optional origin to exclude from broadcast
   * @param {*} [_socket] Unused (API compatibility)
   */
  _announceAlias (alias, origin = null, _socket = null) {
    const name = String(alias || '').trim().slice(0, P2P_PEER_ALIAS_MAX_CHARS);
    if (!name) return;
    const packet = Message.fromVector(['P2P_PEER_ALIAS', name]);
    if (this.key) packet.signWithKey(this.key);
    const announcement = packet.toBuffer();
    const exclude = origin && origin.name ? origin.name : null;
    this.broadcast(announcement, exclude);
  }

  _destroyFabric (socket, target) {
    if (socket._keepalive) clearInterval(socket._keepalive);

    if (this._outboundDialTargets) this._outboundDialTargets.delete(target);

    delete this.connections[target];
    delete this.peers[target];
    if (this._inboundNoiseStaticPubkeyByAddress) delete this._inboundNoiseStaticPubkeyByAddress[target];
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
      let peers = {};
      if (raw != null && raw !== '') {
        const pr = tryParsePersistedJson(utf8FromPersistedRaw(raw));
        if (pr.ok && pr.value !== null && typeof pr.value === 'object' && !Array.isArray(pr.value)) {
          peers = pr.value;
        } else if (!pr.ok) {
          this.emit('debug', `[FABRIC:PEER] Peer registry JSON invalid or oversized: ${pr.error.message}`);
        }
      }
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

  /** FLUSH_CHAIN sender hex: {@link Peer#peers}[addr].publicKey if set, else inbound NOISE static (allowlist must match). */
  _flushChainSenderPubkeyHex (connectionAddress) {
    if (!connectionAddress) return '';
    const rec = this.peers[connectionAddress];
    if (rec && typeof rec === 'object' && rec.publicKey != null && rec.publicKey !== '') {
      const h = normalizePeerPubkeyHex(rec.publicKey);
      if (h) return h;
    }
    const noise = this._inboundNoiseStaticPubkeyByAddress[connectionAddress];
    return noise ? normalizePeerPubkeyHex(noise) : '';
  }

  /**
   * Verify Fabric message signature against the message's own on-wire author field.
   * Returns normalized x-only signer pubkey hex on success.
   * @private
   * @param {Message} message
   * @returns {string}
   */
  _verifiedFabricSignerPubkeyHex (message) {
    if (!message || !message.raw || !message.raw.author) return '';
    const xOnly = normalizePeerPubkeyHex(message.raw.author);
    if (!/^[0-9a-f]{64}$/.test(xOnly)) return '';
    try {
      // Canonical compressed form; verifyWithKey checks x-only author parity-independently.
      const signer = new Key({ public: `02${xOnly}` });
      if (!message.verifyWithKey(signer)) return '';
      return xOnly;
    } catch {
      return '';
    }
  }

  /**
   * Stable message covered by parent-key signature to bind a session child key claim.
   * @private
   */
  _sessionKeyProofMessage (peerId, childPubkeyHex, parentPubkeyHex) {
    return [
      'fabric-session-key-proof-v1',
      String(peerId || ''),
      normalizePeerPubkeyHex(childPubkeyHex),
      normalizePeerPubkeyHex(parentPubkeyHex)
    ].join(':');
  }

  /**
   * Build signed key-exchange claim for early Fabric session messages.
   * Child key signs the Fabric message envelope; parent key signs child binding.
   * @private
   */
  _buildSessionKeyExchangeClaim (peerId = this.identity.id) {
    const childPubkey = this.key.public.encodeCompressed('hex');
    const parentPubkey = this.key.public.encodeCompressed('hex');
    const proofMsg = this._sessionKeyProofMessage(peerId, childPubkey, parentPubkey);
    const parentSignature = this.key.signSchnorr(proofMsg).toString('hex');
    return {
      pubkey: childPubkey,
      parentPubkey,
      parentXpub: this.key.xpub || null,
      parentSignature
    };
  }

  /**
   * Validate claimed session key exchange against verified wire signer key.
   * Missing/invalid signatures are protocol violations and are penalized.
   * @private
   */
  _validateSessionKeyExchangeClaim (genericMessage, signerPubkeyHex, originName, opts = {}) {
    const actor = (genericMessage && genericMessage.actor && typeof genericMessage.actor === 'object')
      ? genericMessage.actor
      : {};
    const peerId = actor.id;
    const claimedChild = normalizePeerPubkeyHex(actor.pubkey || actor.publicKey);
    const claimedParent = normalizePeerPubkeyHex(actor.parentPubkey || actor.parentPublicKey);
    const parentSigHex = typeof actor.parentSignature === 'string' ? actor.parentSignature.trim() : '';
    const punishOpts = { peeledForward: opts.peeledForward === true };

    if (!claimedChild || !claimedParent || !parentSigHex) {
      this._punishPeerForSessionKeyViolation(originName, 'missing session key signature material', punishOpts);
      return false;
    }
    if (!/^[0-9a-f]{64}$/.test(claimedChild) || !/^[0-9a-f]{64}$/.test(claimedParent)) {
      this._punishPeerForSessionKeyViolation(originName, 'invalid session key format', punishOpts);
      return false;
    }
    if (!/^[0-9a-f]{128}$/.test(parentSigHex)) {
      this._punishPeerForSessionKeyViolation(originName, 'invalid parent signature format', punishOpts);
      return false;
    }
    if (claimedChild !== normalizePeerPubkeyHex(signerPubkeyHex)) {
      this._punishPeerForSessionKeyViolation(originName, 'claimed child key does not match signer', punishOpts);
      return false;
    }

    const proofMsg = this._sessionKeyProofMessage(peerId, claimedChild, claimedParent);
    let ok = false;
    try {
      const parentKey = new Key({ public: `02${claimedParent}` });
      ok = parentKey.verifySchnorr(proofMsg, Buffer.from(parentSigHex, 'hex'));
    } catch {
      ok = false;
    }
    if (!ok) {
      this._punishPeerForSessionKeyViolation(originName, 'invalid parent signature', punishOpts);
      return false;
    }

    return { peerId, childPubkey: claimedChild, parentPubkey: claimedParent, parentXpub: actor.parentXpub || null };
  }

  /**
   * Penalize protocol violations around unsigned/unverifiable session key claims.
   * @private
   * @param {string|null|undefined} originName
   * @param {string} reason
   * @param {Object} [opts]
   * @param {boolean} [opts.peeledForward]
   */
  _punishPeerForSessionKeyViolation (originName, reason, opts = {}) {
    const peeledForward = opts.peeledForward === true;
    const penalty = Number(this.settings.wireTraffic && this.settings.wireTraffic.sessionKeyViolationPenalty) ||
      PEER_SCORE_SESSION_KEY_VIOLATION_PENALTY;
    // Onion peel: do not cut/ban the honest TCP last hop for a laundered bad session frame.
    this._applyPeerMisbehavior(peeledForward ? null : originName, `session-key:${reason}`, {
      penalty,
      disconnect: !peeledForward
    });
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
   * @param {object|null} [origin]
   * @param {object|null} [socket]
   * @param {Object} [options]
   * @param {number} [options.relayDepth]
   * @param {boolean} [options.skipRelayFlood]
   * @param {boolean} [options.peeledForward] true when delivered via {@link Peer#_handleP2PForward} peel
   * @returns {Peer} Instance of the Peer.
   */
  _handleFabricMessage (buffer, origin = null, socket = null, options = null) {
    const opts = (options && typeof options === 'object') ? options : {};
    const originName = (origin && origin.name) ? origin.name : null;
    const ps = this.settings.peerScore || {};
    // Onion peel / bit-identical relay: never attribute inner-frame integrity / authz
    // failures to the TCP last hop when that hop is only forwarding someone else's frame.
    const suppressTcpOriginPunish = opts.peeledForward === true || opts.relayedAsIs === true;
    const peeledForward = suppressTcpOriginPunish; // legacy alias used by nested handlers
    const scoreOrigin = suppressTcpOriginPunish ? null : originName;

    // Frame-size gate before parse / hash / signature work.
    let wire = buffer;
    if (!Buffer.isBuffer(wire)) {
      if (wire instanceof Uint8Array) wire = Buffer.from(wire);
      else return this;
    }
    const maxBody = Number(this.settings.maxMessageSize);
    const bodyCap = Number.isFinite(maxBody) && maxBody > 0 ? maxBody : MAX_MESSAGE_SIZE;
    const maxWire = HEADER_SIZE + bodyCap;
    if (wire.length > maxWire) {
      this.emit('warning',
        `[FABRIC:PEER] Dropping oversized frame (${wire.length} > ${maxWire}) from ${originName || 'unknown'}`);
      return this;
    }

    if (originName && this._isPeerBanned(originName)) {
      this.emit('warning', `[FABRIC:PEER] Dropping message from banned peer ${originName}`);
      const conn = this.connections && this.connections[originName];
      if (conn && typeof conn.destroy === 'function') conn.destroy();
      return this;
    }

    const hash = crypto.createHash('sha256').update(wire).digest('hex');
    const message = Message.fromBuffer(wire);
    if (this.settings.debug) this.emit('debug', `Got Fabric message: ${message}`);

    // Have we seen this exact wire envelope before? (silent — no score change)
    if (this.messages[hash]) {
      return this;
    }

    // Body integrity: `hash` header is double-SHA256(body). Wire `preimage` is a
    // Lightning-style payment secret (all-zero for public frames; non-zero for HTLC /
    // Fabric Circuit hops). Do not require preimage === SHA256(body) — that field is
    // not a body commitment (see docs/MESSAGE_BODY.md).
    // Remember wire hash only after verify so junk frames cannot fill the dedup cache.
    const bodyBuf = message.raw.data || Buffer.alloc(0);
    const checksum = Hash256.doubleDigest(bodyBuf);
    const expectedHash = Buffer.isBuffer(message.raw.hash) ? message.raw.hash.toString('hex') : message.raw.hash;
    if (checksum !== expectedHash) {
      const t = message.type || '?';
      const hint = this.settings.debug
        ? ` wire=${String(expectedHash).slice(0, 16)}… computed=${String(checksum).slice(0, 16)}…`
        : '';
      this.emit('warning',
        `[FABRIC:PEER] Dropping message (body hash mismatch): from=${originName || 'unknown'}` +
        `${peeledForward ? ' (peeled forward)' : ''} type=${t}${hint}`);
      this._applyPeerMisbehavior(scoreOrigin, 'body-hash-mismatch', {
        penalty: Number(ps.bodyHashMismatchPenalty) || PEER_SCORE_BODY_HASH_MISMATCH_PENALTY,
        disconnect: !peeledForward
      });
      return this;
    }

    // Verify every inbound message against the signed on-wire author field.
    const signerPubkeyHex = this._verifiedFabricSignerPubkeyHex(message);
    if (!signerPubkeyHex) {
      this.emit('warning',
        `[FABRIC:PEER] Invalid message signature from ${originName || 'unknown'}` +
        `${peeledForward ? ' (peeled forward)' : ''}`);
      this._applyPeerMisbehavior(scoreOrigin, 'invalid-signature', {
        penalty: Number(ps.invalidSignaturePenalty) || PEER_SCORE_INVALID_SIGNATURE_PENALTY,
        disconnect: !peeledForward
      });
      return this;
    }

    this._rememberWireHash(hash);

    // Connection peer pin ≠ message author for mesh relays (author may be a prior hop
    // or a multisig group). Authenticity is the AMP signature; Noise authenticates the TCP peer.
    // Session / control messages still require signer continuity with the pinned peer key.
    // Peeled onion inners are authored by the path originator, not the last hop — skip pin.
    const peerKey = origin && (origin.name != null ? origin.name : origin);
    const peerRecord = peerKey && this.peers[peerKey];
    const relayAsIs = peeledForward
      || isRelayAsIsWireType(message.type)
      || isRelayAsIsWireType(message.friendlyType)
      || isRelayAsIsGenericCarrier(message);
    if (!relayAsIs && peerRecord && peerRecord.publicKey) {
      const pinned = normalizePeerPubkeyHex(peerRecord.publicKey);
      if (pinned && pinned !== signerPubkeyHex) {
        this.emit('warning', `[FABRIC:PEER] Signer mismatch from ${peerKey}: expected pinned peer key`);
        this._applyPeerMisbehavior(scoreOrigin || peerKey, 'signer-pin-mismatch', {
          penalty: Number(ps.signerPinMismatchPenalty) || PEER_SCORE_SIGNER_PIN_MISMATCH_PENALTY,
          disconnect: !peeledForward
        });
        return this;
      }
    }

    if (originName) {
      const cost = this._wireInboundCreditCost(message.type);
      if (!this._wireInboundRateAllowPeer(originName, cost)) {
        if (this.settings.debug) {
          this.emit('debug', `[FABRIC:PEER] Dropped (wire traffic budget): ${originName} type=${message.type}`);
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
        if (!origin || origin.name == null) break;
        {
          // Mesh flood envelope: body = raw inner Message bytes (not directed onion).
          // Never re-wrap on forward — bit-identical relayFrom of *this* outer frame so
          // wire-hash dedup bounds diameter. Nested RELAY unwrap is depth-capped.
          // For IP-hiding source routes use P2P_FORWARD / Peer#sendOnion.
          const relayDepth = Number(opts.relayDepth) || 0;
          const maxNest = Number(ps.maxRelayNestDepth);
          const nestCap = Number.isFinite(maxNest) && maxNest >= 0 ? maxNest : PEER_MAX_RELAY_NEST_DEPTH;
          const inner = (message.raw && Buffer.isBuffer(message.raw.data))
            ? message.raw.data
            : Buffer.alloc(0);
          // Outer AMP author ≠ TCP peer pin ⇒ this hop is only forwarding; do not
          // attribute inner pin/integrity/nest failures to them (mesh partition DoS).
          const peerRec = this.peers[origin.name];
          const pinnedOuter = peerRec && peerRec.publicKey
            ? normalizePeerPubkeyHex(peerRec.publicKey)
            : null;
          const relayedAsIs = !!(pinnedOuter && signerPubkeyHex && pinnedOuter !== signerPubkeyHex);
          const softRelayOrigin = suppressTcpOriginPunish || relayedAsIs;
          if (inner.length > 0) {
            if (relayDepth >= nestCap) {
              this._applyPeerMisbehavior(softRelayOrigin ? null : originName, 'relay-nest-exceeded', {
                penalty: Number(ps.relayNestExceededPenalty) || PEER_SCORE_RELAY_NEST_EXCEEDED_PENALTY,
                disconnect: !softRelayOrigin
              });
              break;
            }
            this._handleFabricMessage(inner, origin, socket, {
              relayDepth: relayDepth + 1,
              skipRelayFlood: true,
              peeledForward: suppressTcpOriginPunish,
              relayedAsIs: softRelayOrigin
            });
            // Only the outermost received envelope is mesh-flooded (bit-identical).
            if (!opts.skipRelayFlood) {
              this.relayFrom(origin.name, message, socket);
            }
          }
        }
        break;
      case 'P2P_FORWARD':
        this._handleP2PForward(message, origin, socket);
        break;
      case 'BITCOIN_BLOCK':
      case 'BitcoinBlock': {
        // Chain-tip gossip: relay so sparse meshes learn Bitcoin network tip.
        // Logical tip claim stops re-signed copies of the same tip from re-emitting / re-relaying.
        const rawBb = messageDataToString(message.data);
        const prBb = tryParseWireJsonBody(rawBb);
        if (prBb.ok && prBb.value && typeof prBb.value === 'object' && !Array.isArray(prBb.value)) {
          const claimBb = this._claimLogicalRegistrationOrPunish(
            message.type, prBb.value, signerPubkeyHex, originName);
          if (claimBb.duplicate) {
            if (this.settings.debug) {
              this.emit('debug', '[FABRIC:PEER] Ignoring duplicate BitcoinBlock (tip already registered)');
            }
            break;
          }
        }
        this.emit('bitcoinBlock', { message, origin, socket });
        if (origin && origin.name) this.relayFrom(origin.name, message);
        break;
      }
      case 'P2P_CHAIN_SYNC_REQUEST':
      case 'ChainSyncRequest':
        if (!origin || !origin.name) break;
        {
          const raw = messageDataToString(message.data);
          const pr = tryParseWireJsonBody(raw);
          if (!pr.ok || pr.value === null || typeof pr.value !== 'object' || Array.isArray(pr.value)) {
            this.emit('warning', `[FABRIC:PEER] CHAIN_SYNC_REQUEST parse failed: ${pr.ok ? 'invalid body' : pr.error.message}`);
            break;
          }
          this.emit('chainSyncRequest', { message, origin, socket, object: pr.value });
        }
        break;
      case 'P2P_FLUSH_CHAIN':
      case 'FlushChain': {
        if (!origin || !origin.name) break;
        const senderHex = signerPubkeyHex || this._flushChainSenderPubkeyHex(origin.name);
        if (!senderHex) {
          this.emit('warning', `[FABRIC:PEER] FLUSH_CHAIN ignored: no verified peer key for ${origin.name}`);
          break;
        }
        const authList = this.settings.flushChainAuthorizedPubkeys;
        if (!Array.isArray(authList) || authList.length === 0) {
          this.emit('warning', `[FABRIC:PEER] FLUSH_CHAIN ignored: flushChainAuthorizedPubkeys is empty (configure allowed signer pubkeys)`);
          break;
        }
        const allowed = new Set();
        for (const e of authList) {
          const h = normalizePeerPubkeyHex(e);
          if (h) allowed.add(h);
        }
        if (!allowed.has(senderHex)) {
          this.emit('warning', `[FABRIC:PEER] FLUSH_CHAIN ignored: sender pubkey not in flushChainAuthorizedPubkeys`);
          break;
        }
        const threshold = Number(this.settings.flushChainMinTrustedScore) || 800;
        const score = this._registryScoreForFlushChainSender(origin.name, senderHex);
        if (!(score > threshold)) {
          if (this.settings.debug) {
            this.emit('debug', `[FABRIC:PEER] FLUSH_CHAIN ignored: sender score ${score} not > ${threshold}`);
          }
          break;
        }
        const rawFc = messageDataToString(message.data);
        const prFc = tryParseWireJsonBody(rawFc);
        if (!prFc.ok) {
          this.emit('warning', `[FABRIC:PEER] FLUSH_CHAIN JSON parse failed: ${prFc.error.message}`);
          break;
        }
        const object = prFc.value;
        if (object === null || typeof object !== 'object' || Array.isArray(object)) {
          this.emit('warning', '[FABRIC:PEER] FLUSH_CHAIN body must be a JSON object');
          break;
        }
        const snap = object.snapshotBlockHash != null ? String(object.snapshotBlockHash).trim() : '';
        if (!/^[0-9a-fA-F]{64}$/.test(snap)) {
          this.emit('warning', '[FABRIC:PEER] FLUSH_CHAIN missing or invalid snapshotBlockHash (expect 64 hex)');
          break;
        }
        object.snapshotBlockHash = snap.toLowerCase();
        const claimFc = this._claimLogicalRegistrationOrPunish(
          message.type, object, senderHex, origin.name);
        if (claimFc.duplicate) {
          if (this.settings.debug) {
            this.emit('debug', '[FABRIC:PEER] Ignoring duplicate FLUSH_CHAIN (snapshot already registered)');
          }
          break;
        }
        this.emit('flushChain', { message, origin, socket, object });
        this.relayFromTrustedPeers(origin.name, message, threshold);
        break;
      }
      case 'P2P_CHAT_MESSAGE': {
        // Body = raw UTF-8 chat text only (no JSON). Author is AMP header / signature.
        const text = messageDataToString(message.data);
        if (!text || !String(text).trim()) {
          this.emit('warning', '[FABRIC:PEER] P2P_CHAT_MESSAGE empty body');
          break;
        }
        if (String(text).length > P2P_CHAT_MAX_CHARS) {
          this.emit('warning', `[FABRIC:PEER] P2P_CHAT_MESSAGE exceeds ${P2P_CHAT_MAX_CHARS} chars`);
          break;
        }
        // Reject legacy chat JSON envelopes ({ type, actor, object }); opaque UTF-8
        // text is allowed (including app JSON that is not a chat envelope).
        const trimmed = String(text).trim();
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
                (parsed.type === 'P2P_CHAT_MESSAGE' || (parsed.actor && parsed.object))) {
              this.emit('warning', '[FABRIC:PEER] P2P_CHAT_MESSAGE body must be UTF-8 text, not a JSON chat envelope');
              break;
            }
          } catch (_) { /* not JSON — treat as text */ }
        }
        const chatSigner = this._verifiedFabricSignerPubkeyHex(message);
        this.emit('chat', { text: String(text), type: 'P2P_CHAT_MESSAGE' }, {
          origin,
          signer: chatSigner || null,
          wireMessage: message,
          peeledForward: opts.peeledForward === true
        });
        // Onion peel / RELAY unwrap: deliver locally only. Mesh relay under the TCP
        // last hop would burn that neighbor's chat budget for an originator's frame.
        if (origin && origin.name && message &&
            opts.peeledForward !== true && !opts.skipRelayFlood) {
          if (this._chatRateLimitAllow(origin.name)) {
            this.relayFrom(origin.name, message);
          } else {
            this.emit('warning',
              `[FABRIC:PEER] Chat relay rate-limited for ${origin.name}`);
          }
        }
        break;
      }
      case 'P2P_PEER_ALIAS': {
        // Body = raw UTF-8 nickname only (no JSON).
        const alias = messageDataToString(message.data);
        if (!alias || !String(alias).trim()) {
          this.emit('warning', '[FABRIC:PEER] P2P_PEER_ALIAS empty body');
          break;
        }
        const name = String(alias).trim().slice(0, P2P_PEER_ALIAS_MAX_CHARS);
        if (String(alias).trim().startsWith('{') || String(alias).trim().startsWith('[')) {
          this.emit('warning', '[FABRIC:PEER] P2P_PEER_ALIAS body must be UTF-8 text, not JSON');
          break;
        }
        // Peel / relay-as-is: observe only — never overlay alias onto the TCP last hop
        // or bind the attacker's registry address to that hop's socket.
        const aliasLocalOnly = opts.peeledForward === true || opts.relayedAsIs === true;
        const aliasSignerHex = signerPubkeyHex || this._verifiedFabricSignerPubkeyHex(message);
        const claimAlias = this._claimLogicalRegistrationOrPunish('P2P_PEER_ALIAS', {
          alias: name,
          signer: aliasSignerHex || ''
        }, aliasSignerHex, aliasLocalOnly ? null : originName);
        if (claimAlias.duplicate) {
          if (this.settings.debug) {
            this.emit('debug', '[FABRIC:PEER] Ignoring duplicate P2P_PEER_ALIAS (same signer + nickname)');
          }
          break;
        }
        if (!aliasLocalOnly && origin && origin.name && this.connections[origin.name]) {
          this.connections[origin.name]._alias = name;
        }
        const aliasPeerId = aliasSignerHex
          || (!aliasLocalOnly && origin && this._addressToId && this._addressToId[origin.name])
          || (!aliasLocalOnly && origin && origin.name)
          || null;
        if (aliasPeerId) {
          this._upsertPeerRegistry(aliasPeerId, {
            id: aliasPeerId,
            address: (!aliasLocalOnly && origin && origin.name) ? origin.name : undefined,
            alias: name,
            publicKey: aliasSignerHex || undefined
          });
        }
        this.emit('peerAlias', {
          alias: name,
          signer: aliasSignerHex || null,
          origin,
          wireMessage: message,
          peeledForward: aliasLocalOnly
        });
        if (!aliasLocalOnly && origin && origin.name && message && !opts.skipRelayFlood) {
          this.relayFrom(origin.name, message);
        }
        break;
      }
      case 'P2P_INVENTORY_REQUEST':
      case 'P2P_INVENTORY_RESPONSE':
      case 'P2P_PEER_GOSSIP':
      case 'P2P_PEERING_OFFER':
      case 'P2P_PING':
      case 'P2P_PONG':
      case 'P2P_STATE_ANNOUNCE':
      case 'P2P_PEER_ANNOUNCE':
      case 'P2P_SESSION_OFFER':
      case 'P2P_SESSION_OPEN':
      case 'P2P_DOCUMENT_PUBLISH':
      case 'P2P_FILE_SEND':
      case 'CONTRACT_PUBLISH':
      case 'CONTRACT_MESSAGE':
      {
        const rawTyped = messageDataToString(message.data);
        const prTyped = tryParseWireJsonBody(rawTyped);
        if (!prTyped.ok || prTyped.value === null || typeof prTyped.value !== 'object' || Array.isArray(prTyped.value)) {
          this.emit('warning', `[FABRIC:PEER] ${message.type} parse failed: ${prTyped.ok ? 'invalid body' : prTyped.error.message}`);
          break;
        }
        const wireToInner = {
          P2P_INVENTORY_REQUEST: 'INVENTORY_REQUEST',
          P2P_INVENTORY_RESPONSE: 'INVENTORY_RESPONSE'
        };
        const innerType = wireToInner[message.type] || message.type;
        const parsed = prTyped.value;
        let genericBody;
        if (message.type === 'CONTRACT_PUBLISH' || message.type === 'CONTRACT_MESSAGE') {
          // Contract frames dispatch by WIRE type (namespace routing). The app
          // payload — including any inner `type` like MissionBroadcast — is kept
          // intact under `object` so handlers see the full body.
          genericBody = { type: message.type, object: parsed };
        } else {
          genericBody = (parsed && typeof parsed === 'object' && (parsed.actor || parsed.object || parsed.type))
            ? Object.assign({}, parsed, { type: parsed.type || innerType })
            : { type: innerType, object: parsed };
        }
        this._handleGenericMessage(genericBody, origin, socket, message, opts);
        break;
      }
      case 'DOCUMENT_PUBLISH':
      case 'DocumentPublish':
        try {
          const rawDp = messageDataToString(message.data);
          const prDp = tryParseWireJsonBody(rawDp);
          if (!prDp.ok) {
            this.emit('warning', `[FABRIC:PEER] DOCUMENT_PUBLISH parse failed: ${prDp.error.message}`);
            break;
          }
          const parsed = prDp.value;
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            this.emit('warning', '[FABRIC:PEER] DOCUMENT_PUBLISH body must be a JSON object');
            break;
          }
          const docId = parsed.id;
          if (!docId) break;
          const claimDp = this._claimLogicalRegistrationOrPunish(
            message.type, parsed, signerPubkeyHex, originName);
          if (claimDp.duplicate) {
            if (this.settings.debug) {
              this.emit('debug',
                `[FABRIC:PEER] Ignoring duplicate DOCUMENT_PUBLISH for ${docId} (logical key claimed)`);
            }
            break;
          }
          const purchaseHash = purchaseContentHashHex(docId, parsed);
          const payload = {
            message,
            origin,
            socket,
            documentId: docId,
            purchaseContentHashHex: purchaseHash,
            parsed,
            source: 'canonical'
          };
          this.emit('documentPublish', payload);
          this.emit('DocumentPublish', payload);
        } catch (exception) {
          this.emit('warning', `[FABRIC:PEER] DOCUMENT_PUBLISH parse failed: ${exception.message}`);
        }
        break;
      case 'DOCUMENT_REQUEST':
      case 'DocumentRequest':
        try {
          this._handleDocumentRequestWire(message, origin, socket);
        } catch (exception) {
          this.emit('warning', `[FABRIC:PEER] DOCUMENT_REQUEST failed: ${exception.message}`);
        }
        break;
      case 'CONTRACT_PROPOSAL':
      case 'ContractProposal': {
        const rawCp = messageDataToString(message.data);
        const prCp = tryParseWireJsonBody(rawCp);
        if (!prCp.ok || prCp.value === null || typeof prCp.value !== 'object' || Array.isArray(prCp.value)) {
          this.emit('warning', `[FABRIC:PEER] CONTRACT_PROPOSAL parse failed: ${prCp.ok ? 'invalid body' : prCp.error.message}`);
          break;
        }
        const payload = prCp.value;
        const verdict = verifyContractProposalPayload(payload);
        if (!verdict || verdict.ok !== true) {
          this.emit('warning', `[FABRIC:PEER] CONTRACT_PROPOSAL rejected: ${(verdict && verdict.error) || 'verification failed'}`);
          break;
        }
        const claimCp = this._claimLogicalRegistrationOrPunish(
          message.type, payload, signerPubkeyHex, originName);
        if (claimCp.duplicate) {
          if (this.settings.debug) {
            this.emit('debug',
              '[FABRIC:PEER] Ignoring duplicate CONTRACT_PROPOSAL (merkle root already registered)');
          }
          break;
        }
        this.emit('contract:proposal', {
          contract: payload.contractId != null ? String(payload.contractId) : null,
          payload,
          message,
          origin,
          socket,
          signer: signerPubkeyHex || null
        });
        if (origin && origin.name) {
          // Forward bit-identical — never hop-re-sign (preserves author / multisig).
          this.relayFrom(origin.name, message);
        }
        break;
      }
      case 'GENERIC_MESSAGE':
      case 'GenericMessage':
      case 'P2P_BASE_MESSAGE':
      case 'CHAT_MESSAGE':
      case 'ChatMessage':
        // GENERIC_MESSAGE (15103) is the transitional Hub/browser carrier; P2P_BASE_MESSAGE
        // remains the generic peer payload / legacy decode fallback. Both carry UTF-8 JSON
        // bodies dispatched via _handleGenericMessage (bounded — see functions/wireJson).
        {
          const rawGm = messageDataToString(message.data);
          const prGm = tryParseWireJsonBody(rawGm);
          if (!prGm.ok) {
            this.emit('warning', `[FABRIC:PEER] Generic message parse failed: ${prGm.error.message}`);
            break;
          }
          const bodyGm = prGm.value;
          if (bodyGm === null || typeof bodyGm !== 'object' || Array.isArray(bodyGm)) {
            this.emit('warning', '[FABRIC:PEER] Generic message body must be a JSON object');
            break;
          }
          this._handleGenericMessage(bodyGm, origin, socket, message, opts);
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
        {
          const rawLn = messageDataToString(message.data);
          const prLn = tryParseWireJsonBody(rawLn);
          if (prLn.ok) {
            this.emit('lightning', { type: message.type, content: prLn.value, origin });
          } else {
            this.emit('lightning', { type: message.type, raw: message.data, origin });
          }
        }
        break;
    }

    this.commit();

    return this;
  }

  /**
   * Originate a locally signed {@code P2P_RELAY} envelope around already-signed inner AMP bytes.
   * Used only when *this* agent starts a flood (e.g. inventory without a prior wire frame).
   * Inbound {@code P2P_RELAY} must never call this — forward the original outer bit-identical.
   */
  _relayWirePayload (originName, wirePayload, socket = null) {
    if (!originName) return false;
    const body = Buffer.isBuffer(wirePayload)
      ? wirePayload
      : Buffer.from(wirePayload || []);
    if (!body.length) return false;
    const relayMessage = Message.fromVector(['P2P_RELAY', body]);
    relayMessage.signWithKey(this.key);
    this.relayFrom(originName, relayMessage, socket);
    return true;
  }

  /**
   * Relay inventory / generic payloads. When {@code wireMessage} is present, forward it
   * bit-identical (no hop re-sign). Otherwise the local agent originates a new signed frame
   * and may wrap it in {@code P2P_RELAY} for mesh delivery.
   */
  _relayGenericPayload (originName, payload, socket = null, wireMessage = null) {
    if (!originName) return false;
    if (wireMessage && typeof wireMessage.toBuffer === 'function') {
      this.relayFrom(originName, wireMessage, socket);
      return true;
    }
    const innerType = (payload && payload.type === 'INVENTORY_REQUEST')
      ? 'P2P_INVENTORY_REQUEST'
      : (payload && payload.type === 'INVENTORY_RESPONSE')
          ? 'P2P_INVENTORY_RESPONSE'
          : 'P2P_BASE_MESSAGE';
    const innerBody = (innerType === 'P2P_BASE_MESSAGE')
      ? JSON.stringify(payload)
      : JSON.stringify((payload && payload.object) ? payload.object : {});
    const innerBuffer = Message
      .fromVector([innerType, innerBody])
      .signWithKey(this.key)
      .toBuffer();
    return this._relayWirePayload(originName, innerBuffer, socket);
  }

  _handleSessionOfferGenericMessage (message, origin, socket, signerPubkeyHex, opts = {}) {
    // Peel / relay-as-is: TCP origin is not the AMP author — never rebind
    // peers/_addressToId or reply SESSION_OPEN on that socket (partition DoS).
    if (opts.peeledForward === true || opts.relayedAsIs === true) {
      this.emit('warning',
        '[FABRIC:PEER] Ignoring P2P_SESSION_OFFER delivered via peel/relay-as-is (no identity rebind)');
      return this;
    }
    const peerId = message.actor.id;
    const connAddress = origin.name;
    if (this.settings.debug) this.emit('debug', `Handling session offer: ${JSON.stringify(message.object)}`);
    if (this.settings.debug) this.emit('debug', `Session offer origin: ${JSON.stringify(origin)}`);
    {
      const sessionClaim = this._validateSessionKeyExchangeClaim(
        message, signerPubkeyHex, connAddress, { peeledForward: opts.peeledForward === true });
      if (!sessionClaim) return this;
    }

    // If we've already bound this Fabric id to a key, reject key-mismatched offers.
    const existingPeer = (this._state.peers && this._state.peers[peerId]) || null;
    if (existingPeer && existingPeer.publicKey) {
      const known = normalizePeerPubkeyHex(existingPeer.publicKey);
      if (known && known !== signerPubkeyHex) {
        this.emit('warning', `[FABRIC:PEER] Rejecting session offer for ${peerId}: signer key mismatch`);
        return this;
      }
    }

    // Same peer reconnecting from new port? Close old connection and replace with new.
    // Do not tear down our outbound dial to the peer's listen address: concurrent inbound +
    // outbound to the same Fabric id is normal (e.g. ring + star mesh); dropping the stable
    // `host:listenPort` socket breaks address-keyed sends on the satellite.
    const addressToId = this._addressToId || {};
    for (const [addr, mappedId] of Object.entries(addressToId)) {
      if (mappedId !== peerId || addr === connAddress) continue;
      if (this._outboundDialTargets && this._outboundDialTargets.has(addr)) continue;
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

    this.peers[connAddress] = new Actor({
      id: peerId,
      name: connAddress,
      address: connAddress,
      connections: [ connAddress ],
      publicKey: signerPubkeyHex
    });

    this._upsertPeerRegistry(connAddress, {
      id: peerId,
      address: connAddress,
      publicKey: signerPubkeyHex,
      lastSeen: new Date().toISOString()
    });
    this._addressToId[connAddress] = peerId;

    // Emit peer event
    this.emit('peer', this.peers[connAddress]);

    // Send session open event
    const keyClaim = this._buildSessionKeyExchangeClaim(this.identity.id);
    const vector = ['P2P_SESSION_OPEN', JSON.stringify({
      type: 'P2P_SESSION_OPEN',
      actor: {
        id: this.identity.id,
        pubkey: keyClaim.pubkey,
        parentPubkey: keyClaim.parentPubkey,
        parentXpub: keyClaim.parentXpub,
        parentSignature: keyClaim.parentSignature
      },
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
    if (this.settings.announceDocumentsOnPeerConnect) {
      this._announceLocalDocumentsToPeer(connAddress);
    }
    return this;
  }

  _handleSessionOpenGenericMessage (message, origin, signerPubkeyHex, opts = {}) {
    if (opts.peeledForward === true || opts.relayedAsIs === true) {
      this.emit('warning',
        '[FABRIC:PEER] Ignoring P2P_SESSION_OPEN delivered via peel/relay-as-is (no identity rebind)');
      return this;
    }
    if (this.settings.debug) this.emit('debug', `Handling session open: ${JSON.stringify(message.object)}`);
    const openPeerId = message.object.counterparty;
    {
      const sessionClaim = this._validateSessionKeyExchangeClaim(
        message, signerPubkeyHex, origin && origin.name, { peeledForward: opts.peeledForward === true });
      if (!sessionClaim) return this;
    }
    const existingOpenPeer = (this._state.peers && this._state.peers[openPeerId]) || null;
    if (existingOpenPeer && existingOpenPeer.publicKey) {
      const knownOpen = normalizePeerPubkeyHex(existingOpenPeer.publicKey);
      if (knownOpen && knownOpen !== signerPubkeyHex) {
        this.emit('warning', `[FABRIC:PEER] Rejecting session open for ${openPeerId}: signer key mismatch`);
        return this;
      }
    }
    this.peers[origin.name] = { id: openPeerId, name: origin.name, address: origin, publicKey: signerPubkeyHex };
    this._upsertPeerRegistry(origin.name, {
      id: openPeerId,
      address: origin.name,
      publicKey: signerPubkeyHex,
      lastSeen: new Date().toISOString()
    });
    this._addressToId[origin.name] = openPeerId;
    // Don't emit peer event here - it's already emitted in P2P_SESSION_OFFER
    return this;
  }

  _handleGenericMessage (message, origin = null, socket = null, wireMessage = null, options = null) {
    const handleOpts = (options && typeof options === 'object') ? options : {};
    const peeledForward = handleOpts.peeledForward === true;
    const msg = normalizeFabricDocumentOfferEnvelopeForHandlers(message);
    if (this.settings.debug) this.emit('debug', `Generic message:\n\tFrom: ${JSON.stringify(origin)}\n\tType: ${msg.type}\n\tBody:\n\`\`\`\n${JSON.stringify(msg.object, null, '  ')}\n\`\`\``);

    const signerPubkeyHex = wireMessage
      ? this._verifiedFabricSignerPubkeyHex(wireMessage)
      : normalizePeerPubkeyHex(msg && msg.actor && (msg.actor.publicKey || msg.actor.pubkey));

    // Lookup the appropriate Actor for the message's origin
    const actor = new Actor(origin);

    switch (msg.type) {
      default:
        this.emit('debug', `Unhandled Generic Message: ${msg.type} ${JSON.stringify(msg, null, '  ')}`);
        break;
      case 'INVENTORY_REQUEST':
        // Upstream Inventory request (typically for documents). Emit an 'inventory'
        // event so higher-level services (e.g. hub) can respond appropriately.
        // JSON `type` may be legacy `INVENTORY_REQUEST` or Fabric alias `FABRIC_DOCUMENT_OFFER` (see `functions/publishedDocumentEnvelope.js`).
        this.emit('inventory', { message: msg, origin, socket });
        if (this.settings.serveLocalDocumentInventory) {
          const served = this._respondInventoryFromLocalDocuments(msg, origin);
          const req = msg.object || {};
          if (this.settings.relayInventoryRequest && !served && req.offerBtc === true) {
            // Relay path matches L1 `offerBtc` requests; Hub-driven `kind:documents` relays use TTL in app code.
            this._relayGenericPayload(origin && origin.name, msg, socket, wireMessage);
          }
        }
        break;
      case 'INVENTORY_RESPONSE':
        // Document inventory reply (may include per-item L1 HTLC offers).
        // JSON `type` may be legacy `INVENTORY_RESPONSE` or Fabric alias `FABRIC_DOCUMENT_OFFER_RESPONSE`.
        // Prefer AMP signer over untrusted item.sellerPubkey when funding HTLCs.
        this.emit('inventoryResponse', {
          message: msg,
          origin,
          socket,
          signerPubkeyHex: signerPubkeyHex || null
        });
        if (this.settings.relayInventoryResponse) {
          this._relayGenericPayload(origin && origin.name, msg, socket, wireMessage);
        }
        break;
      case 'DocumentContentKeyReveal': {
        const reveal = (msg && msg.object) ? msg.object : msg;
        const claimReveal = this._claimLogicalRegistrationOrPunish(
          'DocumentContentKeyReveal', reveal, signerPubkeyHex, origin && origin.name);
        if (claimReveal.duplicate) {
          if (this.settings.debug) {
            this.emit('debug', '[FABRIC:PEER] Ignoring duplicate DocumentContentKeyReveal');
          }
          break;
        }
        // Reverse-relay key reveal along private DocumentRequest route when we are not the buyer.
        if (reveal && reveal.routeId && this._documentRelayRoutes[reveal.routeId]) {
          const route = this._documentRelayRoutes[reveal.routeId];
          const prev = route.prevHopAddress;
          if (prev && this.connections[prev] && this.connections[prev]._writeFabric &&
              !(origin && origin.name === prev)) {
            const fwdBody = {
              type: KEY_REVEAL_TYPE,
              object: Object.assign({}, reveal, { routeId: route.prevRouteId || reveal.routeId })
            };
            const fwdMsg = Message.fromVector(['GenericMessage', JSON.stringify(fwdBody)]);
            fwdMsg.signWithKey(this.key);
            this.connections[prev]._writeFabric(fwdMsg.toBuffer());
            this.emit('documentRelayReturn', {
              routeId: reveal.routeId,
              prevHopAddress: prev,
              documentId: reveal.documentId,
              kind: 'keyReveal',
              origin
            });
            break;
          }
        }
        this._handleDocumentContentKeyReveal(reveal, origin);
        break;
      }
      case 'P2P_SESSION_OFFER':
        this._handleSessionOfferGenericMessage(msg, origin, socket, signerPubkeyHex, handleOpts);
        break;
      case 'P2P_SESSION_OPEN':
        this._handleSessionOpenGenericMessage(msg, origin, signerPubkeyHex, handleOpts);
        break;
      case 'P2P_CHAT_MESSAGE': {
        // Legacy GenericMessage / P2P_BASE_MESSAGE carrier with JSON body — not accepted.
        // First-class opcode path handles UTF-8 text in _handleFabricMessage.
        this.emit('warning', '[FABRIC:PEER] P2P_CHAT_MESSAGE via GenericMessage/JSON is unsupported; use first-class UTF-8 body');
        break;
      }
      case 'P2P_STATE_ANNOUNCE': {
        const stateObj = msg.object || message.object;
        const claimState = this._claimLogicalRegistrationOrPunish(
          'P2P_STATE_ANNOUNCE', stateObj, signerPubkeyHex, origin && origin.name);
        if (claimState.duplicate) {
          if (this.settings.debug) {
            this.emit('debug', '[FABRIC:PEER] Ignoring duplicate P2P_STATE_ANNOUNCE');
          }
          break;
        }
        const state = new Actor(stateObj && stateObj.state);
        this.emit('debug', `state_announce <Generic>${JSON.stringify(stateObj || '')} ${state.toGenericMessage()}`);
        break;
      }
      case 'P2P_PEER_GOSSIP': {
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
        // Onion peel / relay-as-is: observe locally only — do not burn last-hop
        // gossip budget or mesh-relay under that hop.
        const gossipLocalOnly = peeledForward || handleOpts.relayedAsIs === true;
        if (gossipLocalOnly) {
          this.emit('peeringGossip', { message, origin, peeledForward: true });
          this._gossipRememberPayload(payloadKey);
          break;
        }
        if (!this._gossipRateLimitAllow(origin.name)) break;
        this.emit('peeringGossip', { message, origin });
        this._gossipRememberPayload(payloadKey);
        // Forward original frame only — wire-hash dedup stops loops; never hop-re-sign.
        if (wireMessage) this.relayFrom(origin.name, wireMessage);
        break;
      }
      case 'P2P_PEERING_OFFER': {
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
        // Onion peel: observe locally only — do not burn last-hop peering budget,
        // enqueue attacker-chosen dial targets, or mesh-relay under that hop.
        if (peeledForward) {
          this.emit('peeringOffer', { message, origin, peeledForward: true });
          this._peeringRememberPayload(payloadKey);
          break;
        }
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
        if (wireMessage) this.relayFrom(origin.name, wireMessage);
        break;
      }
      case 'P2P_PING':
        const now = (new Date()).toISOString();
        const P2P_PONG = Message.fromVector(['P2P_PONG', JSON.stringify({
          created: now
        })]).signWithKey(this.key);
        if (this.connections[origin.name] && this.connections[origin.name]._writeFabric) {
          this.connections[origin.name]._writeFabric(P2P_PONG.toBuffer());
        }
        break;
      case 'P2P_PONG': {
        const conn = origin && origin.name ? this.connections[origin.name] : null;
        const outstanding = conn && (conn._fabricPingOutstanding | 0);
        if (!outstanding) {
          if (this.settings.debug) {
            this.emit('debug', `[FABRIC:PEER] Ignoring P2P_PONG from ${origin && origin.name}: no outbound ping pending`);
          }
          break;
        }
        conn._fabricPingOutstanding = 0;

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
      }
      case 'P2P_PEER_ALIAS':
        // Legacy GenericMessage/JSON carrier — not accepted. First-class UTF-8 path above.
        this.emit('warning', '[FABRIC:PEER] P2P_PEER_ALIAS via GenericMessage/JSON is unsupported; use first-class UTF-8 body');
        break;
      case 'P2P_PEER_ANNOUNCE': {
        const announceObj = msg.object || message.object;
        const claimAnn = this._claimLogicalRegistrationOrPunish(
          'P2P_PEER_ANNOUNCE', announceObj, signerPubkeyHex, origin && origin.name);
        if (claimAnn.duplicate) {
          if (this.settings.debug) {
            this.emit('debug', '[FABRIC:PEER] Ignoring duplicate P2P_PEER_ANNOUNCE');
          }
          break;
        }
        this.emit('debug', `peer_announce <Generic>${JSON.stringify(announceObj || '')}`);
        const host = announceObj && announceObj.host;
        const port = announceObj && announceObj.port;
        if (host != null && port != null) {
          this._enqueuePeeringCandidate(host, port);
        }
        break;
      }
      case 'P2P_DOCUMENT_PUBLISH': {
        const priceObj = msg.object || message.object;
        const claimPrice = this._claimLogicalRegistrationOrPunish(
          'P2P_DOCUMENT_PUBLISH', priceObj, signerPubkeyHex, origin && origin.name);
        if (claimPrice.duplicate) {
          if (this.settings.debug) {
            this.emit('debug', '[FABRIC:PEER] Ignoring duplicate P2P_DOCUMENT_PUBLISH pricing frame');
          }
          break;
        }
        this.emit('documentPublish', {
          message,
          origin,
          socket,
          documentId: priceObj && priceObj.hash,
          rateSats: priceObj && priceObj.rate,
          contentHash: priceObj && priceObj.contentHash,
          source: 'pricing'
        });
        break;
      }
      case 'P2P_FILE_SEND': {
        // Reverse private-relay path: forward toward buyer before local ingest.
        // Typed wire is wrapped as `{ type, object }` before Generic dispatch — use
        // msg.object (not message.data, which only exists on raw Message).
        try {
          let fileObj = null;
          if (msg && msg.object && typeof msg.object === 'object' && !Array.isArray(msg.object)) {
            fileObj = msg.object;
          } else if (message && message.data != null) {
            const rawFile = messageDataToString(message.data);
            const prFile = tryParseWireJsonBody(rawFile);
            if (prFile.ok && prFile.value && typeof prFile.value === 'object') fileObj = prFile.value;
          } else if (wireMessage && wireMessage.data != null) {
            const rawFile = messageDataToString(wireMessage.data);
            const prFile = tryParseWireJsonBody(rawFile);
            if (prFile.ok && prFile.value && typeof prFile.value === 'object') fileObj = prFile.value;
          }
          if (fileObj && this._maybeReverseRelayFileSend(fileObj, origin)) {
            break;
          }
        } catch (_) { /* fall through to ingest */ }
        const ingest = this._ingestP2pFileSend(msg || message, origin);
        this.emit('file', Object.assign({ message, origin }, ingest));
        if (ingest && ingest.status === 'complete' && ingest.buffer) {
          this.emit('documentReceived', {
            documentId: ingest.documentId,
            buffer: ingest.buffer,
            merkleRootHex: ingest.merkleRootHex,
            verified: !!ingest.verified,
            legacy: !!ingest.legacy,
            origin
          });
        } else if (ingest && ingest.status === 'awaiting_key') {
          this.emit('documentAwaitingKey', {
            documentId: ingest.documentId,
            merkleRootHex: ingest.merkleRootHex,
            origin
          });
        } else if (ingest && ingest.status === 'reject') {
          this.emit('documentBlobRejected', {
            documentId: ingest.documentId,
            error: ingest.error,
            blobIndex: ingest.blobIndex,
            origin
          });
        }
        break;
      }
      case 'CONTRACT_PUBLISH': {
        this.emit('debug', `Handling peer contract publish: ${JSON.stringify(msg.object)}`);
        if (!msg.object || typeof msg.object !== 'object') break;
        const publishedId = (new Actor(msg.object)).id;
        const claimPub = this._claimLogicalRegistrationOrPunish(
          'CONTRACT_PUBLISH', msg.object, signerPubkeyHex, origin && origin.name);
        if (claimPub.duplicate) {
          if (this.settings.debug) {
            this.emit('debug',
              `[FABRIC:PEER] Ignoring duplicate CONTRACT_PUBLISH for ${publishedId} (no allow-list / emit / relay)`);
          }
          break;
        }
        this._registerContract(msg.object, signerPubkeyHex);
        this.emit('contract:publish', {
          contract: publishedId,
          object: msg.object,
          origin,
          signer: signerPubkeyHex || null
        });
        if (origin && origin.name && wireMessage) {
          this.relayFrom(origin.name, wireMessage);
        }
        break;
      }
      case 'CONTRACT_MESSAGE': {
        if (this.settings.debug) this.emit('debug', `Handling contract message: ${JSON.stringify(msg.object)}`);
        const contractId = msg.object && msg.object.contract ? String(msg.object.contract) : null;
        if (!contractId) {
          this.emit('warning', '[FABRIC:PEER] CONTRACT_MESSAGE missing `contract` namespace id; dropped');
          break;
        }
        const registered = !!(this._state.content.contracts && this._state.content.contracts[contractId]);
        // State ops only apply to locally registered contract namespaces —
        // unknown ids must not crash the peer (message may still be app-consumed).
        if (registered && Array.isArray(msg.object.ops) && msg.object.ops.length) {
          if (!this._signerMayPatchContract(contractId, signerPubkeyHex)) {
            this.emit('warning',
              `[FABRIC:PEER] CONTRACT_MESSAGE ops rejected for ${contractId}: signer not in contract allow-list` +
              `${peeledForward ? ' (peeled forward)' : ''}`);
            const opsPs = this.settings.peerScore || {};
            // Onion peel: do not cut the honest last-hop TCP link for an unauthorized inner.
            this._applyPeerMisbehavior(peeledForward ? null : (origin && origin.name), 'contract-ops-forbidden', {
              penalty: Number(opsPs.contractOpsForbiddenPenalty) || PEER_SCORE_CONTRACT_OPS_FORBIDDEN_PENALTY,
              disconnect: !peeledForward
            });
            // Do not emit or relay — forbidden ops must not be laundered through the mesh.
            break;
          }
          try {
            manager.applyPatch(this._state.content.contracts[contractId], msg.object.ops);
            this.commit();
          } catch (exception) {
            this.emit('warning', `[FABRIC:PEER] CONTRACT_MESSAGE patch failed for ${contractId}: ${exception.message}`);
            break;
          }
        }
        this.emit('contract:message', {
          contract: contractId,
          registered,
          object: msg.object,
          origin,
          signer: signerPubkeyHex || null
        });
        if (origin && origin.name && wireMessage) {
          this.relayFrom(origin.name, wireMessage);
        }
        break;
      }
    }
  }

  _NOISESocketHandler (socket) {
    const target = `${socket.remoteAddress}:${socket.remotePort}`;
    const url = `tcp://${target}`;

    if (this._isPeerBanned(target)) {
      this.emit('warning', `[FABRIC:PEER] Refusing inbound from banned address ${target}`);
      if (typeof socket.destroy === 'function') socket.destroy();
      return;
    }

    // Store a unique actor for this inbound connection
    this._registerActor({ name: target });

    const _derived = this.identity.key.derive(FABRIC_KEY_DERIVATION_PATH);
    if (this.settings.debug) {
      this.emit('debug', 'NOISE inbound: session key derived for handshake (private key not logged)');
    }

    // Create NOISE handler
    const handler = noise({
      prologue: Buffer.from(PROLOGUE),
      // privateKey: _derived.private.toString('hex'),
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
    handler.encrypt.on('handshake', (_lk, localPk, remotePk) => {
      if (this.settings.debug) {
        // Transport diagnostics only — never log private key material from the handshake.
        this.emit('debug', `Peer transport handshake using local public key: ${localPk.toString('hex')}`);
        this.emit('debug', `Peer transport handshake with remote public key: ${remotePk.toString('hex')}`);
      }
      if (remotePk != null) {
        const pkHex = normalizePeerPubkeyHex(Buffer.isBuffer(remotePk) ? Buffer.from(remotePk) : remotePk);
        if (pkHex) {
          this._inboundNoiseStaticPubkeyByAddress[target] = pkHex;
          if (this._isPeerBanned(target, pkHex)) {
            this.emit('warning', `[FABRIC:PEER] Closing inbound: banned Noise static ${pkHex.slice(0, 16)}…`);
            if (typeof socket.destroy === 'function') socket.destroy();
          }
        }
      }
    });
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
      if (this.peers[target] && typeof this.peers[target] === 'object') {
        this.peers[target].status = 'disconnected';
      }
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
    this._startFabricPingKeepalive(socket, handler.encrypt);

    // Begin NOISE stream
    handler.encrypt.pipe(socket).pipe(handler.decrypt);

    this.emit('connections:open', {
      id: target,
      url: url
    });
  }

  /**
   * Build hub-compatible document metadata for {@link purchaseContentHashHex}.
   * @param {String} documentId
   * @param {String} content UTF-8 body
   * @returns {Object} Parsed document record (whitelisted fields)
   */
  _buildDocumentParsedForPublish (documentId, content) {
    const buf = Buffer.from(content === null || content === undefined ? '' : String(content), 'utf8');
    return {
      id: documentId,
      name: (documentId && String(documentId).split('/').pop()) || 'document',
      mime: 'text/plain',
      revision: 1,
      contentBase64: buf.toString('base64'),
      size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex')
    };
  }

  /**
   * Items for Hub-style `kind: 'documents'` inventory (Fabric UI / `@fabric/hub` merge expects `object.kind`).
   * @param {Object} [req] request object subset
   * @returns {object[]}
   */
  _collectDocumentCatalogInventoryItems (_req) {
    const docs = this._state.content.documents;
    if (!docs || typeof docs !== 'object') return [];
    const collections = this._state.content.collections && typeof this._state.content.collections.documents === 'object'
      ? this._state.content.collections.documents
      : {};
    const rates = this._state.content.documentRates || {};
    /** @type {object[]} */
    const items = [];
    for (const docId of Object.keys(docs)) {
      const body = docs[docId];
      const parsed = this._buildDocumentParsedForPublish(docId, body);
      const row = collections[docId];
      const purchaseFromCollection = row && Number(row.purchasePriceSats) > 0 ? Math.round(Number(row.purchasePriceSats)) : null;
      const rateSats = Object.prototype.hasOwnProperty.call(rates, docId) ? rates[docId] : 0;
      const purchasePriceSats = purchaseFromCollection != null ? purchaseFromCollection : (Number(rateSats) > 0 ? Math.round(Number(rateSats)) : undefined);
      const published = row ? !!row.published : true;
      items.push({
        id: parsed.id,
        sha256: parsed.sha256 || parsed.id,
        name: parsed.name,
        mime: parsed.mime || 'application/octet-stream',
        size: parsed.size,
        created: parsed.created || new Date().toISOString(),
        published,
        ...(purchasePriceSats != null && purchasePriceSats > 0 ? { purchasePriceSats } : {}),
        ...(row && row.bitcoinHeight != null && Number.isFinite(Number(row.bitcoinHeight))
          ? { bitcoinHeight: Math.round(Number(row.bitcoinHeight)) }
          : {}),
        ...(row && row.bitcoinBlockHash ? { bitcoinBlockHash: String(row.bitcoinBlockHash) } : {}),
        ...(row && row.bitcoinTxid ? { bitcoinTxid: String(row.bitcoinTxid) } : {})
      });
    }
    return items;
  }

  /**
   * Write {@link INVENTORY_RESPONSE} (`P2P_INVENTORY_RESPONSE`) compatible with `@fabric/hub` Bridge merging
   * (body includes `kind: 'documents'` so the browser can merge `object.items`).
   * @param {string} originName connection key {@link Peer#connections}
   * @param {object[]} items
   * @param {Object} [opts]
   * @param {boolean} [opts.allowEmpty]
   * @returns {boolean}
   */
  _sendLocalInventoryDocumentsWireResponse (originName, items, opts = {}) {
    const allowEmpty = !!(opts && opts.allowEmpty);
    if (!originName || !Array.isArray(items)) return false;
    if (!allowEmpty && items.length === 0) return false;
    const conn = this.connections[originName];
    if (!conn || !conn._writeFabric) return false;
    const obj = {
      kind: 'documents',
      items,
      created: Date.now()
    };
    const m = Message.fromVector(['P2P_INVENTORY_RESPONSE', JSON.stringify(obj)]);
    m.signWithKey(this.key);
    conn._writeFabric(m.toBuffer());
    return true;
  }

  /**
   * Reply to `INVENTORY_REQUEST` with `INVENTORY_RESPONSE` built from local documents and rates.
   * @param {{type: string, object: (Object|undefined)}} message Generic body from {@link Peer#_handleGenericMessage}
   * @param {{ name: string }} origin
   * @returns {boolean} true if an `INVENTORY_RESPONSE` was written to the requester
   */
  _respondInventoryFromLocalDocuments (message, origin) {
    if (!origin || !origin.name) return false;
    const req = message.object || {};
    const docs = this._state.content.documents;
    if (!docs || typeof docs !== 'object') return false;

    if (req.offerBtc === true) {
      const rates = this._state.content.documentRates || {};
      const maxSats = req.maxSats;
      const chunkBytes = Math.max(1, Number(this.settings.inventoryBlobChunkBytes) || DEFAULT_CHUNK_BYTES);
      /** @type {object[]} */
      const items = [];
      for (const docId of Object.keys(docs)) {
        const body = docs[docId];
        const parsed = this._buildDocumentParsedForPublish(docId, body);
        const rateSats = Object.prototype.hasOwnProperty.call(rates, docId) ? rates[docId] : 0;
        if (maxSats != null && Number.isFinite(maxSats) && rateSats > maxSats) continue;
        const sealedMeta = this._getDocumentSealedMeta(docId);
        const bodyBuf = Buffer.from(String(body == null ? '' : body), 'utf8');
        const advertiseBuf = sealedMeta ? sealedMeta.ciphertext : bodyBuf;
        const resolved = resolveDocumentContentHashHex({
          documentId: docId,
          parsed,
          sealedMeta: sealedMeta || undefined,
          sealed: !!sealedMeta
        });
        const contentHash = resolved.contentHashHex;
        const item = {
          id: docId,
          rateSats,
          contentHash,
          contentHashHex: contentHash,
          binding: resolved.binding,
          network: 'bitcoin',
          size: sealedMeta ? sealedMeta.ciphertext.length : bodyBuf.length
        };
        // Always advertise a DocumentBlobIndex (one blob when small; many when large).
        const advertised = sealedMeta
          ? advertiseSealedDocument({
            ciphertext: sealedMeta.ciphertext,
            paymentHashHex: sealedMeta.paymentHashHex,
            encryption: sealedMeta.encryption,
            plaintextSha256: sealedMeta.plaintextSha256
          }, {
            documentId: docId,
            chunkBytes,
            rateSats
          })
          : advertiseDocumentBlobs(advertiseBuf, {
            documentId: docId,
            chunkBytes,
            rateSats,
            includePaymentHashes: true
          });
        if (sealedMeta) {
          item.sealed = true;
          item.encryption = sealedMeta.encryption;
          item.plaintextSha256 = sealedMeta.plaintextSha256;
        }
        item.merkleRootHex = advertised.merkleRootHex;
        item.documentBlobIndex = advertised.index;
        item.contentSha256 = advertised.contentSha256;
        item.chunkBytes = advertised.chunkBytes;
        item.blobTotal = advertised.blobs.length;
        // Keep inventory AMP-sized: inline leaf list only when the index fits.
        if (advertised.index.leavesInline !== false) {
          item.blobs = advertised.itemBlobs;
        } else {
          item.blobs = [];
          item.leavesInline = false;
        }
        if (this.settings.attachInventoryHtlc && rateSats > 0) {
          try {
            if (sealedMeta) {
              // One HTLC bound to SHA256(content key) — claim reveals K.
              const htlc = this._attachHtlcOfferToItem(item, req, sealedMeta.paymentHashHex, rateSats);
              if (htlc) item.htlc = htlc;
            } else if (Array.isArray(item.blobs) && item.blobs.length) {
              for (const b of item.blobs) {
                const payHash = b.contentHash || contentHash;
                const amt = Number(b.rateSats != null ? b.rateSats : rateSats) || rateSats;
                const htlc = this._attachHtlcOfferToItem(
                  { id: `${docId}#${b.index}` },
                  req,
                  payHash,
                  amt
                );
                if (htlc) b.htlc = htlc;
              }
              if (item.blobs.length === 1 && item.blobs[0].htlc) {
                item.htlc = item.blobs[0].htlc;
              }
            } else {
              const htlc = this._attachHtlcOfferToItem(item, req, contentHash, rateSats);
              if (htlc) item.htlc = htlc;
            }
          } catch (e) {
            this.emit('warning', `[FABRIC:PEER] inventory HTLC attach failed for ${docId}: ${e.message}`);
          }
        }
        items.push(item);
      }
      if (!items.length) return false;
      return this._sendLocalInventoryDocumentsWireResponse(origin.name, items);
    }

    const reqKind = String(req.kind || '').trim().toLowerCase();
    if (reqKind !== 'documents') return false;
    const items = this._collectDocumentCatalogInventoryItems({});
    return this._sendLocalInventoryDocumentsWireResponse(origin.name, items, { allowEmpty: true });
  }

  /**
   * @param {string} documentId
   * @returns {object|null}
   */
  _getDocumentSealedMeta (documentId) {
    const sealed = this._state.content.documentSealed || {};
    const row = sealed[documentId];
    if (!row || !row.ciphertextBase64) return null;
    return {
      ciphertext: Buffer.from(String(row.ciphertextBase64), 'base64'),
      paymentHashHex: row.paymentHashHex,
      encryption: row.encryption,
      plaintextSha256: row.plaintextSha256,
      keyHex: (this._state.content.documentContentKeys || {})[documentId] || row.keyHex || null
    };
  }

  /**
   * Send a locally stored document as indexed, wire-sized `P2P_FILE_SEND` blobs.
   * Priced sealed docs send **ciphertext** (safe without the content key).
   * @param {string} documentId
   * @param {string} peerAddress connection key in {@link Peer#connections}
   * @param {Object} [opts]
   * @param {number} [opts.blobIndex]
   * @param {boolean} [opts.revealKey]
   * @param {string} [opts.settlementId]
   * @param {string} [opts.routeId]
   * @returns {boolean} true if at least one frame was written
   */
  _sendP2pFileSendToPeer (documentId, peerAddress, opts = {}) {
    const docs = this._state.content.documents;
    if (!docs || !Object.prototype.hasOwnProperty.call(docs, documentId)) return false;
    const conn = peerAddress && this.connections[peerAddress];
    if (!conn || !conn._writeFabric) return false;
    const chunkBytes = Math.max(1, Number(this.settings.inventoryBlobChunkBytes) || DEFAULT_CHUNK_BYTES);
    const sealedMeta = this._getDocumentSealedMeta(documentId);
    const bodyBuf = sealedMeta
      ? sealedMeta.ciphertext
      : Buffer.from(String(docs[documentId] == null ? '' : docs[documentId]), 'utf8');
    const split = splitBlobs(bodyBuf, chunkBytes, documentId);
    const only = opts.blobIndex != null ? Math.round(Number(opts.blobIndex)) : null;
    let wrote = 0;
    for (const b of split.blobs) {
      if (only != null && b.index !== only) continue;
      const fileObj = {
        name: documentId,
        body: b.bytes.toString('base64'),
        blobIndex: b.index,
        blobTotal: b.total,
        blobHashHex: b.blobHashHex,
        merkleRootHex: split.merkleRootHex,
        contentSha256: split.contentSha256,
        chunkBytes: split.chunkBytes
      };
      if (opts.routeId) fileObj.routeId = String(opts.routeId);
      if (sealedMeta) {
        fileObj.sealed = true;
        fileObj.paymentHashHex = sealedMeta.paymentHashHex;
        fileObj.iv = sealedMeta.encryption && sealedMeta.encryption.iv;
        fileObj.scheme = sealedMeta.encryption && sealedMeta.encryption.scheme;
        fileObj.plaintextSha256 = sealedMeta.plaintextSha256;
      }
      const reply = Message.fromVector(['P2P_FILE_SEND', JSON.stringify(fileObj)]);
      reply.signWithKey(this.key);
      conn._writeFabric(reply.toBuffer());
      wrote += 1;
    }
    if (wrote > 0 && opts.revealKey && sealedMeta && sealedMeta.keyHex) {
      this._sendDocumentContentKeyReveal(documentId, peerAddress, {
        settlementId: opts.settlementId || null,
        routeId: opts.routeId || null
      });
    }
    return wrote > 0;
  }

  /**
   * Reveal the AES content key to a peer (only after payment-hash match).
   * @param {string} documentId
   * @param {string} peerAddress
   * @param {Object} [opts]
   * @param {string} [opts.settlementId]
   * @returns {boolean}
   */
  _sendDocumentContentKeyReveal (documentId, peerAddress, opts = {}) {
    const sealedMeta = this._getDocumentSealedMeta(documentId);
    if (!sealedMeta || !sealedMeta.keyHex) return false;
    const conn = peerAddress && this.connections[peerAddress];
    if (!conn || !conn._writeFabric) return false;
    let body;
    try {
      body = buildKeyRevealMessage({
        documentId,
        keyHex: sealedMeta.keyHex,
        paymentHashHex: sealedMeta.paymentHashHex,
        iv: sealedMeta.encryption && sealedMeta.encryption.iv,
        scheme: sealedMeta.encryption && sealedMeta.encryption.scheme,
        plaintextSha256: sealedMeta.plaintextSha256,
        settlementId: opts.settlementId
      });
    } catch (err) {
      this.emit('warning', `[FABRIC:PEER] key reveal build failed: ${err.message}`);
      return false;
    }
    if (opts.routeId) body.object.routeId = String(opts.routeId);
    const msg = Message.fromVector(['GenericMessage', JSON.stringify(body)]);
    msg.signWithKey(this.key);
    conn._writeFabric(msg.toBuffer());
    this.emit('documentContentKeyRevealed', {
      documentId,
      peerAddress,
      paymentHashHex: sealedMeta.paymentHashHex
    });
    return true;
  }

  /**
   * Verify / accumulate an inbound `P2P_FILE_SEND` against the DocumentBlobIndex rules.
   * Sealed frames store ciphertext until {@link KEY_REVEAL_TYPE}.
   * @param {Message|Object} message
   * @param {Object} origin
   * @param {string} [origin.name]
   * @returns {Object}
   */
  _ingestP2pFileSend (message, origin) {
    // Typed wire → Generic dispatch uses `{ type, object }`; raw Message has `.data`.
    let obj = null;
    if (message && message.object && typeof message.object === 'object' && !Array.isArray(message.object)) {
      obj = message.object;
    } else if (message && message.data != null) {
      const raw = messageDataToString(message.data);
      const pr = tryParseWireJsonBody(raw);
      if (pr.ok && pr.value && typeof pr.value === 'object') obj = pr.value;
    } else if (message && typeof message === 'object' && (message.name || message.body)) {
      obj = message;
    }
    if (!obj) {
      return { status: 'reject', error: 'invalid P2P_FILE_SEND JSON' };
    }
    const frame = parseFileSendObject(obj);
    const result = this.blobTransfers.ingest(frame);
    if (result.status === 'complete' && result.buffer && result.documentId) {
      const sealed = !!(obj.sealed || (frame && !frame.legacy && obj.paymentHashHex && obj.iv));
      if (sealed) {
        this.pendingSealedDeliveries[result.documentId] = {
          ciphertext: result.buffer,
          merkleRootHex: result.merkleRootHex,
          paymentHashHex: obj.paymentHashHex || null,
          iv: obj.iv || null,
          scheme: obj.scheme || null,
          plaintextSha256: obj.plaintextSha256 || null,
          origin: origin || null,
          updated: Date.now()
        };
        this._capPendingSealedDeliveries();
        this.emit('documentCiphertextReceived', {
          documentId: result.documentId,
          buffer: result.buffer,
          merkleRootHex: result.merkleRootHex,
          paymentHashHex: obj.paymentHashHex || null,
          verified: true,
          origin
        });
        return Object.assign({ origin, sealed: true, awaitingKey: true }, result, {
          // Do not treat ciphertext as the final document.
          status: 'awaiting_key',
          buffer: null
        });
      }
      if (!this._state.content.documents) this._state.content.documents = {};
      if (!Object.prototype.hasOwnProperty.call(this._state.content.documents, result.documentId)) {
        this._state.content.documents[result.documentId] = result.buffer.toString('utf8');
      }
    }
    return Object.assign({ origin }, result);
  }

  /**
   * Apply a content-key reveal to a pending sealed delivery.
   * @param {Object} reveal
   * @param {Object} [origin]
   * @param {string} [origin.name]
   * @returns {Object}
   */
  _handleDocumentContentKeyReveal (reveal, origin = null) {
    const documentId = String((reveal && reveal.documentId) || '').trim();
    const pending = documentId ? this.pendingSealedDeliveries[documentId] : null;
    if (!pending) {
      return { ok: false, error: 'no pending sealed delivery', documentId };
    }
    const opened = openSealedDelivery({
      keyHex: reveal.keyHex,
      paymentHashHex: reveal.paymentHashHex || pending.paymentHashHex,
      iv: reveal.iv || pending.iv,
      plaintextSha256: reveal.plaintextSha256 || pending.plaintextSha256
    }, pending.ciphertext);
    if (!opened.ok) {
      this.emit('documentBlobRejected', {
        documentId,
        error: opened.error || 'open failed',
        origin
      });
      return { ok: false, error: opened.error, documentId };
    }
    delete this.pendingSealedDeliveries[documentId];
    if (!this._state.content.documents) this._state.content.documents = {};
    this._state.content.documents[documentId] = opened.plaintext.toString('utf8');
    const ev = {
      documentId,
      buffer: opened.plaintext,
      merkleRootHex: pending.merkleRootHex,
      verified: true,
      sealed: true,
      opened: true,
      origin: origin || pending.origin
    };
    this.emit('documentReceived', ev);
    this.emit('documentOpened', ev);
    return { ok: true, documentId, buffer: opened.plaintext };
  }

  /**
   * Open a pending sealed delivery using an HTLC claim preimage (on-chain witness).
   * @param {string} documentId
   * @param {string} preimageHex
   * @returns {{ok: boolean, error: (string|undefined), buffer: (Buffer|undefined)}}
   */
  openSealedDeliveryWithPreimage (documentId, preimageHex) {
    const id = String(documentId || '').trim();
    const pending = id ? this.pendingSealedDeliveries[id] : null;
    if (!pending) return { ok: false, error: 'no pending sealed delivery', documentId: id };
    const opened = openWithClaimPreimage({
      ciphertext: pending.ciphertext,
      preimageHex,
      paymentHashHex: pending.paymentHashHex,
      iv: pending.iv,
      plaintextSha256: pending.plaintextSha256
    });
    if (!opened.ok) {
      this.emit('documentBlobRejected', {
        documentId: id,
        error: opened.error || 'open with preimage failed'
      });
      return { ok: false, error: opened.error, documentId: id };
    }
    delete this.pendingSealedDeliveries[id];
    if (!this._state.content.documents) this._state.content.documents = {};
    this._state.content.documents[id] = opened.plaintext.toString('utf8');
    const ev = {
      documentId: id,
      buffer: opened.plaintext,
      merkleRootHex: pending.merkleRootHex,
      verified: true,
      sealed: true,
      opened: true,
      fromClaim: true,
      origin: pending.origin
    };
    this.emit('documentReceived', ev);
    this.emit('documentOpened', ev);
    return { ok: true, documentId: id, buffer: opened.plaintext };
  }

  /**
   * Public helper: push document bytes to a peer (same wire path as {@link Peer#_handleDocumentRequestWire} fulfillment).
   * @param {string} documentId
   * @param {string} peerAddress
   * @param {Object} [opts]
   * @param {number} [opts.blobIndex]
   * @param {boolean} [opts.revealKey]
   * @returns {boolean}
   */
  sendDocumentFileToPeer (documentId, peerAddress, opts = {}) {
    const resolved = this._resolveToAddress(peerAddress) || peerAddress;
    return this._sendP2pFileSendToPeer(documentId, resolved, opts);
  }

  /**
   * Ask a connected peer for their document catalog (`kind: 'documents'`) or L1 offers (`offerBtc`).
   * @param {string} peerAddress connection key, Fabric id, or host:port
   * @param {Object} [opts]
   * @param {boolean} [opts.offerBtc=false]
   * @param {string} [opts.kind='documents']
   * @param {number} [opts.maxSats]
   * @returns {boolean}
   */
  requestPeerInventory (peerAddress, opts = {}) {
    const resolved = this._resolveToAddress(peerAddress) || peerAddress;
    const conn = resolved && this.connections[resolved];
    if (!conn || !conn._writeFabric) return false;
    const object = {};
    if (opts.offerBtc === true) {
      object.offerBtc = true;
      if (opts.maxSats != null && Number.isFinite(Number(opts.maxSats))) {
        object.maxSats = Number(opts.maxSats);
      }
      if (opts.buyerRefundPublicKey) {
        object.buyerRefundPublicKey = String(opts.buyerRefundPublicKey);
      }
    } else {
      object.kind = String(opts.kind || 'documents');
      object.created = Date.now();
    }
    const m = Message.fromVector(['P2P_INVENTORY_REQUEST', JSON.stringify(object)]);
    m.signWithKey(this.key);
    conn._writeFabric(m.toBuffer());
    return true;
  }

  /**
   * Send a signed `DocumentRequest` to one peer (or broadcast when peerAddress is omitted).
   * @param {string} documentId
   * @param {string} [peerAddress]
   * @param {object} [opts]
   * @param {number} [opts.maxSats]
   * @param {number} [opts.relayHop]
   * @param {number} [opts.blobIndex]
   * @param {number} [opts.blobTotal]
   * @param {string} [opts.contentHashHex]
   * @returns {boolean}
   */
  requestDocument (documentId, peerAddress = null, opts = {}) {
    if (!documentId) return false;

    const body = { document: documentId };
    if (opts.maxSats != null && Number.isFinite(Number(opts.maxSats))) {
      body.maxSats = Math.round(Number(opts.maxSats));
      body.relayHop = opts.relayHop != null
        ? Math.round(Number(opts.relayHop))
        : Math.round(Number(this.settings.documentRelayMaxHops) || 4);
      body.routeId = crypto.randomBytes(8).toString('hex');
    }
    if (opts.blobIndex != null) body.blobIndex = Number(opts.blobIndex);
    if (opts.blobTotal != null) body.blobTotal = Number(opts.blobTotal);
    {
      const hash = contentHashHexFromObject(opts) || contentHashHexFromObject({ contentHashHex: opts.contentHashHex });
      if (hash) body.contentHashHex = hash;
    }

    const msg = Message.fromVector(['DocumentRequest', JSON.stringify(body)]);
    msg.signWithKey(this.key);
    const buf = msg.toBuffer();
    if (peerAddress) {
      const resolved = this._resolveToAddress(peerAddress) || peerAddress;
      const conn = resolved && this.connections[resolved];
      if (!conn || !conn._writeFabric) return false;
      conn._writeFabric(buf);
      return true;
    }
    this.broadcast(buf);
    return true;
  }

  /**
   * @param {object} item
   * @param {object} req inventory request object
   * @param {string} contentHashHex
   * @param {number} amountSats
   * @returns {object|null}
   */
  _attachHtlcOfferToItem (item, req, contentHashHex, amountSats) {
    const buyerHex = req.buyerRefundPublicKey || req.buyerRefundPubkey;
    if (!buyerHex || !/^[0-9a-fA-F]{66}$/.test(String(buyerHex))) return null;
    let sellerCompressed = null;
    try {
      if (this.key && this.key.public && typeof this.key.public.encodeCompressed === 'function') {
        sellerCompressed = Buffer.from(this.key.public.encodeCompressed('hex'), 'hex');
      }
    } catch (_) { /* ignore */ }
    if (!sellerCompressed) return null;
    const lock = Number(this.settings.inventoryHtlcLocktimeHeight);
    if (!Number.isFinite(lock) || lock < 1) return null;
    const paymentHash32 = Buffer.from(String(contentHashHex), 'hex');
    if (paymentHash32.length !== 32) return null;
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: this.settings.network || 'regtest',
      sellerPubkeyCompressed: sellerCompressed,
      buyerRefundPubkeyCompressed: Buffer.from(String(buyerHex), 'hex'),
      paymentHash32,
      refundLocktimeHeight: lock
    });
    const hints = inventoryHtlc.buildHtlcFundingHints({
      paymentAddress: built.address,
      amountSats: Math.round(Number(amountSats) || 0),
      label: String(item.id || '').slice(0, 32)
    });
    const sellerHex = sellerCompressed.toString('hex');
    return {
      paymentAddress: built.address,
      paymentHashHex: built.paymentHashHex,
      claimScriptHex: built.claimScript.toString('hex'),
      refundScriptHex: built.refundScript.toString('hex'),
      refundLocktimeHeight: lock,
      amountSats: Math.round(Number(amountSats) || 0),
      bitcoinUri: hints.bitcoinUri,
      sellerPublicKeyHex: sellerHex,
      sellerPubkey: sellerHex
    };
  }

  /**
   * @returns {object[]} pending DOCUMENT_REQUEST rows (consent mode)
   */
  listPendingDocumentRequests () {
    return Object.keys(this.pendingDocumentRequests).map((key) => {
      const row = this.pendingDocumentRequests[key];
      return Object.assign({ key }, row);
    });
  }

  /**
   * Approve a pending DOCUMENT_REQUEST and send `P2P_FILE_SEND`.
   * @param {string} requestKey pending key, or document id when unique
   * @returns {{ok: boolean, error: (string|undefined), documentId: (string|undefined), peerAddress: (string|undefined)}}
   */
  approveDocumentRequest (requestKey, opts = {}) {
    const row = this._findPendingDocumentRequest(requestKey);
    if (!row) return { ok: false, error: 'pending request not found' };
    const sendOpts = {};
    if (row.parsed && row.parsed.blobIndex != null) {
      sendOpts.blobIndex = Number(row.parsed.blobIndex);
    }
    const sealedMeta = this._getDocumentSealedMeta(row.documentId);
    // Sealed key reveal requires prior authorizeDocumentKeyReveal (or explicit force).
    if (sealedMeta && this._mayRevealDocumentContentKey(row.documentId, sealedMeta.paymentHashHex, row.parsed || {}, opts)) {
      sendOpts.revealKey = true;
    }
    if (!this._sendP2pFileSendToPeer(row.documentId, row.peerAddress, sendOpts)) {
      return { ok: false, error: 'could not send P2P_FILE_SEND (missing document or connection)' };
    }
    delete this.pendingDocumentRequests[row.key];
    this.emit('documentRequestApproved', row);
    return { ok: true, documentId: row.documentId, peerAddress: row.peerAddress };
  }

  /**
   * Record that settlement for a sealed document was verified so a matching
   * DocumentRequest may receive the AES content key (not merely the ciphertext).
   * @param {object} opts
   * @param {string} opts.documentId
   * @param {string} opts.contentHashHex payment hash SHA256(K)
   * @param {string} [opts.settlementId]
   * @param {string} [opts.txid]
   * @returns {Object} `{ ok, error?, key? }`
   */
  authorizeDocumentKeyReveal (opts = {}) {
    const documentId = String(opts.documentId || '').trim();
    const contentHashHex = String(opts.contentHashHex || opts.paymentHashHex || '').trim().toLowerCase();
    if (!documentId) return { ok: false, error: 'documentId required' };
    if (!/^[0-9a-f]{64}$/.test(contentHashHex)) {
      return { ok: false, error: 'contentHashHex must be 64 hex chars' };
    }
    const key = `${documentId}|${contentHashHex}`;
    this._authorizedDocumentKeyReveals.set(key, {
      documentId,
      contentHashHex,
      settlementId: opts.settlementId || null,
      txid: opts.txid || null,
      authorizedAt: Date.now()
    });
    while (this._authorizedDocumentKeyReveals.size > 4096) {
      const first = this._authorizedDocumentKeyReveals.keys().next().value;
      this._authorizedDocumentKeyReveals.delete(first);
    }
    this.emit('documentKeyRevealAuthorized', this._authorizedDocumentKeyReveals.get(key));
    return { ok: true, key };
  }

  /**
   * @param {string} documentId
   * @param {string} paymentHashHex
   * @param {object} parsed
   * @param {Object} [opts]
   * @param {boolean} [opts.forceReveal]
   * @returns {boolean}
   */
  _mayRevealDocumentContentKey (documentId, paymentHashHex, parsed, opts = {}) {
    if (opts.forceReveal === true) {
      return requestMatchesPaymentHash(parsed, paymentHashHex);
    }
    const authKey = `${String(documentId)}|${String(paymentHashHex || '').toLowerCase()}`;
    const settlementVerified = this._authorizedDocumentKeyReveals.has(authKey);
    return requestUnlocksContentKey(parsed, paymentHashHex, { settlementVerified });
  }

  /**
   * Deny / drop a pending DOCUMENT_REQUEST without sending bytes.
   * @param {string} requestKey
   * @returns {{ok: boolean, error: (string|undefined)}}
   */
  denyDocumentRequest (requestKey) {
    const row = this._findPendingDocumentRequest(requestKey);
    if (!row) return { ok: false, error: 'pending request not found' };
    delete this.pendingDocumentRequests[row.key];
    this.emit('documentRequestDenied', row);
    return { ok: true, documentId: row.documentId, peerAddress: row.peerAddress };
  }

  _findPendingDocumentRequest (requestKey) {
    if (!requestKey) return null;
    if (this.pendingDocumentRequests[requestKey]) {
      return Object.assign({ key: requestKey }, this.pendingDocumentRequests[requestKey]);
    }
    const matches = Object.keys(this.pendingDocumentRequests).filter((k) => {
      return this.pendingDocumentRequests[k].documentId === requestKey;
    });
    if (matches.length === 1) {
      const key = matches[0];
      return Object.assign({ key }, this.pendingDocumentRequests[key]);
    }
    return null;
  }

  _queuePendingDocumentRequest (documentId, origin, parsed) {
    this._pendingDocumentRequestSeq += 1;
    const key = `req-${this._pendingDocumentRequestSeq}`;
    const row = {
      documentId,
      peerAddress: origin && origin.name,
      created: Date.now(),
      parsed: parsed || null
    };
    this.pendingDocumentRequests[key] = row;
    const payload = Object.assign({ key }, row);
    this.emit('documentRequestPending', payload);
    return payload;
  }

  /**
   * AMP buffers for one document: canonical `DocumentPublish`, then optional pricing `P2P_DOCUMENT_PUBLISH`.
   * @param {string} documentId
   * @param {string} body UTF-8 body
   * @param {number} rateSats
   * @returns {Buffer[]}
   */
  _buildPublishDocumentWireBuffers (documentId, body, rateSats) {
    const parsed = this._buildDocumentParsedForPublish(documentId, body);
    const dataStr = fabricCanonicalJson(whitelistedDocumentFields(documentId, parsed));
    const canonical = Message.fromVector(['DocumentPublish', dataStr]);
    canonical.signWithKey(this.key);
    const buffers = [canonical.toBuffer()];
    if (rateSats > 0) {
      const sealedMeta = this._getDocumentSealedMeta(documentId);
      const resolved = resolveDocumentContentHashHex({
        documentId,
        parsed,
        sealedMeta: sealedMeta || undefined,
        sealed: !!sealedMeta
      });
      const contentHash = resolved.contentHashHex;
      const rateMsg = Message.fromVector(['P2P_DOCUMENT_PUBLISH', JSON.stringify({
        type: 'P2P_DOCUMENT_PUBLISH',
        object: {
          hash: documentId,
          rate: rateSats,
          contentHash,
          contentHashHex: contentHash,
          binding: resolved.binding
        }
      })]);
      rateMsg.signWithKey(this.key);
      buffers.push(rateMsg.toBuffer());
    }
    return buffers;
  }

  /**
   * Re-send all local document publishes to one peer (same bytes as {@link Peer#_publishDocument}).
   * @param {string} peerAddress connection key in {@link Peer#connections}
   */
  _announceLocalDocumentsToPeer (peerAddress) {
    const docs = this._state.content.documents;
    if (!docs || typeof docs !== 'object') return;
    const rates = this._state.content.documentRates || {};
    const conn = peerAddress && this.connections[peerAddress];
    if (!conn || !conn._writeFabric) return;
    for (const docId of Object.keys(docs)) {
      const body = docs[docId];
      const rateSats = Object.prototype.hasOwnProperty.call(rates, docId) ? rates[docId] : 0;
      const buffers = this._buildPublishDocumentWireBuffers(docId, body, rateSats);
      for (const buf of buffers) {
        conn._writeFabric(buf);
      }
    }
  }

  /**
   * Store a document locally and gossip to peers.
   * 1) **Canonical** `DOCUMENT_PUBLISH` wire message (same bytes as hub `documentPublishEnvelope`) for L1 `contentHash`.
   * 2) If `rateSats > 0`, a **pricing** `GENERIC` `P2P_DOCUMENT_PUBLISH` with `rate` and `contentHash` (sat ask).
   * @param {String} documentId - Catalog key (e.g. CLI document name).
   * @param {String} [content=''] - UTF-8 body stored under {@link Peer#state}.documents.
   * @param {Number} [rateSats=0] - Ask price in satoshis (gossip only; not part of canonical hash).
   */
  _publishDocument (documentId, content = '', rateSats = 0) {
    if (!this._state.content.documents) this._state.content.documents = {};
    if (!this._state.content.documentRates) this._state.content.documentRates = {};
    if (!this._state.content.documentSealed) this._state.content.documentSealed = {};
    if (!this._state.content.documentContentKeys) this._state.content.documentContentKeys = {};
    const body = (content === null || content === undefined) ? '' : String(content);
    this._state.content.documents[documentId] = body;
    this._state.content.documentRates[documentId] = rateSats;

    // Priced docs: seal plaintext; HTLC payment hash = SHA256(content key).
    if (rateSats > 0 && this.settings.sealPricedDocuments !== false) {
      const sale = prepareSealedSale(Buffer.from(body, 'utf8'));
      this._state.content.documentSealed[documentId] = {
        ciphertextBase64: sale.ciphertext.toString('base64'),
        paymentHashHex: sale.paymentHashHex,
        encryption: sale.encryption,
        plaintextSha256: sale.plaintextSha256
      };
      this._state.content.documentContentKeys[documentId] = sale.keyHex;
    } else {
      delete this._state.content.documentSealed[documentId];
      delete this._state.content.documentContentKeys[documentId];
    }

    this.commit();

    const buffers = this._buildPublishDocumentWireBuffers(documentId, body, rateSats);
    for (const buf of buffers) {
      this.broadcast(buf);
    }

    if (this.settings.debug) {
      this.emit('debug', '[FABRIC:PEER] Published canonical DOCUMENT_PUBLISH + pricing gossip (if rate > 0)');
    }
  }

  /**
   * Handle inbound `DOCUMENT_REQUEST`: emit `documentRequest` / `DocumentRequest`, then either
   * send `P2P_FILE_SEND` (when {@link Peer#settings.autoFulfillDocumentRequests}), queue for
   * operator approve, or relay when the document is not held.
   * @param {Message} message
   * @param {{ name: string }} origin
   * @param {*} socket
   */
  _handleDocumentRequestWire (message, origin, socket) {
    const rawDr = messageDataToString(message.data);
    const prDr = tryParseWireJsonBody(rawDr);
    if (!prDr.ok) return;
    let parsed = prDr.value;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;

    const docId = parsed.document || parsed.id;
    if (!docId) return;

    const docs = this._state.content.documents;
    const held = !!(docs && Object.prototype.hasOwnProperty.call(docs, docId));
    let pendingKey = null;
    if (held && this.settings.autoFulfillDocumentRequests === false) {
      const pending = this._queuePendingDocumentRequest(docId, origin, parsed);
      pendingKey = pending.key;
    }

    const payload = {
      message,
      origin,
      socket,
      documentId: docId,
      parsed,
      source: 'canonical',
      pendingKey
    };
    this.emit('documentRequest', payload);
    this.emit('DocumentRequest', payload);

    if (!held) {
      const budgeted = parsed.maxSats != null && Number.isFinite(Number(parsed.maxSats));
      if (budgeted && this.settings.relayPrivateDocumentRequests) {
        this._privateRelayDocumentRequest(parsed, origin, message);
        return;
      }
      this.relayFrom(origin.name, message, socket);
      return;
    }

    if (this.settings.autoFulfillDocumentRequests === false) {
      return;
    }

    const sendOpts = {};
    if (parsed.blobIndex != null) sendOpts.blobIndex = Number(parsed.blobIndex);
    if (parsed.routeId) sendOpts.routeId = String(parsed.routeId);
    const sealedMeta = this._getDocumentSealedMeta(docId);
    // Ciphertext anytime; content key only after authorizeDocumentKeyReveal (never hash echo).
    if (sealedMeta && this._mayRevealDocumentContentKey(docId, sealedMeta.paymentHashHex, parsed)) {
      sendOpts.revealKey = true;
    }
    if (!this._sendP2pFileSendToPeer(docId, origin.name, sendOpts)) {
      this.emit('warning', `[FABRIC:PEER] DOCUMENT_REQUEST: could not send P2P_FILE_SEND to ${origin && origin.name}`);
    }
  }

  /**
   * Rewrite a budgeted DocumentRequest (privacy) and forward with reduced maxSats.
   * @param {object} parsed
   * @param {{ name: string }} origin
   * @param {Message} [originalMessage]
   */
  _privateRelayDocumentRequest (parsed, origin, originalMessage = null) {
    const seenKey = `${parsed.routeId || ''}:${parsed.document || parsed.id}:${parsed.maxSats}`;
    if (this._documentRelaySeen.has(seenKey)) {
      this.emit('warning', '[FABRIC:PEER] Dropping looped DocumentRequest rewrite');
      return;
    }
    this._documentRelaySeen.add(seenKey);
    if (this._documentRelaySeen.size > 2048) {
      const first = this._documentRelaySeen.values().next().value;
      this._documentRelaySeen.delete(first);
    }

    const policy = {
      documentRelayFeeSats: this.settings.documentRelayFeeSats,
      documentRelayFeeBps: this.settings.documentRelayFeeBps,
      documentRelayMinRemainingSats: this.settings.documentRelayMinRemainingSats,
      documentRelayMaxHops: this.settings.documentRelayMaxHops
    };
    const fwd = buildForwardedDocumentRequest(parsed, policy);
    if (!fwd.ok) {
      this.emit('warning', `[FABRIC:PEER] private relay abort: ${fwd.error}`);
      return;
    }
    this._documentRelayRoutes[fwd.body.routeId] = {
      prevHopAddress: origin && origin.name,
      prevRouteId: parsed.routeId || null,
      feeSats: fwd.feeSats,
      maxSatsIn: Number(parsed.maxSats),
      maxSatsOut: fwd.maxSatsOut,
      documentId: fwd.body.document,
      blobIndex: fwd.body.blobIndex,
      created: Date.now()
    };
    this._capDocumentRelayRoutes();
    const msg = Message.fromVector(['DocumentRequest', JSON.stringify(fwd.body)]);
    msg.signWithKey(this.key);
    this.broadcast(msg.toBuffer());
    this.emit('documentRequestRelayed', {
      feeSats: fwd.feeSats,
      maxSatsOut: fwd.maxSatsOut,
      routeId: fwd.body.routeId,
      documentId: fwd.body.document,
      origin
    });
    if (originalMessage && this.settings.debug) {
      this.emit('debug', '[FABRIC:PEER] Rewrote DocumentRequest (did not bit-identical relay)');
    }
  }

  /**
   * Forward a relayed `P2P_FILE_SEND` / key reveal back toward the buyer using reverse routes.
   * @param {object} fileObj
   * @param {{ name: string }} origin
   * @returns {boolean} true if forwarded (caller should skip local ingest)
   */
  _maybeReverseRelayFileSend (fileObj, origin) {
    const routeId = fileObj && (fileObj.routeId || fileObj.relayRouteId);
    if (!routeId || !this._documentRelayRoutes[routeId]) return false;
    const route = this._documentRelayRoutes[routeId];
    const prev = route.prevHopAddress;
    if (!prev || !this.connections[prev] || !this.connections[prev]._writeFabric) return false;
    if (origin && origin.name && origin.name === prev) return false;

    const fwd = Object.assign({}, fileObj, {
      routeId: route.prevRouteId || routeId,
      relayedBy: this.id || null
    });
    const msg = Message.fromVector(['P2P_FILE_SEND', JSON.stringify(fwd)]);
    msg.signWithKey(this.key);
    this.connections[prev]._writeFabric(msg.toBuffer());
    this.emit('documentRelayReturn', {
      routeId,
      prevHopAddress: prev,
      documentId: fileObj.name || fileObj.documentId,
      origin
    });
    return true;
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

  _registerContract (object, publisherPubkeyHex = null) {
    this.emit('debug', `Registering contract: ${JSON.stringify(object, null, '  ')}`);
    const actor = new Actor(object);

    // Duplicate CONTRACT_PUBLISH must not expand the patch allow-list. Otherwise an
    // attacker can re-sign an observed publish body and merge their pubkey (or a
    // forged parties[] list) into `_contractPatchAllowList`, then apply ops.
    if (this.contracts[actor.id]) {
      if (this.settings.debug) {
        this.emit('debug',
          `[FABRIC:PEER] Ignoring CONTRACT_PUBLISH republish for ${actor.id} (allow-list unchanged)`);
      }
      return this;
    }

    this.contracts[actor.id] = actor;
    this._state.content.contracts[actor.id] = object.state;
    this._mergeContractPatchAllowList(actor.id, object, publisherPubkeyHex);

    this.commit();
    this.emit('contractset', this.contracts);

    return this;
  }

  /**
   * Build the set of pubkeys allowed to apply CONTRACT_MESSAGE ops for a newly
   * registered contract. Called only on first registration of a contract id —
   * republishes must not invoke this (see {@link Peer#_registerContract}).
   * @param {string} contractId
   * @param {object} object contract publish body
   * @param {string|null} publisherPubkeyHex wire signer of the first publish
   */
  _mergeContractPatchAllowList (contractId, object, publisherPubkeyHex) {
    const id = String(contractId || '');
    if (!id) return;
    let set = this._contractPatchAllowList[id];
    if (!set) {
      set = new Set();
      this._contractPatchAllowList[id] = set;
    }
    // Store x-only (or raw) form via normalizePeerPubkeyHex so it matches
    // signerPubkeyHex from wire verify / actor.publicKey (compressed → x-only).
    const add = (hex) => {
      const h = normalizePeerPubkeyHex(hex);
      if (/^[0-9a-f]{64}$/.test(h) || /^[0-9a-f]{66}$/.test(h)) set.add(h);
    };
    add(publisherPubkeyHex);
    const def = object && typeof object === 'object' ? object : {};
    const lists = [def.validators, def.parties, def.owners, def.members, def.authorities];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry === 'string') add(entry);
        else if (entry && typeof entry === 'object') {
          add(entry.pubkey || entry.publicKey || entry.id);
        }
      }
    }
  }

  /**
   * @param {string} contractId
   * @param {string|null} signerPubkeyHex
   * @returns {boolean}
   */
  _signerMayPatchContract (contractId, signerPubkeyHex) {
    const set = this._contractPatchAllowList[String(contractId || '')];
    if (!set || !set.size) return false; // fail closed: no parties recorded
    const h = normalizePeerPubkeyHex(signerPubkeyHex);
    if (!h) return false;
    if (set.has(h)) return true;
    // Tolerate allow-lists populated with compressed 66-char hex before normalize.
    if (h.length === 64) {
      for (const entry of set) {
        if (typeof entry === 'string' && entry.length === 66 && entry.slice(2) === h) return true;
      }
    }
    return false;
  }

  /**
   * Periodic P2P_PING and track expected P2P_PONG replies so registry score cannot be
   * self-inflated by unsolicited pongs (see FLUSH_CHAIN trust gate).
   * @param {*} socket — connection object (stores `_fabricPingOutstanding`, `_keepalive`)
   * @param {*} encryptWrite — NOISE encrypt stream with `.write(Buffer)` (`client.encrypt` / `handler.encrypt`)
   */
  _startFabricPingKeepalive (socket, encryptWrite) {
    if (socket._keepalive) clearInterval(socket._keepalive);
    socket._fabricPingOutstanding = 0;
    socket._keepalive = setInterval(() => {
      const now = (new Date()).toISOString();
      const P2P_PING = Message.fromVector(['P2P_PING', JSON.stringify({
        created: now
      })]).signWithKey(this.key);

      // At most one unanswered PING per connection so burst P2P_PONG cannot inflate registry score
      // (FLUSH_CHAIN trust gate uses _registryScoreForConnectionAddress).
      if ((socket._fabricPingOutstanding | 0) >= 1) return;
      socket._fabricPingOutstanding = 1;
      try {
        encryptWrite.write(P2P_PING.toBuffer());
      } catch (exception) {
        socket._fabricPingOutstanding = 0;
        if (exception && (exception.code === 'EPIPE' || exception.code === 'ECONNRESET')) {
          this.emit('warning', `Suppressing transient write error (${exception.code}) during ping.`);
        } else {
          this.emit('debug', `Cannot write ping: ${exception}`);
        }
      }
    }, 60000);
  }

  _registerNOISEClient (name, socket, client) {
    // Assign socket properties
    // Failure counter
    socket._failureCount = 0;
    socket._lastMessage = null;
    socket._messageLog = [];

    this._startFabricPingKeepalive(socket, client.encrypt);

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

    if (this.settings.listen) {
      this.emit('log', 'Listener starting...');

      const maxAttemptsRaw = this.settings.listenPortAttempts;
      const maxAttempts = (typeof maxAttemptsRaw === 'number' && maxAttemptsRaw > 0)
        ? Math.min(256, Math.floor(maxAttemptsRaw))
        : 20;
      const basePort = (typeof this.settings.port === 'number' && !Number.isNaN(this.settings.port))
        ? this.settings.port
        : 7777;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        this.settings.port = basePort + attempt;
        if (this.public && typeof this.public === 'object') this.public.port = this.settings.port;

        if (this.settings.debug) {
          this.emit('debug', `Starting listener on ${this.interface}:${this.settings.port} (attempt ${attempt + 1}/${maxAttempts})`);
        }

        try {
          address = await this.listen();
          if (this.settings.debug) this.emit('debug', `got address: ${JSON.stringify(address)}`);
          this.listenAddress = address;
          if (attempt > 0) {
            this.emit('log', `[FABRIC:PEER] Port ${basePort} was busy; listening on ${this.settings.port} instead.`);
          }
          this.emit('log', 'Listener started!');
          break;
        } catch (exception) {
          const inUse = exception && exception.code === 'EADDRINUSE';
          if (inUse && attempt < maxAttempts - 1) {
            this.emit('warning', `[FABRIC:PEER] Port ${this.settings.port} in use, trying ${this.settings.port + 1}...`);
            continue;
          }
          // Do not emit('error') here — with no listener Node throws ERR_UNHANDLED_ERROR; callers get the throw below.
          this.emit('warning', 'Could not listen:', exception);
          throw new Error('Peer failed to listen: ' + (exception && exception.message ? exception.message : exception));
        }
      }

      this._registerActor({ name: `${this.interface}:${this.port}` });
    } else {
      this._registerActor({ name: `${this.interface}:${this.port}` });
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
        if (this._isPeerBanned(addr)) return false;
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
      } catch { /* ignore */ }
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
          } catch {
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
    };

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
      if (this.settings.debug) this.emit('debug', `Listening on ${this.interface}:${this.port}`);
      let settled = false;

      const rejectListen = (error) => {
        if (settled) return;
        settled = true;
        this.server.removeListener('error', errorHandler);
        if (this.listenerCount('error') > 0) {
          this.emit('error', `Server socket error: ${error}`);
        }
        return reject(error);
      };

      // Handle server errors before attempting to listen
      const errorHandler = (error) => {
        if (error.code === 'EADDRINUSE') {
          // Ensure server resources are released before retrying upstream.
          // Recreate the TCP server after close — a closed Server can retain
          // sticky listen state and spuriously fail the next port attempt.
          this.server.close(() => {
            if (this.settings.listen) {
              this.server = net.createServer(this._NOISESocketHandler.bind(this));
              this._peerServerRuntimeErrorBound = false;
            }
            rejectListen(error);
          });
          return;
        }
        rejectListen(error);
      };

      this.server.once('error', errorHandler);

      this.server.listen(this.port, this.interface, (error) => {
        if (settled) return;
        // Remove the error handler since we're handling the result here
        this.server.removeListener('error', errorHandler);

        if (error) {
          return rejectListen(error);
        }
        settled = true;

        const details = this.server.address();
        const address = `${details.address}:${details.port}`;

        // Runtime errors after listen succeeds; attach once so port-retry does not stack handlers.
        if (!this._peerServerRuntimeErrorBound) {
          this._peerServerRuntimeErrorBound = true;
          this.server.on('error', (runtimeError) => {
            if (runtimeError.code !== 'EADDRINUSE' && this.listenerCount('error') > 0) {
              this.emit('error', `Server socket error: ${runtimeError}`);
            }
          });
        }

        this.emit('log', `Now listening on tcp://${address} [!!!]`);
        return resolve(address);
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
    if (this.settings.verbosity >= 5) this.emit('debug', `broadcasting: ${JSON.stringify(msg)}`);
    this.agent.broadcast(msg);
  }

  connect (address) {
    if (this.settings.verbosity >= 4) this.emit('debug', `[FABRIC:SWARM] Connecting to: ${address}`);

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
      this.emit('debug', `[FABRIC:SWARM] Received state from agent: ${JSON.stringify(state)}`);
      swarm.emit('state', state);
    });

    swarm.agent.on('change', function (change) {
      this.emit('debug', `[FABRIC:SWARM] Received change from agent: ${JSON.stringify(change)}`);
      swarm.emit('change', change);
    });

    swarm.agent.on('patches', function (patches) {
      this.emit('debug', `[FABRIC:SWARM] Received patches from agent: ${JSON.stringify(patches)}`);
      swarm.emit('patches', patches);
    });

    swarm.agent.on('peer', function (peer) {
      this.emit('debug', `[FABRIC:SWARM] Received peer from agent: ${JSON.stringify(peer)}`);
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
      if (swarm.settings.verbosity >= 5) swarm.emit('debug', `[FABRIC:SWARM] _fillPeerSlots() checking: ${JSON.stringify(swarm.peers[id])}`);
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
    if (this.settings.verbosity >= 4) this.emit('debug', `[FABRIC:SWARM] Connecting to seed nodes: ${JSON.stringify(this.settings.seeds)}`);
    for (const id in this.settings.seeds) {
      if (this.settings.verbosity >= 5) this.emit('debug', `[FABRIC:SWARM] Iterating on seed: ${this.settings.seeds[id]}`);
      this.connect(this.settings.seeds[id]);
    }
  }

  async start () {
    if (this.settings.verbosity >= 4) this.emit('debug', '[FABRIC:SWARM] Starting...');
    await this.agent.start();
    await this._connectSeedNodes();
    if (this.settings.verbosity >= 4) this.emit('debug', '[FABRIC:SWARM] Started!');
    return this;
  }

  async stop () {
    if (this.settings.verbosity >= 4) this.emit('debug', '[FABRIC:SWARM] Stopping...');
    await this.agent.stop();
    if (this.settings.verbosity >= 4) this.emit('debug', '[FABRIC:SWARM] Stopped!');
    return this;
  }
}

module.exports = Peer;
module.exports.Swarm = Swarm;
