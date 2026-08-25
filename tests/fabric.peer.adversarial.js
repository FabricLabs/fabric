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
  CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
  FABRIC_COIN_TYPE_MAINNET,
  FABRIC_COIN_TYPE_TESTNET,
  FIXTURE_SEED,
  bitcoinReceiveDerivationPath,
  fabricCoinTypeForNetwork,
  fabricIdentityAccountPath,
  fabricIdentityDerivationPath,
  resolveFabricIdentityCoinType
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

    // Dial refused before createConnection
    const scoreAfterBan = peer._state.peers['ban-peer'].score;
    peer._outboundDialTargets = new Set();
    const warnings = [];
    peer.on('warning', (msg) => warnings.push(String(msg)));
    peer._connect(origin);
    assert.ok(warnings.some((m) => /Refusing dial to banned peer/.test(m)));
    assert.strictEqual(peer._outboundDialTargets.size, 0);

    // Inbound valid frame from banned origin is dropped (no cache / no score change)
    const ping = Message.fromVector(['P2P_PING', JSON.stringify({ ok: 1 })]).signWithKey(peer.key);
    const good = ping.toBuffer();
    const hash = crypto.createHash('sha256').update(good).digest('hex');
    let inboundDestroyed = 0;
    peer.connections[origin] = {
      destroy () { inboundDestroyed++; }
    };
    peer._handleFabricMessage(good, { name: origin }, null);
    assert.ok(warnings.some((m) => /Dropping message from banned peer/.test(m)));
    assert.strictEqual(inboundDestroyed, 1);
    assert.strictEqual(peer._state.peers['ban-peer'].score, scoreAfterBan);
    assert.strictEqual(peer.messages[hash], undefined);
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

  it('P2P_RELAY is relay-as-is (foreign AMP author does not pin-ban forwarder)', function () {
    const peer = offlinePeer();
    const attacker = new Key();
    const forwarder = new Key();
    const a = '127.0.0.1:9160';
    peer.connections[a] = wireConn([]);
    peer.peers[a] = { publicKey: forwarder.pubkey };
    peer._addressToId[a] = 'fwd';
    peer._state.peers = {
      fwd: { id: 'fwd', address: a, score: 200, publicKey: forwarder.pubkey }
    };

    const inner = Message.fromVector(['P2P_PING', JSON.stringify({ t: 1 })]).signWithKey(attacker);
    const relay = Message.fromVector(['P2P_RELAY', inner.toBuffer()]).signWithKey(attacker);
    peer._handleFabricMessage(relay.toBuffer(), { name: a }, null);

    assert.strictEqual(peer._isPeerBanned(a), false);
    assert.ok(peer.connections[a]);
    assert.strictEqual(peer._state.peers.fwd.score, 200);
  });

  it('nested P2P_RELAY nest-cap soft-punishes when outer signer ≠ TCP pin', function () {
    const peer = offlinePeer({
      peerScore: { maxRelayNestDepth: 1, banTtlMs: 60000 }
    });
    const attacker = new Key();
    const forwarder = new Key();
    const a = '127.0.0.1:9170';
    let destroyed = false;
    peer.connections[a] = {
      _writeFabric () {},
      destroy () { destroyed = true; }
    };
    peer._addressToId[a] = 'fwd-soft-nest';
    peer._state.peers = {
      'fwd-soft-nest': {
        id: 'fwd-soft-nest',
        address: a,
        score: 220,
        publicKey: forwarder.pubkey
      }
    };
    peer.peers[a] = { publicKey: forwarder.pubkey };

    const leaf = Message.fromVector(['P2P_PING', JSON.stringify({ nest: true })]).signWithKey(attacker);
    const mid = Message.fromVector(['P2P_RELAY', leaf.toBuffer()]).signWithKey(attacker);
    const outer = Message.fromVector(['P2P_RELAY', mid.toBuffer()]).signWithKey(attacker);
    peer._handleFabricMessage(outer.toBuffer(), { name: a }, null);

    assert.strictEqual(destroyed, false, 'foreign-author nest exceed must not cut forwarder');
    assert.strictEqual(peer._isPeerBanned(a), false);
    assert.strictEqual(peer._state.peers['fwd-soft-nest'].score, 220);
  });

  it('P2P_RELAY session offer does not rebind forwarder identity (relayedAsIs)', function () {
    const peer = offlinePeer();
    const attacker = new Key();
    const forwarder = new Key();
    const a = '127.0.0.1:9180';
    const writes = [];
    peer.connections[a] = wireConn(writes);
    peer._addressToId[a] = 'fwd-session';
    peer._state.peers = {
      'fwd-session': {
        id: 'fwd-session',
        address: a,
        score: 210,
        publicKey: forwarder.pubkey
      }
    };
    peer.peers[a] = { publicKey: forwarder.pubkey };

    const attackerId = 'attacker-via-relay';
    const proof = peer._sessionKeyProofMessage(attackerId, attacker.pubkey, attacker.pubkey);
    const offer = Message.fromVector(['P2P_SESSION_OFFER', JSON.stringify({
      type: 'P2P_SESSION_OFFER',
      actor: {
        id: attackerId,
        pubkey: attacker.pubkey,
        parentPubkey: attacker.pubkey,
        parentSignature: attacker.signSchnorr(proof).toString('hex')
      },
      object: { challenge: 'relay-rebind' }
    })]).signWithKey(attacker);
    const relay = Message.fromVector(['P2P_RELAY', offer.toBuffer()]).signWithKey(attacker);

    peer._handleFabricMessage(relay.toBuffer(), { name: a }, null);

    assert.strictEqual(peer._addressToId[a], 'fwd-session');
    assert.strictEqual(peer.peers[a].publicKey, forwarder.pubkey);
    assert.strictEqual(peer._state.peers['fwd-session'].score, 210);
    assert.ok(!writes.some((buf) => {
      try { return Message.fromBuffer(buf).type === 'P2P_SESSION_OPEN'; } catch (_) { return false; }
    }));
  });

  it('expired temp ban is purged and dial is refused while active', function () {
    const peer = offlinePeer({ peerScore: { banTtlMs: 60_000 } });
    const origin = '127.0.0.1:9190';
    peer._addressToId[origin] = 'ban-expire';
    peer._state.peers = {
      'ban-expire': {
        id: 'ban-expire',
        address: origin,
        score: 50,
        publicKey: 'ef'.repeat(32)
      }
    };

    peer._banPeer(origin, 'test-ban');
    assert.strictEqual(peer._isPeerBanned(origin), true);
    assert.strictEqual(peer._isPeerBanned(null, 'ef'.repeat(32)), true);

    const warnings = [];
    peer.on('warning', (w) => warnings.push(String(w)));
    peer._connect(origin);
    assert.ok(warnings.some((w) => /Refusing dial to banned peer/i.test(w)));
    assert.ok(!peer.connections[origin] || peer.connections[origin].destroyed);

    peer._peerBans.set(`addr:${origin}`, { until: Date.now() - 1, reason: 'expired' });
    peer._peerBans.set(`pk:${'ef'.repeat(32)}`, { until: Date.now() - 1, reason: 'expired' });
    assert.strictEqual(peer._isPeerBanned(origin), false);
    assert.strictEqual(peer._peerBans.has(`addr:${origin}`), false);
  });

  it('drops frames over custom maxMessageSize before verify', function () {
    const peer = offlinePeer({ maxMessageSize: 100 });
    const origin = '127.0.0.1:9200';
    peer._addressToId[origin] = 'size-peer';
    peer._state.peers = {
      'size-peer': { id: 'size-peer', address: origin, score: 90, publicKey: '11'.repeat(32) }
    };
    const huge = Buffer.alloc(HEADER_SIZE + 101, 0xcd);
    peer._handleFabricMessage(huge, { name: origin }, null);
    assert.strictEqual(peer._state.peers['size-peer'].score, 90);
    assert.strictEqual(peer._isPeerBanned(origin), false);

    const ok = Message.fromVector(['P2P_PING', JSON.stringify({ tiny: 1 })]).signWithKey(peer.key);
    assert.ok(ok.toBuffer().length <= HEADER_SIZE + 100);
  });

  it('chat relay budget resets after window rollover', function () {
    const peer = offlinePeer({ chat: { maxRelaysPerOriginPerMinute: 1 } });
    const k = new Key();
    const a = '127.0.0.1:9210';
    const bWrites = [];
    peer.connections[a] = wireConn([]);
    peer.connections['127.0.0.1:9211'] = wireConn(bWrites);
    peer.peers[a] = { publicKey: k.pubkey };

    const first = Message.fromVector(['P2P_CHAT_MESSAGE', `a-${Date.now()}`]).signWithKey(k);
    peer._handleFabricMessage(first.toBuffer(), { name: a }, null);
    assert.strictEqual(bWrites.length, 1);

    const blocked = Message.fromVector(['P2P_CHAT_MESSAGE', `b-${Date.now()}`]).signWithKey(k);
    peer._handleFabricMessage(blocked.toBuffer(), { name: a }, null);
    assert.strictEqual(bWrites.length, 1);

    const slot = peer._chatRelayByOrigin.get(a);
    slot.windowStart = Date.now() - 61_000;
    peer._chatRelayByOrigin.set(a, slot);

    const resumed = Message.fromVector(['P2P_CHAT_MESSAGE', `c-${Date.now()}`]).signWithKey(k);
    peer._handleFabricMessage(resumed.toBuffer(), { name: a }, null);
    assert.strictEqual(bWrites.length, 2);
  });

  it('caps private document relay routes by oldest created', function () {
    const peer = offlinePeer({ maxDocumentRelayRoutes: 2 });
    peer._documentRelayRoutes = {
      r1: { created: 1, via: 'a' },
      r2: { created: 2, via: 'b' },
      r3: { created: 3, via: 'c' }
    };
    peer._capDocumentRelayRoutes();
    assert.strictEqual(Object.keys(peer._documentRelayRoutes).length, 2);
    assert.ok(!peer._documentRelayRoutes.r1);
    assert.ok(peer._documentRelayRoutes.r2);
    assert.ok(peer._documentRelayRoutes.r3);
  });

  it('pubkeysMatchXOnly binds inventory AMP signer to seller key', function () {
    const seller = new Key();
    const other = new Key();
    const sellerHex = seller.public.encodeCompressed('hex');
    assert.strictEqual(inventoryHtlc.pubkeysMatchXOnly(sellerHex, seller.pubkey), true);
    assert.strictEqual(inventoryHtlc.pubkeysMatchXOnly(sellerHex, other.pubkey), false);
    assert.strictEqual(
      inventoryHtlc.pubkeysMatchXOnly(seller.public.encodeCompressed('hex').slice(2), sellerHex),
      true,
      'x-only form matches compressed seller'
    );
  });
});

// RC1 first-tier contract — the four production-readiness "green" domains.
// These invariants are what a score of 100 means for a shared hostile mesh:
// wire integrity, gossip/peering bounds, peer scoring/bans, identity/wallets.
// Existing suites cover most of this; this file locks the remaining edges.

const fs = require('fs');
const os = require('os');
const path = require('path');

const Hash256 = require('../types/hash256');
const Identity = require('../types/identity');
const Wallet = require('../types/wallet');
const { fabricIdentityIdFromPubkeyHex } = require('../functions/fabricIdentitySchnorr');
const { snapshotEnvironment } = require('../functions/fabricSetup');
const { offlinePeerSettings } = require('./helpers/peer');

const IDENTITY_ENV_KEYS = [
  'NODE_ENV',
  'FABRIC_SEED',
  'FABRIC_MNEMONIC',
  'FABRIC_XPRV',
  'FABRIC_XPUB',
  'FABRIC_PASSWORD',
  'FABRIC_HUB_ADMIN_TOKEN',
  'FABRIC_HUB_ADMIN_TOKEN_FILE'
];

function withIsolatedHome (prefix = 'fabric-env-') {
  const prev = {};
  for (const key of IDENTITY_ENV_KEYS) prev[key] = process.env[key];
  prev.HOME = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = path.join(home, '.fabric');
  const walletPath = path.join(store, 'wallet.json');
  process.env.HOME = home;
  return {
    home,
    store,
    walletPath,
    clearIdentityEnv () {
      delete process.env.FABRIC_SEED;
      delete process.env.FABRIC_MNEMONIC;
      delete process.env.FABRIC_XPRV;
      delete process.env.FABRIC_XPUB;
      delete process.env.FABRIC_PASSWORD;
      delete process.env.FABRIC_HUB_ADMIN_TOKEN;
      delete process.env.FABRIC_HUB_ADMIN_TOKEN_FILE;
    },
    leftoverWalletTemporaryFiles () {
      try {
        const base = path.basename(walletPath);
        return fs.readdirSync(store).filter((name) => {
          return name.startsWith(base + '.') && name.endsWith('.tmp');
        });
      } catch (error) {
        if (error && error.code === 'ENOENT') return [];
        throw error;
      }
    },
    restore () {
      for (const key of IDENTITY_ENV_KEYS) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
      if (prev.HOME === undefined) delete process.env.HOME;
      else process.env.HOME = prev.HOME;
      fs.rmSync(home, { recursive: true, force: true });
    }
  };
}
const Environment = require('../types/environment');

const SAMPLE_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('@fabric/core RC1 first-tier contract', function () {
  function offlinePeer (overrides = {}) {
    return new Peer(offlinePeerSettings(overrides));
  }

  function wireConn (writes) {
    return {
      _writeFabric (buf) { writes.push(Buffer.from(buf)); },
      destroy () { this.destroyed = true; },
      destroyed: false
    };
  }

  function seedScore (peer, originName, peerId, score, pubkeyHex) {
    peer._addressToId[originName] = peerId;
    peer._state.peers = peer._state.peers || {};
    peer._state.peers[peerId] = {
      id: peerId,
      address: originName,
      score,
      publicKey: pubkeyHex || 'ab'.repeat(32)
    };
    let destroyed = false;
    peer.connections[originName] = {
      destroy () { destroyed = true; },
      get destroyed () { return destroyed; }
    };
    return () => destroyed;
  }

  function signPing (key, nonce) {
    return Message.fromVector(['P2P_PING', JSON.stringify({ t: nonce })]).signWithKey(key);
  }

  describe('wire integrity (body hash + BIP-340)', function () {
    it('drops undersize frames before parse (no score, ban, or wire-hash cache)', function () {
      const peer = offlinePeer();
      const origin = '127.0.0.1:rc1-short';
      const wasDestroyed = seedScore(peer, origin, 'peer-short', 180);
      const warnings = [];
      peer.on('warning', (w) => warnings.push(String(w)));

      for (const len of [0, 1, HEADER_SIZE - 1]) {
        const buf = Buffer.alloc(len, 0x11);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        peer._handleFabricMessage(buf, { name: origin }, null);
        assert.strictEqual(peer.messages[hash], undefined, `undersize ${len} must not fill cache`);
      }

      assert.strictEqual(peer._state.peers['peer-short'].score, 180);
      assert.strictEqual(wasDestroyed(), false);
      assert.strictEqual(peer._isPeerBanned(origin), false);
      assert.ok(warnings.some((w) => /undersize frame/i.test(w)));
    });

    it('drops unparseable non-buffer input without punishing the origin', function () {
      const peer = offlinePeer();
      const origin = '127.0.0.1:rc1-unparsed';
      const wasDestroyed = seedScore(peer, origin, 'peer-unparsed', 160);
      peer._handleFabricMessage({ not: 'a-buffer' }, { name: origin }, null);
      assert.strictEqual(peer._state.peers['peer-unparsed'].score, 160);
      assert.strictEqual(wasDestroyed(), false);
      assert.strictEqual(peer._isPeerBanned(origin), false);
    });

    it('header author mutation fails BIP-340 and does not fill the wire-hash cache', function () {
      const peer = offlinePeer();
      const origin = '127.0.0.1:rc1-author';
      const wasDestroyed = seedScore(peer, origin, 'peer-author', 200);
      const key = new Key();
      const buf = Buffer.from(signPing(key, 'author-flip').toBuffer());
      buf[40] ^= 0xff;
      const hash = crypto.createHash('sha256').update(buf).digest('hex');

      peer._handleFabricMessage(buf, { name: origin }, null);
      assert.strictEqual(peer.messages[hash], undefined);
      assert.ok(peer._state.peers['peer-author'].score < 200);
      assert.strictEqual(wasDestroyed(), true);
    });

    it('verified frames FIFO-evict so an older wire hash can be claimed again', function () {
      const peer = offlinePeer({
        gossip: { maxWireHashCache: 2 }
      });
      const origin = '127.0.0.1:rc1-fifo';
      const key = new Key();
      peer.connections[origin] = wireConn([]);
      peer.peers[origin] = { publicKey: key.pubkey };

      const frames = [1, 2, 3].map((n) => signPing(key, `fifo-${n}`).toBuffer());
      const hashes = frames.map((buf) => crypto.createHash('sha256').update(buf).digest('hex'));

      for (const buf of frames) {
        peer._handleFabricMessage(buf, { name: origin }, null);
      }

      assert.strictEqual(peer.messages[hashes[0]], undefined, 'oldest verified hash must evict');
      assert.strictEqual(peer.messages[hashes[1]], true);
      assert.strictEqual(peer.messages[hashes[2]], true);

      peer._handleFabricMessage(frames[0], { name: origin }, null);
      assert.strictEqual(peer.messages[hashes[0]], true, 'evicted hash must be claimable again');
    });

    it('public AMP hash is double-SHA256(body) and preimage stays zero', function () {
      const key = new Key();
      const msg = signPing(key, 'preimage-zero');
      const buf = msg.toBuffer();
      const body = buf.subarray(HEADER_SIZE);
      const hashOnWire = buf.subarray(80, 112).toString('hex');
      const preimage = buf.subarray(112, 144);
      assert.strictEqual(Hash256.doubleDigest(body), hashOnWire);
      assert.ok(preimage.equals(Buffer.alloc(32)));
      assert.ok(msg.verifyWithKey(key));
    });
  });

  describe('gossip / peering DoS bounds', function () {
    it('hop=0 gossip does not poison the payload cache for a later valid hop', function () {
      const peer = offlinePeer({
        gossip: { maxRelaysPerOriginPerMinute: 8 }
      });
      const origin = '127.0.0.1:rc1-g0';
      const sink = '127.0.0.1:rc1-g1';
      const sinkWrites = [];
      const author = new Key();
      peer.connections[origin] = wireConn([]);
      peer.connections[sink] = wireConn(sinkWrites);
      peer.peers[origin] = { publicKey: author.pubkey };

      const body = { host: '198.51.100.77', port: 7777, tag: 'hop0-then-5' };
      const dead = Message.fromVector(
        ['P2P_PEER_GOSSIP', JSON.stringify(Object.assign({}, body, { gossipHop: 0 }))]
      ).signWithKey(author);
      peer._handleFabricMessage(dead.toBuffer(), { name: origin }, null);
      assert.strictEqual(sinkWrites.length, 0);

      const live = Message.fromVector(
        ['P2P_PEER_GOSSIP', JSON.stringify(Object.assign({}, body, { gossipHop: 5 }))]
      ).signWithKey(author);
      peer._handleFabricMessage(live.toBuffer(), { name: origin }, null);
      assert.strictEqual(sinkWrites.length, 1, 'valid hop after hop=0 must still relay');
    });

    it('hop=0 peering offer does not poison the payload cache for a later valid hop', function () {
      const peer = offlinePeer({
        constraints: { peers: { max: 32 } },
        peering: { maxRelaysPerOriginPerMinute: 8, maxCandidates: 8 }
      });
      const origin = '127.0.0.1:rc1-p0';
      const sink = '127.0.0.1:rc1-p1';
      const sinkWrites = [];
      const author = new Key();
      peer.connections[origin] = wireConn([]);
      peer.connections[sink] = wireConn(sinkWrites);
      peer.peers[origin] = { publicKey: author.pubkey };

      const body = { transport: 'fabric', host: '203.0.113.77', port: 7777, tag: 'phop0-then-5' };
      const dead = Message.fromVector(
        ['P2P_PEERING_OFFER', JSON.stringify(Object.assign({}, body, { peeringHop: 0 }))]
      ).signWithKey(author);
      peer._handleFabricMessage(dead.toBuffer(), { name: origin }, null);
      assert.strictEqual(sinkWrites.length, 0);
      assert.strictEqual(peer.candidates.length, 0);

      const live = Message.fromVector(
        ['P2P_PEERING_OFFER', JSON.stringify(Object.assign({}, body, { peeringHop: 5 }))]
      ).signWithKey(author);
      peer._handleFabricMessage(live.toBuffer(), { name: origin }, null);
      assert.strictEqual(sinkWrites.length, 1, 'valid hop after peeringHop=0 must still relay');
      assert.ok(peer.candidates.some((c) => c.host === '203.0.113.77' && Number(c.port) === 7777));
    });

    it('P2P_BASE_MESSAGE cannot inject P2P_PEER_GOSSIP mesh relay', function () {
      const peer = offlinePeer({
        gossip: { maxRelaysPerOriginPerMinute: 8 }
      });
      const origin = '127.0.0.1:rc1-base-g';
      const sink = '127.0.0.1:rc1-base-s';
      const sinkWrites = [];
      const author = new Key();
      peer.connections[origin] = wireConn([]);
      peer.connections[sink] = wireConn(sinkWrites);
      peer.peers[origin] = { publicKey: author.pubkey };
      let seen = 0;
      peer.on('peeringGossip', () => { seen++; });

      const wire = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
        type: 'P2P_PEER_GOSSIP',
        object: { host: '203.0.113.8', port: 7777, gossipHop: 5 }
      })]).signWithKey(author);
      peer._handleFabricMessage(wire.toBuffer(), { name: origin }, null);

      assert.strictEqual(seen, 0);
      assert.strictEqual(sinkWrites.length, 0);
      assert.strictEqual(peer._gossipRelayByOrigin.has(origin), false);
    });

    it('P2P_BASE_MESSAGE cannot inject chat, alias, or announce side effects', function () {
      const peer = offlinePeer({
        constraints: { peers: { max: 32 } },
        peering: { maxCandidates: 8 },
        chat: { maxRelaysPerOriginPerMinute: 8 }
      });
      const origin = '127.0.0.1:rc1-base-x';
      const sink = '127.0.0.1:rc1-base-y';
      const sinkWrites = [];
      const author = new Key();
      peer.connections[origin] = wireConn([]);
      peer.connections[sink] = wireConn(sinkWrites);
      peer.peers[origin] = { publicKey: author.pubkey };
      peer.connections[origin]._alias = 'honest';
      let chats = 0;
      let announces = 0;
      peer.on('chat', () => { chats++; });
      peer.on('peerAnnounce', () => { announces++; });

      const smuggles = [
        { type: 'P2P_CHAT_MESSAGE', object: { content: 'injected' } },
        { type: 'P2P_PEER_ALIAS', object: { alias: 'evil' } },
        { type: 'P2P_PEER_ANNOUNCE', object: { host: '203.0.113.50', port: 7777 } }
      ];
      for (const body of smuggles) {
        const wire = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(body)]).signWithKey(author);
        peer._handleFabricMessage(wire.toBuffer(), { name: origin }, null);
      }

      assert.strictEqual(chats, 0);
      assert.strictEqual(announces, 0);
      assert.strictEqual(peer.connections[origin]._alias, 'honest');
      assert.strictEqual(peer.candidates.length, 0);
      assert.ok(!peer._candidateKeys || !peer._candidateKeys.has('203.0.113.50:7777'));
      assert.strictEqual(sinkWrites.length, 0);
    });

    it('gossip relay budget is keyed by TCP origin, not advertised body pubkey', function () {
      const peer = offlinePeer({
        gossip: { maxRelaysPerOriginPerMinute: 1 }
      });
      const originA = '127.0.0.1:rc1-ba';
      const originB = '127.0.0.1:rc1-bb';
      const sink = '127.0.0.1:rc1-bs';
      const sinkWrites = [];
      const a = new Key();
      const b = new Key();
      peer.connections[originA] = wireConn([]);
      peer.connections[originB] = wireConn([]);
      peer.connections[sink] = wireConn(sinkWrites);
      peer.peers[originA] = { publicKey: a.pubkey };
      peer.peers[originB] = { publicKey: b.pubkey };

      const bodyForB = { host: '198.51.100.9', port: 1, gossipHop: 5, pubkey: b.pubkey, tag: 'steal-b' };
      peer._handleFabricMessage(
        Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(bodyForB)]).signWithKey(a).toBuffer(),
        { name: originA },
        null
      );
      peer._handleFabricMessage(
        Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify({
          host: '198.51.100.10',
          port: 2,
          gossipHop: 5,
          pubkey: b.pubkey,
          tag: 'steal-b-2'
        })]).signWithKey(a).toBuffer(),
        { name: originA },
        null
      );
      assert.strictEqual(sinkWrites.length, 1, 'origin A is budget-capped at 1');

      peer._handleFabricMessage(
        Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify({
          host: '198.51.100.11',
          port: 3,
          gossipHop: 5,
          tag: 'honest-b'
        })]).signWithKey(b).toBuffer(),
        { name: originB },
        null
      );
      assert.strictEqual(sinkWrites.length, 2, 'origin B keeps an independent budget');
    });
  });

  describe('peer scoring / bans', function () {
    it('hard offense at score 0 still disconnects and bans', function () {
      const peer = offlinePeer({ peerScore: { banTtlMs: PEER_BAN_TTL_MS } });
      const origin = '127.0.0.1:rc1-floor';
      const wasDestroyed = seedScore(peer, origin, 'peer-floor', 0);
      const msg = signPing(peer.key, 'floor');
      const buf = Buffer.from(msg.toBuffer());
      if (buf.length > HEADER_SIZE) buf[HEADER_SIZE] ^= 0xff;

      peer._handleFabricMessage(buf, { name: origin }, null);
      assert.strictEqual(peer._state.peers['peer-floor'].score, 0);
      assert.strictEqual(wasDestroyed(), true);
      assert.strictEqual(peer._isPeerBanned(origin), true);
    });

    it('banOnHardMisbehavior=false disconnects without installing a ban', function () {
      const peer = offlinePeer({
        peerScore: { banOnHardMisbehavior: false, banTtlMs: 60_000 }
      });
      const origin = '127.0.0.1:rc1-noban';
      const wasDestroyed = seedScore(peer, origin, 'peer-noban', 90);
      const buf = Buffer.from(signPing(peer.key, 'noban').toBuffer());
      if (buf.length > HEADER_SIZE) buf[HEADER_SIZE] ^= 0xff;

      peer._handleFabricMessage(buf, { name: origin }, null);
      assert.strictEqual(peer._state.peers['peer-noban'].score, 0, 'score floors at 0');
      assert.strictEqual(wasDestroyed(), true);
      assert.strictEqual(peer._isPeerBanned(origin), false);
    });

    it('banned origin: a later valid frame is dropped (no score change, no cache fill)', function () {
      const peer = offlinePeer({ peerScore: { banTtlMs: 60_000 } });
      const origin = '127.0.0.1:rc1-banned';
      seedScore(peer, origin, 'peer-banned', 120);
      const bad = Buffer.from(signPing(peer.key, 'ban-me').toBuffer());
      if (bad.length > HEADER_SIZE) bad[HEADER_SIZE] ^= 0xff;
      peer._handleFabricMessage(bad, { name: origin }, null);
      assert.strictEqual(peer._isPeerBanned(origin), true);
      const scoreAfterBan = peer._state.peers['peer-banned'].score;

      const good = signPing(peer.key, 'after-ban').toBuffer();
      const hash = crypto.createHash('sha256').update(good).digest('hex');
      peer.connections[origin] = {
        destroy () {},
        destroyed: false
      };
      peer._handleFabricMessage(good, { name: origin }, null);
      assert.strictEqual(peer._state.peers['peer-banned'].score, scoreAfterBan);
      assert.strictEqual(peer.messages[hash], undefined);
    });

    it('exact verified replay is silent (no second score change)', function () {
      const peer = offlinePeer();
      const origin = '127.0.0.1:rc1-replay';
      const key = new Key();
      seedScore(peer, origin, 'peer-replay', 70, key.pubkey);
      peer.peers[origin] = { publicKey: key.pubkey };
      peer.connections[origin] = wireConn([]);
      const wire = signPing(key, 'replay-once').toBuffer();

      peer._handleFabricMessage(wire, { name: origin }, null);
      const score = peer._state.peers['peer-replay'].score;
      peer._handleFabricMessage(wire, { name: origin }, null);
      assert.strictEqual(peer._state.peers['peer-replay'].score, score);
    });
  });

  describe('identity / Key / wallets', function () {
    it('unknown network names stay on coin type 7778 (never fail-open to 7777)', function () {
      assert.strictEqual(fabricCoinTypeForNetwork('mainnet'), FABRIC_COIN_TYPE_MAINNET);
      assert.strictEqual(fabricCoinTypeForNetwork('bitcoin'), FABRIC_COIN_TYPE_MAINNET);
      assert.strictEqual(fabricCoinTypeForNetwork('livenet'), FABRIC_COIN_TYPE_MAINNET);
      assert.strictEqual(fabricCoinTypeForNetwork('main'), FABRIC_COIN_TYPE_MAINNET);
      assert.strictEqual(fabricCoinTypeForNetwork('signet'), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricCoinTypeForNetwork('not-a-network'), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricCoinTypeForNetwork(''), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricCoinTypeForNetwork(null), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricIdentityDerivationPath(0, 0, 7777), "m/44'/7777'/0'/0/0");
      assert.strictEqual(fabricIdentityAccountPath(0, 'not-a-network'), "m/44'/7778'/0'");
      assert.strictEqual(fabricIdentityAccountPath(0, 'mainnet'), "m/44'/7777'/0'");
      assert.strictEqual(resolveFabricIdentityCoinType('not-a-network'), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(resolveFabricIdentityCoinType(7777), FABRIC_COIN_TYPE_MAINNET);
    });

    it('Bitcoin fund paths stay on coin type 0 and never equal the Fabric identity key', function () {
      const identity = new Identity({ seed: SAMPLE_SEED, network: 'mainnet' });
      const fundPath = bitcoinReceiveDerivationPath(0, 0);
      const fund = identity.master.derive(fundPath);
      assert.match(fundPath, /^m\/44'\/0'\//);
      assert.notEqual(fund.pubkey, identity.pubkey);
      assert.strictEqual(identity.derivation, "m/44'/7777'/0'/0/0");
      assert.notEqual(identity.pubkey, identity.master.pubkey);
    });

    it('fabricIdentityIdFromPubkeyHex requires compressed 66-hex (rejects x-only)', function () {
      const identity = new Identity({ seed: SAMPLE_SEED });
      const compressed = identity.pubkey;
      assert.match(compressed, /^0[23][0-9a-f]{64}$/i);
      const id = fabricIdentityIdFromPubkeyHex(compressed);
      assert.match(id, /^id1/);
      assert.throws(
        () => fabricIdentityIdFromPubkeyHex(compressed.slice(2)),
        /66 hex/i
      );
    });

    it('sealed wallet.json public object and setup snapshot omit seed/xprv', function () {
      const iso = withIsolatedHome('fabric-rc1-wallet-');
      iso.clearIdentityEnv();
      process.env.NODE_ENV = 'test';
      try {
        const environment = new Environment({
          home: iso.home,
          path: iso.walletPath,
          store: iso.store,
          lockTimeoutMinutes: 0
        });
        environment.start();
        environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, {
          password: 'test-pass-ok!',
          encrypt: true
        });
        const doc = JSON.parse(fs.readFileSync(iso.walletPath, 'utf8'));
        assert.strictEqual(doc.passwordProtected, true);
        assert.ok(doc.object);
        assert.strictEqual(doc.object.seed, undefined);
        assert.strictEqual(doc.object.xprv, undefined);
        assert.ok(doc.seal && doc.seal.ciphertext);

        const snap = snapshotEnvironment(environment);
        const blob = JSON.stringify(snap);
        assert.ok(!/xprv[A-Za-z0-9]{20,}/i.test(blob), 'snapshot must not contain an xprv payload');
        assert.ok(!blob.includes(FIXTURE_SEED));
        assert.ok(!blob.includes(SAMPLE_SEED));
      } finally {
        iso.restore();
      }
    });
  });
});

// Coverage locks from FabricLabs/fabric PR review comments.
// Sources: PR #185 (open) and closed PR #183. Heavy-lift product work
// (unique Service commit ids, Blessed TUI markup) stays deferred in
// docs/OUTSTANDING.md.

const { EventEmitter } = require('events');


describe('@fabric/core RC1 PR-review coverage', function () {
  function offlinePeer (overrides = {}) {
    return new Peer(offlinePeerSettings(overrides));
  }

  function wireConn (writes) {
    return {
      _writeFabric (buf) { writes.push(Buffer.from(buf)); },
      destroy () { this.destroyed = true; },
      destroyed: false
    };
  }

  function seedScore (peer, originName, peerId, score, pubkeyHex) {
    peer._addressToId[originName] = peerId;
    peer._state.peers = peer._state.peers || {};
    peer._state.peers[peerId] = {
      id: peerId,
      address: originName,
      score,
      publicKey: pubkeyHex || 'ab'.repeat(32)
    };
    let destroyed = false;
    peer.connections[originName] = {
      destroy () { destroyed = true; },
      get destroyed () { return destroyed; }
    };
    return () => destroyed;
  }

  it('isolatePeerContent treats null and array state as empty maps', function () {
    const fromNull = new Peer(offlinePeerSettings({ state: null }));
    const fromArray = new Peer(offlinePeerSettings({ state: [] }));
    assert.deepStrictEqual(fromNull._state.content.documents, {});
    assert.deepStrictEqual(fromArray._state.content.messages, {});
    assert.deepStrictEqual(fromNull._state.content.collections, { documents: {} });
  });

  it('isolatePeerContent copies collections.documents without aliasing', function () {
    const original = {
      documents: { doc1: { id: 'doc1', meta: { tags: ['x'] } } },
      collections: {
        documents: {
          doc1: { id: 'doc1', published: true, purchasePriceSats: 25, meta: { tags: ['a'] } }
        }
      }
    };
    const peer = new Peer(offlinePeerSettings({ state: original }));
    const row = peer._state.content.collections.documents.doc1;
    assert.strictEqual(row.purchasePriceSats, 25);
    row.purchasePriceSats = 99;
    assert.strictEqual(original.collections.documents.doc1.purchasePriceSats, 25);
    original.collections.documents.doc1.published = false;
    original.collections.documents.doc1.meta.tags.push('b');
    original.documents.doc1.meta.tags.push('y');
    assert.strictEqual(peer._state.content.collections.documents.doc1.published, true);
    assert.deepStrictEqual(peer._state.content.collections.documents.doc1.meta.tags, ['a']);
    assert.deepStrictEqual(peer._state.content.documents.doc1.meta.tags, ['x']);
  });

  it('beat emits a clock-only snapshot (no full state tree)', function () {
    const peer = offlinePeer();
    let beat = null;
    peer.on('beat', (ev) => { beat = ev; });
    peer.beat();
    assert.ok(beat);
    assert.strictEqual(typeof beat.clock, 'number');
    assert.deepStrictEqual(beat.state, { clock: beat.clock });
    assert.ok(!beat.state.collections);
    assert.ok(!beat.state.documents);
  });

  it('AMP P2P_PEERING_OFFER with JSON type 98 still enqueues a candidate', function () {
    const peer = offlinePeer({
      constraints: { peers: { max: 32 } },
      peering: { maxCandidates: 8 }
    });
    const origin = '127.0.0.1:pr185-98';
    const author = new Key();
    peer.connections[origin] = wireConn([]);
    peer.peers[origin] = { publicKey: author.pubkey };
    const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify({
      type: 98,
      host: '203.0.113.98',
      port: 7777,
      transport: 'fabric'
    })]).signWithKey(author);
    peer._handleFabricMessage(wire.toBuffer(), { name: origin }, null);
    assert.ok(peer.candidates.some((c) => c.host === '203.0.113.98' && Number(c.port) === 7777));
  });

  it('AMP P2P_INVENTORY_RESPONSE cannot smuggle a peering offer via JSON type 98', function () {
    const peer = offlinePeer({
      constraints: { peers: { max: 32 } },
      peering: { maxCandidates: 8 }
    });
    const origin = '127.0.0.1:pr185-inv';
    const author = new Key();
    peer.connections[origin] = wireConn([]);
    peer.peers[origin] = { publicKey: author.pubkey };
    let inventory = 0;
    peer.on('inventoryResponse', () => { inventory++; });
    const wire = Message.fromVector(['P2P_INVENTORY_RESPONSE', JSON.stringify({
      type: 98,
      host: '203.0.113.99',
      port: 7777,
      transport: 'fabric'
    })]).signWithKey(author);
    peer._handleFabricMessage(wire.toBuffer(), { name: origin }, null);
    assert.strictEqual(peer.candidates.length, 0);
    assert.ok(!peer._candidateKeys || !peer._candidateKeys.has('203.0.113.99:7777'));
    assert.ok(inventory >= 1);
  });

  it('_attachNoiseStreamErrorHandlers is a no-op without both sides, and re-attach detaches first', function () {
    const peer = offlinePeer();
    assert.doesNotThrow(() => peer._attachNoiseStreamErrorHandlers(null));
    assert.doesNotThrow(() => peer._attachNoiseStreamErrorHandlers({ encrypt: {} }));

    function side () {
      const ee = new EventEmitter();
      ee.removeListener = EventEmitter.prototype.removeListener;
      return ee;
    }
    const noise = { encrypt: side(), decrypt: side() };
    peer._attachNoiseStreamErrorHandlers(noise, 'NOISE');
    assert.ok(noise._fabricNoiseErrorHandlers);
    const first = noise._fabricNoiseErrorHandlers;
    peer._attachNoiseStreamErrorHandlers(noise, 'NOISE');
    assert.ok(noise._fabricNoiseErrorHandlers);
    assert.notStrictEqual(noise._fabricNoiseErrorHandlers, first);
    assert.strictEqual(noise.encrypt.listenerCount('error'), 1);
    assert.strictEqual(noise.decrypt.listenerCount('error'), 1);
  });

  it('inbound socket errors warn instead of throwing without an error listener', function () {
    const { PassThrough } = require('stream');
    const peer = offlinePeer();
    const warnings = [];
    peer.on('warning', (msg) => warnings.push(String(msg)));
    const socket = new PassThrough();
    socket.remoteAddress = '192.0.2.8';
    socket.remotePort = 19108;
    socket.destroy = function () { this.destroyed = true; };
    peer._NOISESocketHandler(socket);
    assert.doesNotThrow(() => socket.emit('error', new Error('EPROTO inbound')));
    assert.ok(warnings.some((msg) => /Inbound socket error/.test(msg)));
    if (typeof socket._destroyFabric === 'function') socket._destroyFabric();
    socket.destroy();
  });

  it('unknown AMP opcode decodes as UNKNOWN_MESSAGE without score change', function () {
    const peer = offlinePeer();
    const origin = '127.0.0.1:wave1-unknown';
    const author = new Key();
    peer.connections[origin] = wireConn([]);
    peer.peers[origin] = { publicKey: author.pubkey };
    const wasDestroyed = seedScore(peer, origin, 'peer-wave1-u', 200);
    const wire = Message.fromVector([0x7ffe, Buffer.from('wave1-unknown')]).signWithKey(author);
    peer._handleFabricMessage(wire.toBuffer(), { name: origin }, null);
    assert.strictEqual(peer._state.peers['peer-wave1-u'].score, 200);
    assert.strictEqual(wasDestroyed(), false);
  });

  it('JSON GenericMessage claiming CONTRACT_MESSAGE does not escalate opcode', function () {
    const peer = offlinePeer();
    const origin = '127.0.0.1:wave1-generic';
    const author = new Key();
    peer.connections[origin] = wireConn([]);
    peer.peers[origin] = { publicKey: author.pubkey };
    let contractHits = 0;
    peer.on('contractMessage', () => { contractHits++; });
    peer.on('ContractMessage', () => { contractHits++; });
    const wire = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
      type: 'CONTRACT_MESSAGE',
      contract: 'aa'.repeat(32),
      payload: { hello: true }
    })]).signWithKey(author);
    peer._handleFabricMessage(wire.toBuffer(), { name: origin }, null);
    assert.strictEqual(contractHits, 0);
  });
});
