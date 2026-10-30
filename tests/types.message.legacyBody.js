'use strict';

const assert = require('assert');
const Actor = require('../types/actor');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { GOSSIP_MAX_HOPS, PEERING_OFFER_MAX_HOPS } = require('../constants');
const sidechainState = require('../functions/sidechainState');
const { createMemoryStore, parseContractMessageBody } = require('../functions/contractMessageAccumulate');
const { enqueueMessageBuffer } = require('../functions/contractMessageQueue');
const { createCollection, ingest } = require('../functions/fabricMessageCollection');
const { purchaseContentHashHex } = require('../functions/publishedDocumentEnvelope');
const { offlinePeerSettings } = require('./helpers/peer');

const OWNER = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
const OWNER_PUB = String(OWNER.pubkey).toLowerCase();

/** Encode, frame, and parse back the way a receiving Peer would. */
function roundTrip (type, body) {
  const wire = Message.fromBuffer(Message.fromLegacyBody(type, body).signWithKey(OWNER).toBuffer());
  const parsed = Message.tryParseLegacyBody(wire);
  assert.strictEqual(parsed.ok, true, parsed.error);
  assert.strictEqual(parsed.encoding, 'fields');
  return parsed.value;
}

function jsonFrame (type, body) {
  return Message.fromVector([type, JSON.stringify(body)]).signWithKey(OWNER);
}

function fieldFrame (type, body) {
  return Message.fromLegacyBody(type, body).signWithKey(OWNER);
}

function definition () {
  return {
    name: 'FieldBodyApp',
    version: 1,
    parties: [OWNER_PUB],
    state: { label: 'fields' }
  };
}

describe('Message legacy bodies', function () {
  describe('round trips (legacy JSON → fields → legacy JSON)', function () {
    it('P2P_PING and P2P_PONG carry the nonce', function () {
      assert.deepStrictEqual(roundTrip('P2P_PING', { nonce: 'abc-1' }), { nonce: 'abc-1' });
      assert.deepStrictEqual(roundTrip('P2P_PONG', { nonce: 'abc-1' }), { nonce: 'abc-1' });
      assert.deepStrictEqual(roundTrip('Ping', { created: '2026-01-01T00:00:00.000Z' }),
        { nonce: '2026-01-01T00:00:00.000Z' });
    });

    it('P2P_PEER_ANNOUNCE', function () {
      assert.deepStrictEqual(
        roundTrip('P2P_PEER_ANNOUNCE', { host: 'hub.example', port: 7777, pubkey: OWNER_PUB, nonce: 'n1' }),
        { host: 'hub.example', port: 7777, pubkey: OWNER_PUB, nonce: 'n1' }
      );
      assert.deepStrictEqual(roundTrip('P2P_PEER_ANNOUNCE', { host: 'hub.example', port: '7777' }),
        { host: 'hub.example', port: 7777 });
    });

    it('keeps ports in the socket range and slots in the u32 range', function () {
      assert.strictEqual(Message.encodeLegacyBody('P2P_PEER_ANNOUNCE', { host: 'h', port: 65535 }).port, 65535);
      assert.strictEqual(Message.encodeLegacyBody('P2P_PEER_ANNOUNCE', { host: 'h', port: 65536 }).port, 0);
      assert.strictEqual(Message.encodeLegacyBody('P2P_PEER_GOSSIP', { host: 'h', port: 70000 }).port, 0);
      assert.strictEqual(Message.decodeLegacyBody('P2P_PEER_ANNOUNCE', { host: 'h', port: 70000 }).port, 0);
      const offer = roundTrip('P2P_PEERING_OFFER', { transport: 'fabric', host: 'h', port: 70000, slots: 100000 });
      assert.strictEqual(offer.port, 0);
      assert.strictEqual(offer.slots, 100000);
      assert.deepStrictEqual(Message.canonicalPeeringObject({ host: 'h', port: 70000, slots: 100000 }),
        { host: 'h', port: 0, slots: 100000 });
    });

    it('P2P_PEER_GOSSIP keeps an explicit hop and flattens the envelope', function () {
      assert.deepStrictEqual(
        roundTrip('P2P_PEER_GOSSIP', {
          type: 'P2P_PEER_GOSSIP',
          object: { host: '10.0.0.2', port: 7777, gossipHop: 3, nonce: 'g1', pubkey: OWNER_PUB }
        }),
        { host: '10.0.0.2', port: 7777, gossipHop: 3, nonce: 'g1', pubkey: OWNER_PUB }
      );
    });

    it('P2P_PEERING_OFFER carries the appended optional fields', function () {
      assert.deepStrictEqual(
        roundTrip('P2P_PEERING_OFFER', {
          type: 'P2P_PEERING_OFFER',
          actor: { id: OWNER_PUB },
          object: {
            slots: 4,
            transport: 'fabric',
            host: 'relay.example',
            port: 7777,
            pubkey: OWNER_PUB,
            peering: `${OWNER_PUB}@relay.example:7777`,
            rendezvous: { hubs: ['hub.example:7777'] }
          }
        }),
        {
          transport: 'fabric',
          host: 'relay.example',
          port: 7777,
          peeringHop: PEERING_OFFER_MAX_HOPS,
          pubkey: OWNER_PUB,
          slots: 4,
          peering: `${OWNER_PUB}@relay.example:7777`
        }
      );
    });

    it('CONTRACT_PUBLISH returns the definition unchanged', function () {
      const def = definition();
      assert.deepStrictEqual(roundTrip('CONTRACT_PUBLISH', def), def);
    });

    it('CONTRACT_MESSAGE merges contract with the payload', function () {
      const body = {
        contract: 'ab'.repeat(32),
        type: 'GroupChat',
        actor: { id: OWNER_PUB },
        object: { body: 'hello', ts: '2026-01-01T00:00:00.000Z' }
      };
      const back = roundTrip('CONTRACT_MESSAGE', body);
      assert.deepStrictEqual(back, body);
      assert.deepStrictEqual(Object.keys(back), Object.keys(body), 'key order is kept');
    });

    it('CONTRACT_MESSAGE indexes recipient, ref, and slot without reading the payload', function () {
      const body = {
        contract: 'ab'.repeat(32),
        type: 'GroupChat',
        object: { body: 'hello', recipient: 'bob', ref: 'm1', slot: 'general' }
      };
      const msg = Message.fromLegacyBody('CONTRACT_MESSAGE', body);
      const fields = msg.toFields();
      assert.deepStrictEqual(Message.contractMessageIndex(msg), {
        recipient: 'bob',
        ref: 'm1',
        slot: 'general'
      });
      assert.strictEqual(JSON.parse(fields.payload).object.body, 'hello');
      assert.strictEqual(Message.contractMessageMatches(msg, { recipient: 'bob', ref: 'm1' }), true);
      assert.strictEqual(Message.contractMessageMatches(msg, { recipient: 'ada' }), false);

      const indexed = Message.fromFields('CONTRACT_MESSAGE', {
        contract: 'ab'.repeat(32),
        payload: 'not-json',
        recipient: 'bob'
      });
      assert.deepStrictEqual(Message.contractMessageIndex(indexed), { recipient: 'bob', ref: '', slot: '' });
      assert.strictEqual(Message.contractMessageMatches(indexed, { recipient: 'bob' }), true);

      const bare = Message.encodeBody(
        [{ name: 'contract', type: 'string' }, { name: 'payload', type: 'string' }],
        { contract: 'ab'.repeat(32), payload: '{"type":"GroupChat"}' }
      );
      const decoded = Message.decodeBody(Message.SCHEMA_CONTRACT_MESSAGE, bare);
      assert.strictEqual(decoded.recipient, '');
      assert.strictEqual(decoded.payload, '{"type":"GroupChat"}');

      const unindexed = Message.fromLegacyBody('CONTRACT_MESSAGE', {
        contract: 'ab'.repeat(32),
        type: 'GroupChat',
        object: { body: 'hello' }
      });
      assert.ok(unindexed.bodyBuffer.equals(Message.encodeBody(
        [{ name: 'contract', type: 'string' }, { name: 'payload', type: 'string' }],
        { contract: 'ab'.repeat(32), payload: JSON.stringify({ type: 'GroupChat', object: { body: 'hello' } }) }
      )));
      assert.throws(
        () => Message.fromLegacyBody('CONTRACT_MESSAGE', { contract: 'ab'.repeat(32), recipient: 'x'.repeat(257) }),
        /recipient exceeds 256/
      );
    });

    it('SIDECHAIN_STATE_PATCH', function () {
      const back = roundTrip('SIDECHAIN_STATE_PATCH', {
        basisClock: 7,
        basisDigest: 'cd'.repeat(32),
        patches: [{ op: 'add', path: '/x', value: { b: 1, a: 2 } }],
        federationWitness: { version: 1, signatures: { [OWNER_PUB]: 'ff'.repeat(64) } }
      });
      assert.deepStrictEqual(back, {
        type: 'SIDECHAIN_STATE_PATCH',
        version: 1,
        kind: 'SidechainStatePatch',
        basisClock: 7,
        basisDigest: 'cd'.repeat(32),
        patches: [{ op: 'add', path: '/x', value: { a: 2, b: 1 } }],
        federationWitness: { signatures: { [OWNER_PUB]: 'ff'.repeat(64) }, version: 1 }
      });
    });

    it('SIDECHAIN_STATE_PATCH builds registry patches from catalogCanonical', function () {
      const legacy = Message.decodeLegacyBody('SIDECHAIN_STATE_PATCH', {
        basisClock: 0,
        basisDigest: Buffer.alloc(32),
        catalogCanonical: '{"documents":{},"version":1}',
        patchesCanonical: ''
      });
      assert.strictEqual(legacy.basisDigest, '');
      assert.deepStrictEqual(legacy.patches, [
        { op: 'add', path: '/registry', value: { documents: {}, version: 1 } }
      ]);
    });
  });

  describe('encoding rules', function () {
    it('a missing hop encodes as the maximum, never 0', function () {
      assert.strictEqual(Message.encodeLegacyBody('P2P_PEER_GOSSIP', { host: 'h', port: 1 }).gossipHop, GOSSIP_MAX_HOPS);
      assert.strictEqual(Message.encodeLegacyBody('P2P_PEERING_OFFER', { host: 'h', port: 1 }).peeringHop, PEERING_OFFER_MAX_HOPS);
      assert.strictEqual(Message.encodeLegacyBody('P2P_PEER_GOSSIP', { host: 'h', port: 1, gossipHop: 0 }).gossipHop, 0);
    });

    it('rejects bodies it cannot represent', function () {
      assert.throws(() => Message.encodeLegacyBody('CONTRACT_MESSAGE', { type: 'GroupChat' }), /requires contract/);
      assert.throws(() => Message.encodeLegacyBody('CONTRACT_PUBLISH', 'nope'), /must be an object/);
      assert.throws(() => Message.encodeLegacyBody('SIDECHAIN_STATE_PATCH', { basisClock: 0, patches: [] }), /requires patches/);
      assert.throws(() => Message.encodeLegacyBody('P2P_CHAT_MESSAGE', {}), /no field mapping/);
      assert.throws(() => Message.fromLegacyBody('GenericMessage', {}), /no field mapping/);
    });

    it('unusable field bodies decode to null', function () {
      assert.strictEqual(Message.decodeLegacyBody('CONTRACT_PUBLISH', { definition: '[1]' }), null);
      assert.strictEqual(Message.decodeLegacyBody('CONTRACT_MESSAGE', { contract: '', payload: '{}' }), null);
      assert.strictEqual(Message.decodeLegacyBody('CONTRACT_MESSAGE', { contract: 'c', payload: 'x' }), null);
      assert.strictEqual(Message.decodeLegacyBody('P2P_CHAT_MESSAGE', {}), null);
    });

    it('a malformed patch list is rejected, not replaced by the catalog', function () {
      const fields = {
        basisClock: 0,
        basisDigest: Buffer.alloc(32),
        catalogCanonical: '{"documents":{},"version":1}'
      };
      assert.strictEqual(Message.decodeLegacyBody('SIDECHAIN_STATE_PATCH', Object.assign({ patchesCanonical: '{"op":"add"}' }, fields)), null);
      assert.strictEqual(Message.decodeLegacyBody('SIDECHAIN_STATE_PATCH', Object.assign({ patchesCanonical: 'not json' }, fields)), null);
      assert.ok(Message.decodeLegacyBody('SIDECHAIN_STATE_PATCH', Object.assign({ patchesCanonical: '[]' }, fields)));
    });

    it('tryParseLegacyBody reports an unusable field body as an Error', function () {
      const wire = Message.fromBuffer(Message.fromFields('CONTRACT_PUBLISH', { definition: '[1]' }).signWithKey(OWNER).toBuffer());
      const parsed = Message.tryParseLegacyBody(wire);
      assert.strictEqual(parsed.ok, false);
      assert.ok(parsed.error instanceof Error);
      assert.match(parsed.error.message, /unusable CONTRACT_PUBLISH field body/);
    });

    it('JSON bodies still parse through tryParseLegacyBody', function () {
      const parsed = Message.tryParseLegacyBody(Message.fromBuffer(jsonFrame('P2P_PING', { created: 'x' }).toBuffer()));
      assert.strictEqual(parsed.encoding, 'json');
      assert.deepStrictEqual(parsed.value, { created: 'x' });
    });

    it('a field publish yields the same contract id as the JSON publish', function () {
      const def = { zeta: 1, alpha: { y: 2, x: 1 }, parties: [OWNER_PUB] };
      const json = Message.tryParseLegacyBody(Message.fromBuffer(jsonFrame('CONTRACT_PUBLISH', def).toBuffer())).value;
      const fields = roundTrip('CONTRACT_PUBLISH', def);
      assert.strictEqual(new Actor(fields).id, new Actor(json).id);
      assert.strictEqual(new Actor(fields).id, new Actor(def).id);
    });
  });

  describe('dedup and registration keys ignore the encoding', function () {
    const peer = new Peer(offlinePeerSettings());

    it('gossip and offer payload keys', function () {
      const jsonGossip = { type: 'P2P_PEER_GOSSIP', object: { port: '7777', nonce: 'g', host: 'h', gossipHop: 2 } };
      const fieldGossip = { type: 'P2P_PEER_GOSSIP', object: roundTrip('P2P_PEER_GOSSIP', jsonGossip) };
      assert.strictEqual(peer._gossipPayloadDedupKey(jsonGossip), peer._gossipPayloadDedupKey(fieldGossip));

      const jsonOffer = { type: 'P2P_PEERING_OFFER', object: { host: 'h', port: 7777, transport: 'fabric', pubkey: '' } };
      const fieldOffer = { type: 'P2P_PEERING_OFFER', object: roundTrip('P2P_PEERING_OFFER', jsonOffer) };
      assert.strictEqual(peer._peeringOfferPayloadDedupKey(jsonOffer), peer._peeringOfferPayloadDedupKey(fieldOffer));
    });

    it('announce and publish registration keys', function () {
      const announce = { port: 7777, host: 'hub.example', pubkey: OWNER_PUB };
      assert.strictEqual(
        peer._logicalRegistrationKey('P2P_PEER_ANNOUNCE', announce),
        peer._logicalRegistrationKey('P2P_PEER_ANNOUNCE', roundTrip('P2P_PEER_ANNOUNCE', announce))
      );
      const def = definition();
      assert.strictEqual(
        peer._logicalRegistrationKey('CONTRACT_PUBLISH', def),
        peer._logicalRegistrationKey('CONTRACT_PUBLISH', roundTrip('CONTRACT_PUBLISH', def))
      );
    });

    it('a JSON copy and a field copy of one gossip emit once', function () {
      const receiver = new Peer(offlinePeerSettings());
      let seen = 0;
      receiver.on('peeringGossip', () => { seen += 1; });
      const body = { host: '10.1.1.1', port: 7777, nonce: 'once' };
      receiver._handleFabricMessage(jsonFrame('P2P_PEER_GOSSIP', body).toBuffer(), { name: 'a' });
      receiver._handleFabricMessage(fieldFrame('P2P_PEER_GOSSIP', body).toBuffer(), { name: 'b' });
      assert.strictEqual(seen, 1);
    });
  });

  describe('Peer receive paths', function () {
    it('field offers reach peeringOffer with the legacy object', function () {
      const receiver = new Peer(offlinePeerSettings());
      let got = null;
      receiver.on('peeringOffer', (ev) => { got = ev; });
      receiver._handleFabricMessage(fieldFrame('P2P_PEERING_OFFER', {
        transport: 'webrtc', host: 'relay.example', port: 7777, pubkey: OWNER_PUB
      }).toBuffer(), { name: 'a' });
      assert.ok(got);
      assert.deepStrictEqual(got.message.object, {
        transport: 'webrtc', host: 'relay.example', port: 7777, peeringHop: PEERING_OFFER_MAX_HOPS, pubkey: OWNER_PUB
      });
    });

    it('a field publish registers the same contract as JSON', function () {
      const receiver = new Peer(offlinePeerSettings());
      const events = [];
      receiver.on('contract:publish', (ev) => events.push(ev));
      receiver._handleFabricMessage(fieldFrame('CONTRACT_PUBLISH', definition()).toBuffer(), { name: 'a' });
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].contract, new Actor(definition()).id);
      assert.deepStrictEqual(events[0].object, definition());
      assert.ok(receiver.contracts[new Actor(definition()).id]);
    });

    it('a field CONTRACT_MESSAGE emits the JSON event shape and applies its ops', function () {
      const id = new Actor(definition()).id;
      const body = { contract: id, type: 'ContractMessage', ops: [{ op: 'add', path: '/note', value: 'from-fields' }] };
      const shapes = [];
      for (const frame of [jsonFrame('CONTRACT_MESSAGE', body), fieldFrame('CONTRACT_MESSAGE', body)]) {
        const receiver = new Peer(offlinePeerSettings());
        receiver._handleFabricMessage(fieldFrame('CONTRACT_PUBLISH', definition()).toBuffer(), { name: 'a' });
        let ev = null;
        receiver.on('contract:message', (e) => { ev = e; });
        receiver._handleFabricMessage(frame.toBuffer(), { name: 'a' });
        assert.ok(ev, 'contract:message emitted');
        assert.strictEqual(ev.contract, id);
        assert.strictEqual(receiver._state.content.contracts[id].note, 'from-fields');
        shapes.push(ev.object);
      }
      assert.deepStrictEqual(shapes[1], shapes[0]);
    });

    it('a field sidechain patch passes the federation witness check', function () {
      const receiver = new Peer(offlinePeerSettings({
        distributed: { federation: { validators: [OWNER.pubkey], threshold: 1 } }
      }));
      let got = null;
      receiver.on('sidechain:patch', (ev) => { got = ev; });
      const proposal = { basisClock: 0, basisDigest: 'ee'.repeat(32), patches: [{ op: 'add', path: '/f', value: 1 }] };
      const msg = sidechainState.buildSignedSidechainPatchMessage({ proposal, signKey: OWNER });
      assert.strictEqual(Message.tryParseMessageBody(Message.fromBuffer(msg.toBuffer())).encoding, 'fields');
      receiver._handleFabricMessage(msg.toBuffer(), { name: 'a' });
      assert.ok(got);
      assert.strictEqual(got.proposal.basisDigest, proposal.basisDigest);
      assert.deepStrictEqual(got.proposal.patches, proposal.patches);
    });

    it('repeated pings and pongs are distinct frames', function () {
      const peer = new Peer(offlinePeerSettings());
      const socket = {};
      const pings = [];
      const realSetInterval = global.setInterval;
      let tick = null;
      global.setInterval = (fn) => { tick = fn; return 0; };
      try {
        peer._startFabricPingKeepalive(socket, { write: (buf) => pings.push(buf) });
      } finally {
        global.setInterval = realSetInterval;
      }
      tick();
      socket._fabricPingOutstanding = 0;
      tick();
      assert.strictEqual(pings.length, 2);
      const [a, b] = pings.map((buf) => Message.fromBuffer(buf));
      assert.notStrictEqual(a.id, b.id);
      assert.notStrictEqual(a.toFields().nonce, b.toFields().nonce);

      const pongs = [];
      peer.connections.addr = { _writeFabric: (buf) => pongs.push(Message.fromBuffer(buf)) };
      peer._handleFabricMessage(pings[0], { name: 'addr' });
      peer._handleFabricMessage(pings[1], { name: 'addr' });
      assert.strictEqual(pongs.length, 2);
      assert.strictEqual(pongs[0].type, 'P2P_PONG');
      assert.strictEqual(pongs[0].toFields().nonce, a.toFields().nonce);
      assert.strictEqual(pongs[1].toFields().nonce, b.toFields().nonce);
      assert.notStrictEqual(pongs[0].id, pongs[1].id);
    });
  });

  describe('session, inventory, and document layouts', function () {
    const HASH = 'ab'.repeat(32);
    const sender = new Peer(offlinePeerSettings());
    const claim = sender._buildSessionKeyExchangeClaim();
    const sessionOffer = {
      type: 'P2P_SESSION_OFFER',
      actor: Object.assign({ id: sender.identity.id }, claim),
      object: { challenge: '0011223344556677', maxFrameBytes: 1048576 }
    };
    const documentBody = {
      contentBase64: Buffer.from('hello fields').toString('base64'),
      id: HASH,
      mime: 'text/plain',
      name: 'hello.txt',
      revision: 1,
      sha256: HASH,
      size: 12
    };

    it('registers each layout under its opcode, wire name, and alias', function () {
      const names = [
        ['P2P_SESSION_OFFER', 'SessionOffer', Message.SCHEMA_P2P_SESSION_OFFER],
        ['P2P_SESSION_OPEN', 'SessionOpen', Message.SCHEMA_P2P_SESSION_OPEN],
        ['P2P_INVENTORY_REQUEST', 'InventoryRequest', Message.SCHEMA_P2P_INVENTORY_REQUEST],
        ['P2P_INVENTORY_RESPONSE', 'InventoryResponse', Message.SCHEMA_P2P_INVENTORY_RESPONSE],
        ['P2P_DOCUMENT_PUBLISH', 'DocumentPricingPublish', Message.SCHEMA_P2P_DOCUMENT_PUBLISH],
        ['DOCUMENT_PUBLISH', 'DocumentPublish', Message.SCHEMA_DOCUMENT_PUBLISH],
        ['DOCUMENT_REQUEST', 'DocumentRequest', Message.SCHEMA_DOCUMENT_REQUEST]
      ];
      for (const [name, alias, schema] of names) {
        assert.ok(Array.isArray(schema), name);
        assert.deepStrictEqual(Message.getBodySchema(name), schema.slice());
        assert.deepStrictEqual(Message.getBodySchema(alias), schema.slice());
        assert.deepStrictEqual(Message.getBodySchema(Message.canonicalTypeCode(name)), schema.slice());
        assert.ok(Message.LEGACY_BODY_TYPES.includes(name), name);
      }
      assert.strictEqual(Message.getBodySchema('P2P_SESSION_ACK'), null);
    });

    it('P2P_SESSION_OFFER and P2P_SESSION_OPEN', function () {
      assert.deepStrictEqual(roundTrip('P2P_SESSION_OFFER', sessionOffer), sessionOffer);
      const open = {
        type: 'P2P_SESSION_OPEN',
        actor: Object.assign({}, sessionOffer.actor, { parentXpub: null }),
        object: { initiator: 'a'.repeat(20), counterparty: 'b'.repeat(20), solution: '0011223344556677', maxFrameBytes: 65536 }
      };
      assert.deepStrictEqual(roundTrip('SessionOpen', open), open);
    });

    it('a field session offer passes the key-exchange check like JSON', function () {
      const receiver = new Peer(offlinePeerSettings());
      const fromJson = receiver._validateSessionKeyExchangeClaim(sessionOffer, claim.pubkey, 'a');
      const fromFields = receiver._validateSessionKeyExchangeClaim(roundTrip('P2P_SESSION_OFFER', sessionOffer), claim.pubkey, 'a');
      assert.ok(fromJson);
      assert.deepStrictEqual(fromFields, fromJson);
    });

    it('P2P_INVENTORY_REQUEST, flat and as a Hub envelope', function () {
      const offer = { offerBtc: true, maxSats: 0, buyerRefundPublicKey: '02' + HASH, blobHashHex: HASH };
      assert.deepStrictEqual(roundTrip('P2P_INVENTORY_REQUEST', offer), offer);
      const documents = { kind: 'documents', created: 1793376578453 };
      assert.deepStrictEqual(roundTrip('InventoryRequest', documents), documents);
      const hub = {
        type: 'FABRIC_DOCUMENT_OFFER',
        actor: { id: 'hub' },
        object: { kind: 'mainchain-blocks', created: 1, hashes: [HASH], inventoryRelayTtl: 6, htlcAmountSats: 2000 },
        target: '127.0.0.1:7777'
      };
      assert.deepStrictEqual(roundTrip('P2P_INVENTORY_REQUEST', hub), hub);
    });

    it('P2P_INVENTORY_RESPONSE keeps items and paging', function () {
      const page = {
        kind: 'documents',
        items: [{ id: HASH, blobs: [{ index: 0, hash: HASH }], purchasePriceSats: 716 }],
        created: 1793376578453,
        inventoryId: '0011223344556677',
        page: 1,
        pages: 3
      };
      const back = roundTrip('P2P_INVENTORY_RESPONSE', page);
      assert.deepStrictEqual(back, page);
      assert.deepStrictEqual(Object.keys(back.items[0]), Object.keys(page.items[0]), 'item key order is kept');
      const hub = { type: 'FABRIC_DOCUMENT_OFFER_RESPONSE', actor: { id: 'hub' }, object: { kind: 'documents', items: [], created: 2 }, target: 'buyer' };
      assert.deepStrictEqual(roundTrip('InventoryResponse', hub), hub);
    });

    it('DOCUMENT_REQUEST keeps zero, false, and unknown keys', function () {
      const body = {
        document: HASH,
        maxSats: 500,
        relayHop: 0,
        routeId: '0102030405060708',
        blobIndex: 0,
        batchEnd: 4,
        blobTotal: 9,
        quote: false,
        credit: true,
        creditRef: 'ref-1',
        contentHashHex: HASH,
        futureKey: { x: 1 }
      };
      assert.deepStrictEqual(roundTrip('DocumentRequest', body), body);
      assert.deepStrictEqual(roundTrip('DOCUMENT_REQUEST', { id: 'legacy-id' }), { id: 'legacy-id' });
    });

    it('values a field cannot hold exactly ride in extra', function () {
      const odd = { document: 'd', blobIndex: -1, relayHop: 300, maxSats: 1.5, contentHashHex: HASH.toUpperCase(), quote: 'yes', routeId: null };
      const fields = Message.encodeLegacyBody('DOCUMENT_REQUEST', odd);
      assert.deepStrictEqual(JSON.parse(fields.extra), { blobIndex: -1, relayHop: 300, maxSats: 1.5, contentHashHex: HASH.toUpperCase(), quote: 'yes', routeId: null });
      assert.deepStrictEqual(roundTrip('DOCUMENT_REQUEST', odd), odd);
      const loose = Object.assign({}, documentBody, { contentBase64: 'aGVsbG8', revision: '2' });
      assert.deepStrictEqual(roundTrip('DocumentPublish', loose), loose);
      assert.deepStrictEqual(roundTrip('DocumentPublish', Object.assign({}, documentBody, { contentBase64: null })),
        Object.assign({}, documentBody, { contentBase64: null }));
      assert.deepStrictEqual(roundTrip('P2P_INVENTORY_REQUEST', { offerBtc: true, maxSats: undefined }), { offerBtc: true });
    });

    it('DOCUMENT_PUBLISH carries the content as raw bytes and keeps the payment hash', function () {
      const back = roundTrip('DocumentPublish', documentBody);
      assert.deepStrictEqual(back, documentBody);
      assert.strictEqual(purchaseContentHashHex(HASH, back), purchaseContentHashHex(HASH, documentBody));
      const fields = Message.fromLegacyBody('DOCUMENT_PUBLISH', documentBody).toFields();
      assert.strictEqual(fields.content.toString('utf8'), 'hello fields');
    });

    it('P2P_DOCUMENT_PUBLISH', function () {
      const rate = {
        type: 'P2P_DOCUMENT_PUBLISH',
        object: { hash: HASH, rate: 1000, contentHash: HASH, contentHashHex: HASH, binding: 'envelope' }
      };
      assert.deepStrictEqual(roundTrip('DocumentPricingPublish', rate), rate);
    });

    it('rejects non-object bodies and decodes unusable fields to null', function () {
      assert.throws(() => Message.encodeLegacyBody('DOCUMENT_REQUEST', 'doc'), /must be an object/);
      assert.throws(() => Message.encodeLegacyBody('P2P_SESSION_OFFER', [1]), /must be an object/);
      assert.strictEqual(Message.decodeLegacyBody('DOCUMENT_REQUEST', { present: 0, extra: '[1]' }), null);
      assert.strictEqual(Message.decodeLegacyBody('DOCUMENT_REQUEST', { present: 0, extra: 'nope' }), null);
      assert.strictEqual(Message.decodeLegacyBody('DOCUMENT_REQUEST', { present: 1 << 8, quote: 2, extra: '' }), null);
      assert.strictEqual(Message.decodeLegacyBody('DOCUMENT_REQUEST', { present: 1 << 11, contentHash: Buffer.alloc(31), extra: '' }), null);
      assert.strictEqual(Message.decodeLegacyBody('P2P_SESSION_OFFER', { present: 1 << 1, actor: 'x', extra: '{"actor":"y"}' }), null);
      assert.deepStrictEqual(Message.decodeLegacyBody('DOCUMENT_REQUEST', { present: 0, extra: '' }), {});
    });

    it('dedup and registration keys ignore the encoding', function () {
      const peer = new Peer(offlinePeerSettings());
      assert.strictEqual(
        peer._logicalRegistrationKey('DOCUMENT_PUBLISH', roundTrip('DOCUMENT_PUBLISH', documentBody)),
        peer._logicalRegistrationKey('DOCUMENT_PUBLISH', documentBody)
      );
      const rate = { hash: HASH, rate: 1000, contentHash: HASH };
      assert.strictEqual(
        peer._logicalRegistrationKey('P2P_DOCUMENT_PUBLISH', roundTrip('P2P_DOCUMENT_PUBLISH', rate)),
        peer._logicalRegistrationKey('P2P_DOCUMENT_PUBLISH', rate)
      );
    });

    it('Peer emits the same events for JSON and field frames', function () {
      const request = { document: HASH, blobIndex: 0, contentHashHex: HASH };
      const inventory = { kind: 'documents', created: 5 };
      const rate = { type: 'P2P_DOCUMENT_PUBLISH', object: { hash: HASH, rate: 1000, contentHash: HASH } };
      const seen = [];
      for (const frame of [jsonFrame, fieldFrame]) {
        const receiver = new Peer(offlinePeerSettings());
        const got = {};
        receiver.on('documentRequest', (ev) => { got.request = ev.parsed; });
        receiver.on('documentPublish', (ev) => {
          if (ev.source === 'canonical') got.publish = [ev.parsed, ev.purchaseContentHashHex];
          else got.rate = [ev.documentId, ev.rateSats, ev.contentHash];
        });
        receiver.on('inventory', (ev) => { got.inventory = ev.message.object; });
        receiver._handleFabricMessage(frame('DocumentRequest', request).toBuffer(), { name: 'a' });
        receiver._handleFabricMessage(frame('DocumentPublish', documentBody).toBuffer(), { name: 'a' });
        receiver._handleFabricMessage(frame('P2P_DOCUMENT_PUBLISH', rate).toBuffer(), { name: 'a' });
        receiver._handleFabricMessage(frame('P2P_INVENTORY_REQUEST', inventory).toBuffer(), { name: 'a' });
        assert.deepStrictEqual(Object.keys(got).sort(), ['inventory', 'publish', 'rate', 'request'], frame.name);
        seen.push(got);
      }
      assert.deepStrictEqual(seen[1], seen[0]);
      assert.deepStrictEqual(seen[1].request, request);
      assert.deepStrictEqual(seen[1].inventory, inventory);
    });
  });

  describe('contract helpers accept field frames', function () {
    const id = new Actor(definition()).id;
    const frame = fieldFrame('CONTRACT_MESSAGE', { contract: id, type: 'GroupChat', object: { body: 'hi' } });

    it('parseContractMessageBody', function () {
      const parsed = parseContractMessageBody(Message.fromBuffer(frame.toBuffer()));
      assert.deepStrictEqual(parsed, { contract: id, type: 'GroupChat', object: { body: 'hi' } });
    });

    it('contractMessageQueue', function () {
      const result = enqueueMessageBuffer(createMemoryStore(), id, frame.toBuffer());
      assert.strictEqual(result.accepted, true, result.error);
    });

    it('fabricMessageCollection', function () {
      const result = ingest(createCollection(), frame.toBuffer());
      assert.strictEqual(result.accepted, true, result.error);
      assert.strictEqual(result.record.appType, 'GroupChat');
      assert.strictEqual(result.record.contract, id);
    });
  });
});
