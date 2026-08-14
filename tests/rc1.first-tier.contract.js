'use strict';

/**
 * @fileoverview RC1 first-tier contract — the four production-readiness "green" domains.
 *
 * These invariants are what a score of 100 means for a shared hostile mesh:
 * wire integrity, gossip/peering bounds, peer scoring/bans, identity/wallets.
 * Existing suites cover most of this; this file locks the remaining edges.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const { describe, it } = require('mocha');

const Hash256 = require('../types/hash256');
const Identity = require('../types/identity');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const Wallet = require('../types/wallet');
const {
  FABRIC_COIN_TYPE_MAINNET,
  FABRIC_COIN_TYPE_TESTNET,
  FIXTURE_SEED,
  HEADER_SIZE,
  PEER_BAN_TTL_MS,
  bitcoinReceiveDerivationPath,
  fabricCoinTypeForNetwork,
  fabricIdentityDerivationPath
} = require('../constants');
const { fabricIdentityIdFromPubkeyHex } = require('../functions/fabricIdentitySchnorr');
const { snapshotEnvironment } = require('../functions/fabricSetup');
const { offlinePeerSettings } = require('./helpers/peer');
const { withIsolatedHome } = require('./helpers/isolatedHome');
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
