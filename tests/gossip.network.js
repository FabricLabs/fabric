'use strict';

/**
 * Public gossip-network catalog + validate-and-relay Peer.
 *
 * Locks {@link module:functions/gossipNetwork} against Message decode order
 * and Peer mesh-flood behaviour so a single-Peer relay does not drift.
 */

const assert = require('assert');
const { describe, it } = require('mocha');

const Message = require('../types/message');
const Key = require('../types/key');
const Peer = require('../types/peer');
const HEADER_SIZE = require('../constants').HEADER_SIZE;
const {
  BITCOIN_BLOCK_TYPE,
  P2P_CONTRACT_PUBLISH,
  P2P_CONTRACT_MESSAGE,
  CONTRACT_PROPOSAL_TYPE
} = require('../constants');
const {
  GOSSIP_NETWORK_TYPES,
  classifyGossipWireType,
  isPublicGossipFloodType,
  isRelayAsIsWireType,
  isFirstClassOpcodeOnlyType,
  listPublicGossipFloodNames,
  validateGossipFrame,
  gossipRelayPeerSettings,
  lookupGossipType
} = require('../functions/gossipNetwork');
const { buildContractProposalPayload } = require('../functions/contractProposal');
const { offlinePeerSettings, waitUntil, getFreePort } = require('./helpers/peer');

describe('@fabric/core gossip network catalog', function () {
  it('covers every Message decode name exactly once', function () {
    const catalogNames = GOSSIP_NETWORK_TYPES.map((row) => row.name);
    const decodeNames = Message.WIRE_TYPE_DECODE_ORDER.map((pair) => pair[1]);
    assert.deepStrictEqual(catalogNames.slice().sort(), decodeNames.slice().sort());
    assert.strictEqual(new Set(catalogNames).size, catalogNames.length);
  });

  it('opcodes match Message decode order', function () {
    for (const pair of Message.WIRE_TYPE_DECODE_ORDER) {
      const opcode = pair[0];
      const name = pair[1];
      const row = lookupGossipType(name);
      assert.ok(row, `missing catalog row for ${name}`);
      assert.strictEqual(row.opcode, opcode, name);
      assert.strictEqual(lookupGossipType(opcode).name, name);
    }
  });

  it('classifies aliases used on the wire', function () {
    assert.strictEqual(classifyGossipWireType('BitcoinBlock'), 'flood');
    assert.strictEqual(classifyGossipWireType('PeerGossip'), 'flood');
    assert.strictEqual(classifyGossipWireType('DocumentRequest'), 'flood');
    assert.strictEqual(classifyGossipWireType('ContractProposal'), 'flood');
    assert.strictEqual(classifyGossipWireType('INVENTORY_REQUEST'), 'opt-in');
    assert.strictEqual(classifyGossipWireType('FlushChain'), 'trusted');
    assert.strictEqual(classifyGossipWireType('MusigStart'), 'directed');
    assert.strictEqual(classifyGossipWireType('not-a-type'), 'unknown');
  });

  it('lists public flood types Peer is intended to mesh-relay', function () {
    const names = listPublicGossipFloodNames();
    assert.deepStrictEqual(names.slice().sort(), [
      'BITCOIN_BLOCK',
      'CONTRACT_MESSAGE',
      'CONTRACT_PROPOSAL',
      'CONTRACT_PUBLISH',
      'DOCUMENT_REQUEST',
      'P2P_CHAT_MESSAGE',
      'P2P_PEER_ALIAS',
      'P2P_PEER_GOSSIP',
      'P2P_PEERING_OFFER',
      'P2P_RELAY'
    ].sort());
    for (const name of names) assert.strictEqual(isPublicGossipFloodType(name), true);
    assert.strictEqual(isPublicGossipFloodType('P2P_PING'), false);
    assert.strictEqual(isPublicGossipFloodType('P2P_FORWARD'), false);
    assert.strictEqual(isPublicGossipFloodType('P2P_FLUSH_CHAIN'), false);
    assert.strictEqual(isPublicGossipFloodType('P2P_INVENTORY_REQUEST'), false);
    assert.strictEqual(isPublicGossipFloodType('DOCUMENT_PUBLISH'), false);
    assert.strictEqual(isPublicGossipFloodType('P2P_SESSION_OFFER'), false);
  });

  it('relay-as-is pin exemption covers flood + envelope + directed onion', function () {
    assert.strictEqual(isRelayAsIsWireType('P2P_PEER_GOSSIP'), true);
    assert.strictEqual(isRelayAsIsWireType('P2P_RELAY'), true);
    assert.strictEqual(isRelayAsIsWireType('P2P_FORWARD'), true);
    assert.strictEqual(isRelayAsIsWireType('P2P_CHAT_MESSAGE'), true);
    assert.strictEqual(isRelayAsIsWireType(BITCOIN_BLOCK_TYPE), true);
    assert.strictEqual(isRelayAsIsWireType(P2P_CONTRACT_PUBLISH), true);
    assert.strictEqual(isRelayAsIsWireType(P2P_CONTRACT_MESSAGE), true);
    assert.strictEqual(isRelayAsIsWireType(CONTRACT_PROPOSAL_TYPE), true);
    assert.strictEqual(isRelayAsIsWireType('P2P_PING'), false);
    assert.strictEqual(isFirstClassOpcodeOnlyType('CONTRACT_MESSAGE'), true);
    assert.strictEqual(isFirstClassOpcodeOnlyType('P2P_BASE_MESSAGE'), false);
  });

  it('validateGossipFrame accepts signed chat and rejects hash/sig failures', function () {
    const key = new Key();
    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello gossip']).signWithKey(key);
    const ok = validateGossipFrame(msg.toBuffer());
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.type, 'P2P_CHAT_MESSAGE');
    assert.strictEqual(ok.flood, true);
    assert.ok(ok.signerPubkeyHex);

    const badSig = Message.fromBuffer(msg.toBuffer());
    badSig.raw.signature[0] ^= 0xff;
    const sigFail = validateGossipFrame(badSig.toBuffer());
    assert.strictEqual(sigFail.ok, false);
    assert.strictEqual(sigFail.error, 'invalid-signature');

    const broken = Buffer.from(msg.toBuffer());
    // Flip a body byte after the header so double-SHA256 no longer matches.
    if (broken.length > HEADER_SIZE) broken[HEADER_SIZE] ^= 0xff;
    const hashFail = validateGossipFrame(broken);
    assert.strictEqual(hashFail.ok, false);
    assert.ok(hashFail.error === 'body-hash-mismatch' || hashFail.error === 'unparseable');

    assert.strictEqual(validateGossipFrame(Buffer.alloc(8)).ok, false);
    assert.strictEqual(validateGossipFrame(Buffer.alloc(8)).error, 'undersize');
  });

  it('gossipRelayPeerSettings is a single-Peer validate/relay profile', function () {
    const settings = gossipRelayPeerSettings({ port: 17777, peers: ['127.0.0.1:9'] });
    assert.strictEqual(settings.listen, true);
    assert.strictEqual(settings.networking, true);
    assert.strictEqual(settings.registerInboundContracts, false);
    assert.strictEqual(settings.autoFulfillDocumentRequests, false);
    assert.strictEqual(settings.serveLocalDocumentInventory, false);
    assert.strictEqual(settings.relayInventoryRequest, false);
    assert.strictEqual(settings.port, 17777);
    assert.deepStrictEqual(settings.peers, ['127.0.0.1:9']);
    assert.ok(settings.constraints.peers.max > 0);
  });

  it('gossipRelayPeerSettings keeps extra constraint groups', function () {
    const extra = { constraints: { peers: { max: 3 }, documents: { max: 2 } } };
    const settings = gossipRelayPeerSettings(extra);
    assert.strictEqual(settings.constraints.peers.max, 3);
    assert.strictEqual(settings.constraints.peers.shuffle, 8);
    assert.strictEqual(settings.constraints.documents.max, 2);
    extra.constraints.documents.max = 99;
    extra.constraints.peers.max = 1;
    assert.strictEqual(settings.constraints.documents.max, 2);
    assert.strictEqual(settings.constraints.peers.max, 3);
  });
});

describe('@fabric/core gossip-relay Peer (mocked mesh)', function () {
  function meshRelayPeer (edgeCount, overrides = {}) {
    const peer = new Peer(gossipRelayPeerSettings(Object.assign(
      offlinePeerSettings(),
      { listen: false, networking: false },
      overrides
    )));
    const edges = {};
    for (let i = 0; i < edgeCount; i++) {
      const addr = `127.0.0.1:${9100 + i}`;
      const writes = [];
      peer.connections[addr] = {
        _writeFabric (buf) { writes.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)); },
        destroy () { this.destroyed = true; },
        destroyed: false
      };
      peer.peers[addr] = { id: `e${i}`, publicKey: new Key().pubkey };
      edges[addr] = writes;
    }
    return { peer, edges };
  }

  function assertFlooded (edges, origin, wire) {
    for (const [addr, writes] of Object.entries(edges)) {
      if (addr === origin) {
        assert.strictEqual(writes.length, 0, 'origin must not receive echo');
      } else {
        assert.strictEqual(writes.length, 1, `${addr} must receive flood`);
        assert.ok(wire.equals(writes[0]), 'forward must be bit-identical');
      }
    }
  }

  it('floods each public gossip type bit-identical except origin', function () {
    const author = new Key();
    const origin = '127.0.0.1:9100';
    const cases = [];

    cases.push(Message.fromVector(['P2P_CHAT_MESSAGE', 'shoutbox']).signWithKey(author));
    cases.push(Message.fromVector(['P2P_PEER_ALIAS', 'Neo']).signWithKey(author));
    cases.push(Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify({
      host: '198.51.100.9',
      port: 7777,
      gossipHop: 5,
      nonce: 'g-relay'
    })]).signWithKey(author));
    cases.push(Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify({
      host: '198.51.100.10',
      port: 7777,
      peeringHop: 5,
      transport: 'fabric'
    })]).signWithKey(author));

    const ownerPub = String(author.pubkey).toLowerCase();
    cases.push(Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify({
      name: 'GossipRelayContract',
      version: 1,
      parties: [ownerPub],
      state: {}
    })]).signWithKey(author));
    cases.push(Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: 'ns-relay-1',
      type: 'GroupChat',
      ops: []
    })]).signWithKey(author));

    const leaf = Message.fromVector(['P2P_CHAT_MESSAGE', 'proposal-leaf']).signWithKey(author);
    const proposal = buildContractProposalPayload({
      contractId: 'gossip-proposal',
      messages: [leaf],
      statePatch: []
    });
    cases.push(Message.fromVector(['CONTRACT_PROPOSAL', JSON.stringify(proposal)]).signWithKey(author));

    cases.push(Message.fromVector(['BITCOIN_BLOCK', JSON.stringify({
      hash: 'ab'.repeat(32),
      height: 100
    })]).signWithKey(author));
    cases.push(Message.fromVector(['DOCUMENT_REQUEST', JSON.stringify({
      document: 'missing-doc',
      id: 'missing-doc'
    })]).signWithKey(author));

    const inner = Message.fromVector(['P2P_CHAT_MESSAGE', 'inside-relay']).signWithKey(author);
    cases.push(Message.fromVector(['P2P_RELAY', inner.toBuffer()]).signWithKey(author));

    for (const signed of cases) {
      const { peer, edges } = meshRelayPeer(3);
      peer.peers[origin] = { publicKey: author.pubkey };
      const wire = signed.toBuffer();
      peer._handleFabricMessage(wire, { name: origin }, null);
      assertFlooded(edges, origin, wire);
      assert.strictEqual(validateGossipFrame(wire).ok, true);
      assert.strictEqual(isPublicGossipFloodType(signed.type), true);
    }
  });

  it('does not mesh-flood session or directed types', function () {
    const author = new Key();
    const origin = '127.0.0.1:9100';
    const directed = [
      Message.fromVector(['P2P_PING', JSON.stringify({ created: new Date().toISOString() })]).signWithKey(author),
      Message.fromVector(['P2P_SESSION_OFFER', JSON.stringify({
        type: 'P2P_SESSION_OFFER',
        actor: { id: 'x' },
        object: { challenge: 'c' }
      })]).signWithKey(author),
      Message.fromVector(['P2P_FILE_SEND', JSON.stringify({
        documentId: 'blob',
        chunk: 0,
        data: ''
      })]).signWithKey(author)
    ];
    for (const signed of directed) {
      const { peer, edges } = meshRelayPeer(3);
      peer.peers[origin] = { publicKey: author.pubkey };
      peer._handleFabricMessage(signed.toBuffer(), { name: origin }, null);
      for (const [addr, writes] of Object.entries(edges)) {
        // PING writes a PONG to the origin socket only — never a mesh flood.
        if (addr === origin && signed.type === 'P2P_PING') {
          assert.strictEqual(writes.length, 1, 'origin should receive one PONG');
          assert.strictEqual(Message.fromBuffer(writes[0]).type, 'P2P_PONG');
          continue;
        }
        assert.strictEqual(writes.length, 0, `${signed.type} must not reach ${addr}`);
      }
    }
  });

  it('drops invalid signatures instead of relaying', function () {
    const { peer, edges } = meshRelayPeer(2);
    const author = new Key();
    const origin = '127.0.0.1:9100';
    peer.peers[origin] = { publicKey: author.pubkey };
    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', 'forged']).signWithKey(author);
    msg.raw.signature[0] ^= 0xff;
    peer._handleFabricMessage(msg.toBuffer(), { name: origin }, null);
    assert.strictEqual(edges['127.0.0.1:9101'].length, 0);
  });

  it('does not accumulate CONTRACT_PUBLISH state on a gossip-relay Peer', function () {
    const { peer, edges } = meshRelayPeer(2);
    const author = new Key();
    const origin = '127.0.0.1:9100';
    peer.peers[origin] = { publicKey: author.pubkey };
    const ownerPub = String(author.pubkey).toLowerCase();
    const definition = {
      name: 'NoAccumulate',
      version: 1,
      parties: [ownerPub],
      state: { v: 1 }
    };
    const wire = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)])
      .signWithKey(author)
      .toBuffer();
    let publishes = 0;
    peer.on('contract:publish', () => { publishes++; });
    peer._handleFabricMessage(wire, { name: origin }, null);
    assert.strictEqual(publishes, 1);
    assert.strictEqual(Object.keys(peer.contracts || {}).length, 0);
    assert.strictEqual(edges['127.0.0.1:9101'].length, 1);
  });
});

describe('@fabric/core gossip-relay live Peer', function () {
  this.timeout(30000);

  it('relays shoutbox chat origin → relay Peer → destination', async function () {
    const relayPort = await getFreePort();
    const originPort = await getFreePort();

    const relay = new Peer(gossipRelayPeerSettings({
      listen: true,
      networking: true,
      port: relayPort,
      interface: '127.0.0.1',
      peers: [],
      peersDb: null,
      upnp: false,
      reconnectToKnownPeers: false
    }));
    const origin = new Peer(offlinePeerSettings({
      listen: true,
      networking: true,
      port: originPort,
      interface: '127.0.0.1',
      peers: [`127.0.0.1:${relayPort}`],
      constraints: { peers: { max: 8, shuffle: 8 } }
    }));
    const dest = new Peer(offlinePeerSettings({
      listen: false,
      networking: true,
      peers: [`127.0.0.1:${relayPort}`],
      constraints: { peers: { max: 8, shuffle: 8 } }
    }));

    const chats = [];
    dest.on('chat', (payload) => chats.push(payload));
    relay.on('error', () => {});
    origin.on('error', () => {});
    dest.on('error', () => {});

    try {
      await relay.start();
      await origin.start();
      await dest.start();

      await waitUntil(() => Object.keys(origin.connections || {}).length >= 1, 15000);
      await waitUntil(() => Object.keys(dest.connections || {}).length >= 1, 15000);
      await waitUntil(() => Object.keys(relay.connections || {}).length >= 2, 15000);

      const text = 'gossip-relay-live-' + Date.now();
      const msg = Message.fromVector(['P2P_CHAT_MESSAGE', text]).signWithKey(origin.key);
      const sent = origin.broadcast(msg.toBuffer());
      assert.ok(sent > 0, 'origin must write chat to the relay');

      await waitUntil(() => chats.some((c) => c && c.text === text), 15000);
      assert.ok(chats.some((c) => c && c.text === text));
    } finally {
      await dest.stop();
      await origin.stop();
      await relay.stop();
    }
  });
});
