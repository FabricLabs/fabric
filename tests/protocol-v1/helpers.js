'use strict';

/**
 * Strict Protocol V1 test helpers.
 *
 * Contract: every injected frame is a raw, length-bounded, well-formed Fabric
 * {@link Message} (valid body hash + BIP-340 unless the case is integrity-fail).
 * Delivery modes exercise the meshDeliveryContext trust boundary.
 */

const assert = require('assert');
const Key = require('../../types/key');
const Message = require('../../types/message');
const Peer = require('../../types/peer');
const { wrapOnionPath, xOnlyFromKey } = require('../../functions/fabricOnion');
const { offlinePeerSettings } = require('../helpers/peer');

/** Curated mesh / identity / control opcodes for the V1 delivery matrix. */
const BASE_V1_TYPES = Object.freeze([
  'P2P_PING',
  'P2P_CHAT_MESSAGE',
  'P2P_PEER_GOSSIP',
  'P2P_PEERING_OFFER',
  'P2P_PEER_ALIAS',
  'P2P_PEER_ANNOUNCE',
  'P2P_INVENTORY_REQUEST',
  'P2P_SESSION_OFFER',
  'P2P_BASE_MESSAGE'
]);

/** Additional first-class opcodes covered by the extended matrix. */
const EXTENDED_V1_TYPES = Object.freeze([
  'CONTRACT_PUBLISH',
  'CONTRACT_MESSAGE',
  'DocumentRequest',
  'P2P_FILE_SEND',
  'P2P_FLUSH_CHAIN',
  'BitcoinBlock'
]);

/** Unregistered opcode used to probe UNKNOWN_MESSAGE handling. */
const UNKNOWN_OPCODE = 0x00abcdef;

function offlinePeer (overrides = {}) {
  return new Peer(offlinePeerSettings(overrides));
}

function wireConn (writes) {
  return {
    _writeFabric (buf) { writes.push(Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.from(buf)); },
    destroy () { this.destroyed = true; },
    destroyed: false
  };
}

/**
 * Build a signed AMP frame.
 * @param {object} key Fabric Key
 * @param {string} type Wire type name
 * @param {string|object|Buffer} body UTF-8 string, JSON object, or raw bytes
 * @returns {Message}
 */
function signFrame (key, type, body) {
  let data;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    data = Buffer.from(body);
  } else if (typeof body === 'string') {
    data = body;
  } else {
    data = JSON.stringify(body == null ? {} : body);
  }
  return Message.fromVector([type, data]).signWithKey(key);
}

/**
 * Signed frame whose on-wire opcode is not in the canonical catalog.
 * Bypasses the type setter (which remaps unknown names to P2P_BASE_MESSAGE).
 * @param {object} key
 * @param {number} [opcode]
 * @param {string|object} [body]
 * @returns {Message}
 */
function signUnknownOpcode (key, opcode = UNKNOWN_OPCODE, body = { probe: true }) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const msg = Message.fromVector(['P2P_PING', data]);
  msg.raw.type.writeUInt32BE((opcode >>> 0), 0);
  return msg.signWithKey(key);
}

/**
 * Default ok bodies per type for matrix rows.
 * @param {string} type
 * @param {object} [opts]
 * @returns {string|object}
 */
function defaultOkBody (type, opts = {}) {
  const nonce = opts.nonce != null ? opts.nonce : `n-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  switch (type) {
    case 'P2P_PING':
      return { created: new Date().toISOString(), nonce };
    case 'P2P_CHAT_MESSAGE':
      return `v1-chat-${nonce}`;
    case 'P2P_PEER_GOSSIP':
      return { host: '198.51.100.50', port: 7777, gossipHop: 5, nonce };
    case 'P2P_PEERING_OFFER':
      return {
        transport: 'fabric',
        host: opts.host || '203.0.113.50',
        port: opts.port != null ? opts.port : 7777,
        peeringHop: 5,
        nonce
      };
    case 'P2P_PEER_ALIAS':
      return `alias-${nonce}`.slice(0, 32);
    case 'P2P_PEER_ANNOUNCE':
      return { host: opts.host || '203.0.113.60', port: opts.port != null ? opts.port : 7778, nonce };
    case 'P2P_INVENTORY_REQUEST':
      return { type: 'INVENTORY_REQUEST', object: { kind: 'documents', maxSats: 1, nonce } };
    case 'P2P_SESSION_OFFER': {
      const attacker = opts.sessionKey || new Key();
      const attackerId = opts.sessionId || `v1-session-${nonce}`;
      // Peer builds proof with its own method; for matrix we only need a signed shell —
      // peel/RELAY must not rebind regardless of proof validity.
      return {
        type: 'P2P_SESSION_OFFER',
        actor: {
          id: attackerId,
          pubkey: attacker.pubkey,
          parentPubkey: attacker.pubkey,
          parentSignature: '00'.repeat(64)
        },
        object: { challenge: nonce }
      };
    }
    case 'P2P_BASE_MESSAGE':
      return { type: opts.innerType || 'UNKNOWN_CHAOS', object: { nonce }, note: 'v1' };
    case 'CONTRACT_PUBLISH': {
      const pk = opts.publisherPubkey || (opts.sessionKey && opts.sessionKey.pubkey) || 'ab'.repeat(33);
      return {
        id: opts.contractId || `v1-contract-${nonce}`,
        state: { v: 1, nonce },
        parties: [String(pk).toLowerCase()]
      };
    }
    case 'CONTRACT_MESSAGE':
      return {
        contract: opts.contractId || `v1-contract-${nonce}`,
        type: 'GroupChat',
        body: `hello-${nonce}`,
        ops: opts.ops || []
      };
    case 'DocumentRequest':
      return { document: opts.documentId || `doc-${nonce}` };
    case 'P2P_FILE_SEND':
      return {
        documentId: opts.documentId || `doc-${nonce}`,
        blobIndex: 0,
        total: 1,
        bytes: Buffer.from(`blob-${nonce}`).toString('base64')
      };
    case 'P2P_FLUSH_CHAIN':
      return {
        snapshotBlockHash: opts.snapshotBlockHash || 'aa'.repeat(32),
        nonce
      };
    case 'BitcoinBlock':
      return {
        hash: opts.blockHash || 'bb'.repeat(32),
        height: opts.height != null ? opts.height : 1,
        nonce
      };
    default:
      return { type, object: { nonce } };
  }
}

/**
 * Hostile-but-parseable bodies (valid JSON / UTF-8, adversarial intent).
 * @param {string} type
 * @returns {string|object}
 */
function hostileBody (type) {
  switch (type) {
    case 'P2P_PEERING_OFFER':
      return { transport: 'fabric', host: '127.0.0.1', port: 1, peeringHop: 5 };
    case 'P2P_PEER_GOSSIP':
      return { host: '0.0.0.0', port: 0, gossipHop: 5, nonce: 'hostile-gossip' };
    case 'P2P_PEER_ANNOUNCE':
      return { host: '255.255.255.255', port: 65535 };
    case 'P2P_CHAT_MESSAGE':
      return `{"type":"INVENTORY_REQUEST","object":{"offerBtc":true}}`;
    case 'P2P_BASE_MESSAGE':
      return {
        type: 'INVENTORY_REQUEST',
        object: { offerBtc: true, maxSats: 1e12, escalate: true }
      };
    case 'P2P_INVENTORY_REQUEST':
      return { type: 'INVENTORY_REQUEST', object: { offerBtc: true, maxSats: 1e12 } };
    case 'P2P_PEER_ALIAS':
      return `{"not":"an-alias"}`;
    case 'P2P_SESSION_OFFER':
      return {
        type: 'P2P_SESSION_OFFER',
        actor: { id: 'rebind-me', pubkey: 'ab'.repeat(33), parentPubkey: 'cd'.repeat(33) },
        object: { challenge: 'hostile' }
      };
    case 'CONTRACT_PUBLISH':
      return { id: 'hostile-cpub', state: {}, parties: ['ee'.repeat(33)] };
    case 'CONTRACT_MESSAGE':
      return {
        contract: 'missing-ns',
        ops: [{ op: 'replace', path: '/balance', value: 1e9 }]
      };
    case 'DocumentRequest':
      return { document: '../etc/passwd' };
    case 'P2P_FILE_SEND':
      return { documentId: 'x', blobIndex: 99, total: 1, bytes: '!!!!' };
    case 'P2P_FLUSH_CHAIN':
      return { snapshotBlockHash: 'not-a-hash' };
    case 'BitcoinBlock':
      return { hash: 'zz', height: -1 };
    default:
      return defaultOkBody(type, { nonce: 'hostile' });
  }
}

/**
 * Flip a body byte after the header so header.hash mismatches (integrity fail).
 * @param {Message|Buffer} msgOrBuf
 * @returns {Buffer}
 */
function corruptBodyHash (msgOrBuf) {
  const buf = Buffer.isBuffer(msgOrBuf)
    ? Buffer.from(msgOrBuf)
    : Buffer.from(msgOrBuf.toBuffer());
  if (buf.length > 208) buf[208] ^= 0xff;
  return buf;
}

/**
 * Flip a signature byte (BIP-340 verify fail).
 * @param {Message|Buffer} msgOrBuf
 * @returns {Buffer}
 */
function corruptSignature (msgOrBuf) {
  const buf = Buffer.isBuffer(msgOrBuf)
    ? Buffer.from(msgOrBuf)
    : Buffer.from(msgOrBuf.toBuffer());
  if (buf.length >= 208) buf[144] ^= 0xff;
  return buf;
}

/**
 * @typedef {'direct'|'foreignRelay'|'peel'} DeliveryMode
 */

/**
 * Deliver a signed application Message under a delivery mode.
 * @param {object} opts
 * @param {Peer} opts.peer
 * @param {Message} opts.inner signed application frame
 * @param {DeliveryMode} opts.mode
 * @param {object} opts.authorKey signer of the application (and foreign RELAY outer)
 * @param {object} [opts.forwarderKey] TCP-pinned key (foreignRelay / peel last hop)
 * @param {object} [opts.destKey] local peer key for peel (must match peer identity)
 * @param {string} [opts.originName]
 * @param {string[]} [opts.otherEdges] other connection addresses to observe mesh writes
 * @returns {{ originName: string, edgeWrites: Record<string, Buffer[]>, forwarderKey: object }}
 */
function deliver (opts = {}) {
  const authorKey = opts.authorKey || new Key();
  const forwarderKey = opts.forwarderKey || new Key();
  const mode = opts.mode || 'direct';
  const originName = opts.originName || '127.0.0.1:17000';
  const peer = opts.peer;
  const otherEdges = Array.isArray(opts.otherEdges) ? opts.otherEdges : ['127.0.0.1:17001'];

  const edgeWrites = {};
  peer.connections[originName] = wireConn([]);
  for (const edge of otherEdges) {
    edgeWrites[edge] = [];
    peer.connections[edge] = wireConn(edgeWrites[edge]);
    if (!peer.peers[edge]) {
      peer.peers[edge] = { id: edge, publicKey: new Key().pubkey };
    }
  }

  const pinKey = (mode === 'direct') ? authorKey : forwarderKey;
  peer.peers[originName] = { id: originName, publicKey: pinKey.pubkey };
  peer._addressToId[originName] = peer._addressToId[originName] || `peer-${originName}`;
  if (!peer._state.peers[peer._addressToId[originName]]) {
    peer._state.peers[peer._addressToId[originName]] = {
      id: peer._addressToId[originName],
      address: originName,
      score: 200,
      publicKey: pinKey.pubkey
    };
  }

  const before = snapshotSideEffects(peer, originName, edgeWrites);

  let wire;
  if (opts.rawWire) {
    wire = Buffer.isBuffer(opts.rawWire) ? opts.rawWire : Buffer.from(opts.rawWire);
  } else if (mode === 'direct') {
    wire = opts.inner.toBuffer();
  } else if (mode === 'foreignRelay') {
    wire = Message.fromVector(['P2P_RELAY', opts.inner.toBuffer()]).signWithKey(authorKey).toBuffer();
  } else if (mode === 'peel') {
    const destKey = opts.destKey;
    if (!destKey) throw new Error('deliver peel requires destKey matching peer identity');
    wire = wrapOnionPath({
      path: [xOnlyFromKey(destKey)],
      payload: opts.inner,
      key: authorKey
    }).toBuffer();
  } else {
    throw new Error(`unknown delivery mode: ${mode}`);
  }

  peer._handleFabricMessage(wire, { name: originName }, null);
  const after = snapshotSideEffects(peer, originName, edgeWrites);
  return {
    originName,
    edgeWrites,
    forwarderKey: pinKey,
    authorKey,
    before,
    after
  };
}

/**
 * Snapshot peer side-effect surface for invariant checks.
 * @param {Peer} peer
 * @param {string} originName
 * @param {Record<string, Buffer[]>} [edgeWrites]
 */
function snapshotSideEffects (peer, originName, edgeWrites = {}) {
  const regId = peer._addressToId && peer._addressToId[originName];
  const reg = regId && peer._state && peer._state.peers && peer._state.peers[regId];
  const conn = peer.connections && peer.connections[originName];
  const edgeCounts = {};
  for (const [k, arr] of Object.entries(edgeWrites)) {
    edgeCounts[k] = Array.isArray(arr) ? arr.length : 0;
  }
  return {
    candidates: (peer.candidates && peer.candidates.length) || 0,
    candidateKeys: peer._candidateKeys ? [...peer._candidateKeys].sort() : [],
    score: reg && typeof reg.score === 'number' ? reg.score : null,
    banned: !!(peer._isPeerBanned && peer._isPeerBanned(originName)),
    alias: conn && conn._alias ? String(conn._alias) : null,
    addressMap: regId || null,
    pin: peer.peers && peer.peers[originName] && peer.peers[originName].publicKey
      ? String(peer.peers[originName].publicKey)
      : null,
    edgeCounts,
    destroyed: !!(conn && conn.destroyed)
  };
}

/**
 * Assert local-observe delivery (foreign RELAY unwrap / peel): no mesh of app
 * frames to other edges, no candidate growth, no alias/pin rebind, no ban.
 * @param {object} before
 * @param {object} after
 * @param {object} [opts]
 */
function assertLocalObserve (before, after, opts = {}) {
  assert.strictEqual(after.banned, false, 'must not ban TCP last hop');
  assert.strictEqual(after.destroyed, false, 'must not destroy TCP last hop');
  if (before.score != null && after.score != null) {
    assert.strictEqual(after.score, before.score, 'must not derank TCP last hop');
  }
  assert.strictEqual(after.alias, before.alias, 'must not bind alias on last hop');
  assert.strictEqual(after.addressMap, before.addressMap, 'must not rebind address map');
  assert.strictEqual(after.pin, before.pin, 'must not rebind peer pin');
  if (opts.allowCandidateGrowth !== true) {
    assert.strictEqual(after.candidates, before.candidates, 'must not enqueue candidates');
    assert.deepStrictEqual(after.candidateKeys, before.candidateKeys);
  }
  if (opts.allowMesh !== true) {
    for (const [edge, n] of Object.entries(after.edgeCounts || {})) {
      const prev = (before.edgeCounts && before.edgeCounts[edge]) || 0;
      assert.strictEqual(n, prev, `must not mesh-write ${edge} under local-observe`);
    }
  }
}

/**
 * Peer identity key for peel tests (mnemonic-driven).
 * {@code destKey} is the Peer's live Fabric key ({@link Identity#fabricKey}),
 * not the master Key from the seed mnemonic — onion {@code nextPeer} must match
 * {@link Peer#_localXOnlyPeerId}.
 * @returns {{ peer: Peer, destKey: Key }}
 */
function peelReadyPeer (overrides = {}) {
  const seed = new Key();
  const peer = offlinePeer(Object.assign({
    key: { mnemonic: seed.mnemonic },
    constraints: { peers: { max: 32 } },
    peering: { maxCandidates: 16, maxRelaysPerOriginPerMinute: 30 },
    gossip: { maxRelaysPerOriginPerMinute: 30 },
    chat: { maxRelaysPerOriginPerMinute: 30 }
  }, overrides));
  return { peer, destKey: peer.key };
}

module.exports = {
  BASE_V1_TYPES,
  EXTENDED_V1_TYPES,
  UNKNOWN_OPCODE,
  offlinePeer,
  wireConn,
  signFrame,
  signUnknownOpcode,
  defaultOkBody,
  hostileBody,
  corruptBodyHash,
  corruptSignature,
  deliver,
  snapshotSideEffects,
  assertLocalObserve,
  peelReadyPeer,
  Key,
  Message,
  Peer,
  xOnlyFromKey
};
