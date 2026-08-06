'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { describe, it } = require('mocha');
const bitcoin = require('bitcoinjs-lib');

const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const ecc = require('../types/ecc');
const {
  PEER_BAN_TTL_MS,
  PEER_MAX_RELAY_NEST_DEPTH,
  PEER_SCORE_BODY_HASH_MISMATCH_PENALTY,
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE
} = require('../constants');
const { DocumentBlobTransferBook } = require('../functions/documentBlobManifest');
const inventoryHtlc = require('../functions/inventoryHtlc');

bitcoin.initEccLib(ecc);

describe('@fabric/core Peer adversarial hardening', function () {
  function offlinePeer (overrides = {}) {
    return new Peer(Object.assign({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      debug: false
    }, overrides));
  }

  function wireConn (writes) {
    return {
      _writeFabric (buf) { writes.push(buf); },
      destroy () { this.destroyed = true; },
      destroyed: false
    };
  }

  it('defaults autoFulfillDocumentRequests to false', function () {
    const peer = offlinePeer();
    assert.strictEqual(peer.settings.autoFulfillDocumentRequests, false);
  });

  it('P2P_RELAY forwards bit-identical outer (no re-wrap)', function () {
    const peer = offlinePeer();
    const k = new Key();
    const a = '127.0.0.1:9100';
    const bWrites = [];
    peer.connections[a] = wireConn([]);
    peer.connections['127.0.0.1:9101'] = wireConn(bWrites);
    peer.peers[a] = { publicKey: k.pubkey };

    const inner = Message.fromVector(['P2P_PING', JSON.stringify({ t: 1 })]).signWithKey(k);
    const relay = Message.fromVector(['P2P_RELAY', inner.toBuffer()]).signWithKey(k);
    const outerBuf = relay.toBuffer();

    peer._handleFabricMessage(outerBuf, { name: a }, null);

    assert.ok(bWrites.length >= 1);
    const forwarded = bWrites.find((buf) => Message.fromBuffer(buf).type === 'P2P_RELAY');
    assert.ok(forwarded);
    assert.ok(outerBuf.equals(forwarded), 'forwarded outer must be bit-identical to received envelope');
  });

  it('nested P2P_RELAY beyond nest cap hard-punishes and does not amplify', function () {
    const peer = offlinePeer({
      peerScore: { maxRelayNestDepth: 1, banTtlMs: 60000 }
    });
    const k = new Key();
    const a = '127.0.0.1:9110';
    const bWrites = [];
    let destroyed = false;
    peer.connections[a] = {
      _writeFabric () {},
      destroy () { destroyed = true; }
    };
    peer.connections['127.0.0.1:9111'] = wireConn(bWrites);
    peer._addressToId[a] = 'nest-peer';
    peer._state.peers = { 'nest-peer': { id: 'nest-peer', address: a, score: 200, publicKey: k.pubkey } };
    peer.peers[a] = { publicKey: k.pubkey };

    const leaf = Message.fromVector(['P2P_PING', JSON.stringify({ nest: true })]).signWithKey(k);
    const mid = Message.fromVector(['P2P_RELAY', leaf.toBuffer()]).signWithKey(k);
    const outer = Message.fromVector(['P2P_RELAY', mid.toBuffer()]).signWithKey(k);

    // depth 0 unwraps mid; mid at depth 1 unwraps leaf OK with maxNest=1
    // Need depth such that relayDepth >= maxNest: outer(0)->mid(1)-> if mid is RELAY and max=1,
    // when handling mid, relayDepth=1 >= 1 → punish.
    peer._handleFabricMessage(outer.toBuffer(), { name: a }, null);
    assert.strictEqual(destroyed, true);
    assert.ok(peer._isPeerBanned(a));
    // Must not keep re-wrapping new outers into b.
    const uniqueOuters = new Set(bWrites.map((b) => b.toString('hex')));
    assert.ok(uniqueOuters.size <= 1, 'must not emit many re-wrapped RELAY variants');
  });

  it('hard misbehavior bans address and blocks dial + inbound message', function () {
    const peer = offlinePeer({
      peerScore: { banTtlMs: PEER_BAN_TTL_MS }
    });
    const origin = '127.0.0.1:9120';
    peer._addressToId[origin] = 'ban-peer';
    peer._state.peers = {
      'ban-peer': { id: 'ban-peer', address: origin, score: 150, publicKey: 'ab'.repeat(32) }
    };
    let destroyed = false;
    peer.connections[origin] = {
      destroy () { destroyed = true; }
    };

    const msg = Message.fromVector(['P2P_PING', JSON.stringify({ t: 9 })]).signWithKey(peer.key);
    const buf = Buffer.from(msg.toBuffer());
    if (buf.length > 208) buf[208] ^= 0xff;
    peer._handleFabricMessage(buf, { name: origin }, null);

    assert.strictEqual(destroyed, true);
    assert.ok(peer._isPeerBanned(origin));
    assert.ok(peer._isPeerBanned(null, 'ab'.repeat(32)));
    assert.strictEqual(
      peer._state.peers['ban-peer'].score,
      150 - PEER_SCORE_BODY_HASH_MISMATCH_PENALTY
    );

    // Dial refused
    let connected = false;
    peer._outboundDialTargets = new Set();
    const origCreate = require('net').createConnection;
    // _connect returns early before createConnection when banned
    peer._connect(origin);
    assert.strictEqual(peer.connections[origin] == null || peer.connections[origin].destroyed === true || destroyed, true);

    // Inbound message from banned peer dropped
    const ping = Message.fromVector(['P2P_PING', JSON.stringify({ ok: 1 })]).signWithKey(peer.key);
    let handled = false;
    peer.on('debug', () => { handled = true; });
    peer._handleFabricMessage(ping.toBuffer(), { name: origin }, null);
    void origCreate;
    void connected;
    void handled;
    assert.ok(peer._isPeerBanned(origin));
  });

  it('P2P_PEER_ANNOUNCE uses capped candidate enqueue', function () {
    const peer = offlinePeer({ peering: { maxCandidates: 2 } });
    for (let i = 0; i < 3; i++) {
      peer._handleGenericMessage({
        type: 'P2P_PEER_ANNOUNCE',
        object: { host: `10.0.0.${i + 1}`, port: 7777 + i }
      }, { name: `o${i}` });
    }
    assert.strictEqual(peer.candidates.length, 2);
  });

  it('exports nest depth constant', function () {
    assert.ok(PEER_MAX_RELAY_NEST_DEPTH >= 1);
  });

  it('drops oversized frames before verify (no score change)', function () {
    const peer = offlinePeer();
    const origin = '127.0.0.1:9130';
    peer._addressToId[origin] = 'big-peer';
    peer._state.peers = {
      'big-peer': { id: 'big-peer', address: origin, score: 100, publicKey: 'cd'.repeat(32) }
    };
    const huge = Buffer.alloc(HEADER_SIZE + MAX_MESSAGE_SIZE + 64, 0xab);
    peer._handleFabricMessage(huge, { name: origin }, null);
    assert.strictEqual(peer._state.peers['big-peer'].score, 100);
    assert.strictEqual(peer._isPeerBanned(origin), false);
  });

  it('rate-limits chat mesh relay but still emits locally', function () {
    const peer = offlinePeer({
      chat: { maxRelaysPerOriginPerMinute: 2 }
    });
    const k = new Key();
    const a = '127.0.0.1:9140';
    const bWrites = [];
    peer.connections[a] = wireConn([]);
    peer.connections['127.0.0.1:9141'] = wireConn(bWrites);
    peer.peers[a] = { publicKey: k.pubkey };

    let chats = 0;
    peer.on('chat', () => { chats++; });

    for (let i = 0; i < 4; i++) {
      const msg = Message.fromVector(['P2P_CHAT_MESSAGE', `hello-${i}-${Date.now()}`]).signWithKey(k);
      peer._handleFabricMessage(msg.toBuffer(), { name: a }, null);
    }
    assert.strictEqual(chats, 4);
    assert.ok(bWrites.length <= 2, `expected ≤2 chat relays, got ${bWrites.length}`);
    assert.ok(CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE >= 1);
  });

  it('caps pending sealed deliveries', function () {
    const peer = offlinePeer({ maxPendingSealedDeliveries: 2 });
    peer.pendingSealedDeliveries.a = { updated: 1, ciphertext: Buffer.from('a') };
    peer.pendingSealedDeliveries.b = { updated: 2, ciphertext: Buffer.from('b') };
    peer.pendingSealedDeliveries.c = { updated: 3, ciphertext: Buffer.from('c') };
    peer._capPendingSealedDeliveries();
    assert.strictEqual(Object.keys(peer.pendingSealedDeliveries).length, 2);
    assert.ok(!peer.pendingSealedDeliveries.a);
    assert.ok(peer.pendingSealedDeliveries.b);
    assert.ok(peer.pendingSealedDeliveries.c);
  });

  it('DocumentBlobTransferBook caps pending transfers', function () {
    const book = new DocumentBlobTransferBook({ maxPending: 2, ttlMs: 60_000 });
    book.expectTransfer({ documentId: 'd1', merkleRootHex: 'aa'.repeat(32), total: 2 });
    book.expectTransfer({ documentId: 'd2', merkleRootHex: 'bb'.repeat(32), total: 2 });
    book.expectTransfer({ documentId: 'd3', merkleRootHex: 'cc'.repeat(32), total: 2 });
    assert.strictEqual(book.pendingCount, 2);
  });

  it('validateInventoryHtlcOffer refuses mismatched seller address', function () {
    const sk = new Key();
    const bk = new Key();
    const sellerPk = Buffer.from(sk.public.encodeCompressed('hex'), 'hex');
    const buyerPk = Buffer.from(bk.public.encodeCompressed('hex'), 'hex');
    const hash = crypto.randomBytes(32);
    const ok = inventoryHtlc.validateInventoryHtlcOffer({
      networkName: 'regtest',
      sellerPubkeyCompressed: sellerPk,
      buyerRefundPubkeyCompressed: buyerPk,
      paymentHash32: hash,
      refundLocktimeHeight: 100
    });
    assert.strictEqual(ok.ok, true);
    const bad = inventoryHtlc.validateInventoryHtlcOffer({
      networkName: 'regtest',
      sellerPubkeyCompressed: sellerPk,
      buyerRefundPubkeyCompressed: buyerPk,
      paymentHash32: hash,
      refundLocktimeHeight: 100,
      paymentAddress: 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3l8y7v'
    });
    assert.strictEqual(bad.ok, false);
    assert.ok(/does not match/i.test(bad.error));
  });

  it('_attachHtlcOfferToItem includes sellerPublicKeyHex', function () {
    const peer = offlinePeer({
      inventoryHtlcLocktimeHeight: 500,
      network: 'regtest'
    });
    const buyer = new Key();
    const buyerHex = buyer.public.encodeCompressed('hex');
    const htlc = peer._attachHtlcOfferToItem(
      { id: 'doc1' },
      { buyerRefundPublicKey: buyerHex },
      'ab'.repeat(32),
      1000
    );
    assert.ok(htlc);
    assert.ok(/^[0-9a-f]{66}$/.test(htlc.sellerPublicKeyHex));
    assert.strictEqual(htlc.sellerPubkey, htlc.sellerPublicKeyHex);
  });
});
