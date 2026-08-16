'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { individualPk, verifyAggregatedSchnorr } = require('../functions/musig2');
const { offlinePeerSettings } = require('./helpers/peer');

function makePeer (label, extra = {}) {
  const seed = new Key();
  const peer = new Peer(offlinePeerSettings({
    key: { mnemonic: seed.mnemonic },
    debug: false,
    musig2: Object.assign({ autoAccept: true }, extra.musig2 || {})
  }));
  return { peer, label, seed };
}

function wirePair (alice, bob) {
  const aliceAddr = '127.0.0.1:19101';
  const bobAddr = '127.0.0.1:19102';
  const aliceWrites = [];
  const bobWrites = [];
  alice.connections[bobAddr] = {
    _writeFabric (buf) { aliceWrites.push(Buffer.from(buf)); }
  };
  bob.connections[aliceAddr] = {
    _writeFabric (buf) { bobWrites.push(Buffer.from(buf)); }
  };
  alice.peers[bobAddr] = { id: bob.key.pubkey, publicKey: bob.key.pubkey };
  bob.peers[aliceAddr] = { id: alice.key.pubkey, publicKey: alice.key.pubkey };
  return { aliceAddr, bobAddr, aliceWrites, bobWrites };
}

function exchange (aliceWrites, bob, aliceAddr, bobWrites, alice, bobAddr, max = 20) {
  for (let i = 0; i < max; i++) {
    if (!aliceWrites.length && !bobWrites.length) return i;
    while (aliceWrites.length) {
      bob._handleFabricMessage(aliceWrites.shift(), { name: aliceAddr }, null);
    }
    while (bobWrites.length) {
      alice._handleFabricMessage(bobWrites.shift(), { name: bobAddr }, null);
    }
  }
  return max;
}

describe('@fabric/core Peer P2P_MUSIG_*', function () {
  it('defaults musig2.autoAccept to false', function () {
    const seed = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: seed.mnemonic },
      debug: false
    }));
    assert.strictEqual(peer.settings.musig2.autoAccept, false);
  });

  it('completes a directed 2-of-2 session', function () {
    const { peer: alice } = makePeer('alice');
    const { peer: bob } = makePeer('bob');
    const { aliceAddr, bobAddr, aliceWrites, bobWrites } = wirePair(alice, bob);
    const started = alice.startMusig2({
      dest: bob.key.pubkey,
      msg: Buffer.from('gooncitizen-musig2'),
      purpose: 'test'
    });
    assert.ok(started);
    assert.strictEqual(started.n, 2);
    exchange(aliceWrites, bob, aliceAddr, bobWrites, alice, bobAddr);
    const aDone = alice.getMusig2Session(started.sessionId);
    const bDone = bob.getMusig2Session(started.sessionId);
    assert.ok(aDone && aDone.signature, 'initiator missing aggregate signature');
    assert.ok(bDone && bDone.signature, 'co-signer missing aggregate signature');
    assert.strictEqual(aDone.signature, bDone.signature);
    const pubkeys = [
      individualPk(alice.key.private),
      individualPk(bob.key.private)
    ];
    const session = alice._musigGet(started.sessionId);
    assert.strictEqual(
      verifyAggregatedSchnorr(session.challenge, Buffer.from(aDone.signature, 'hex'), pubkeys),
      true
    );
  });

  it('ignores peel/relay-as-is START (no session)', function () {
    const { peer: bob } = makePeer('bob');
    const author = new Key();
    const sessionId = Buffer.alloc(32, 7);
    const body = {
      sessionId: sessionId.toString('hex'),
      msg: Buffer.from('nope').toString('hex'),
      pubkeys: Buffer.concat([
        Buffer.from(author.pubkey, 'hex'),
        Buffer.from(bob.key.pubkey, 'hex')
      ]).toString('hex'),
      pubnonce: Buffer.concat([
        Buffer.from(author.pubkey, 'hex'),
        Buffer.from(author.pubkey, 'hex')
      ]).toString('hex'),
      purpose: 'peel'
    };
    const inner = Message.fromVector(['P2P_MUSIG_START', JSON.stringify(body)]).signWithKey(author);
    bob._handleFabricMessage(inner.toBuffer(), { name: '127.0.0.1:1' }, null, {
      peeledForward: true
    });
    assert.strictEqual(bob._musigSessions.size, 0);
    const relayBody = Object.assign({}, body, {
      sessionId: Buffer.alloc(32, 8).toString('hex')
    });
    const relayInner = Message.fromVector(['P2P_MUSIG_START', JSON.stringify(relayBody)]).signWithKey(author);
    bob._handleFabricMessage(relayInner.toBuffer(), { name: '127.0.0.1:1' }, null, {
      relayedAsIs: true
    });
    assert.strictEqual(bob._musigSessions.size, 0);
  });

  it('rejects START whose AMP signer is not in the pubkey list', function () {
    const { peer: bob } = makePeer('bob');
    const alice = new Key();
    const rogue = new Key();
    const origin = '127.0.0.1:19103';
    bob.connections[origin] = { _writeFabric () {}, destroy () {} };
    bob.peers[origin] = { id: rogue.pubkey, publicKey: rogue.pubkey };
    const body = {
      sessionId: Buffer.alloc(32, 3).toString('hex'),
      msg: Buffer.from('rogue').toString('hex'),
      pubkeys: Buffer.concat([
        Buffer.from(alice.pubkey, 'hex'),
        Buffer.from(bob.key.pubkey, 'hex')
      ]).toString('hex'),
      pubnonce: Buffer.concat([
        Buffer.from(alice.pubkey, 'hex'),
        Buffer.from(alice.pubkey, 'hex')
      ]).toString('hex')
    };
    const frame = Message.fromVector(['P2P_MUSIG_START', JSON.stringify(body)]).signWithKey(rogue);
    bob._handleFabricMessage(frame.toBuffer(), { name: origin }, null);
    assert.strictEqual(bob._musigSessions.size, 0);
  });

  it('ignores P2P_MUSIG_START smuggled in a generic carrier', function () {
    const { peer: bob } = makePeer('bob');
    const alice = new Key();
    const origin = '127.0.0.1:19104';
    bob.connections[origin] = { _writeFabric () {}, destroy () {} };
    bob.peers[origin] = { id: alice.pubkey, publicKey: alice.pubkey };
    const inner = {
      type: 'P2P_MUSIG_START',
      sessionId: Buffer.alloc(32, 9).toString('hex'),
      msg: 'hi',
      pubkeys: Buffer.concat([
        Buffer.from(alice.pubkey, 'hex'),
        Buffer.from(bob.key.pubkey, 'hex')
      ]).toString('hex'),
      pubnonce: Buffer.concat([
        Buffer.from(alice.pubkey, 'hex'),
        Buffer.from(alice.pubkey, 'hex')
      ]).toString('hex')
    };
    const frame = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(inner)]).signWithKey(alice);
    bob._handleFabricMessage(frame.toBuffer(), { name: origin }, null);
    assert.strictEqual(bob._musigSessions.size, 0);
  });

  it('does not auto-sign inbound START when musig2.autoAccept is off', function () {
    const { peer: bob } = makePeer('bob', { musig2: { autoAccept: false } });
    const alice = new Key();
    const origin = '127.0.0.1:19105';
    const writes = [];
    bob.connections[origin] = { _writeFabric (buf) { writes.push(buf); }, destroy () {} };
    bob.peers[origin] = { id: alice.pubkey, publicKey: alice.pubkey };
    const body = {
      sessionId: Buffer.alloc(32, 4).toString('hex'),
      msg: Buffer.from('oracle').toString('hex'),
      pubkeys: Buffer.concat([
        Buffer.from(alice.pubkey, 'hex'),
        Buffer.from(bob.key.pubkey, 'hex')
      ]).toString('hex'),
      pubnonce: Buffer.concat([
        Buffer.from(alice.pubkey, 'hex'),
        Buffer.from(alice.pubkey, 'hex')
      ]).toString('hex')
    };
    const frame = Message.fromVector(['P2P_MUSIG_START', JSON.stringify(body)]).signWithKey(alice);
    bob._handleFabricMessage(frame.toBuffer(), { name: origin }, null);
    assert.strictEqual(bob._musigSessions.size, 0);
    assert.strictEqual(writes.length, 0);
  });

  it('clamps invalid musig2.maxSessions instead of looping', function () {
    this.timeout(2000);
    const { peer: alice } = makePeer('alice', { musig2: { maxSessions: -1 } });
    const dest = new Key();
    const origin = '127.0.0.1:19106';
    alice.connections[origin] = { _writeFabric () {}, destroy () {} };
    alice.peers[origin] = { id: dest.pubkey, publicKey: dest.pubkey };
    alice.startMusig2({ dest: dest.pubkey, msg: Buffer.from('one') });
    alice.startMusig2({ dest: dest.pubkey, msg: Buffer.from('two') });
    assert.ok(alice._musigSessions.size >= 1);
    assert.ok(alice._musigSessions.size <= 32);
  });

  it('evicts the oldest MuSig2 session at maxSessions', function () {
    const { peer: alice } = makePeer('alice', { musig2: { maxSessions: 1 } });
    const dest = new Key();
    const origin = '127.0.0.1:19107';
    alice.connections[origin] = { _writeFabric () {}, destroy () {} };
    alice.peers[origin] = { id: dest.pubkey, publicKey: dest.pubkey };
    const first = alice.startMusig2({ dest: dest.pubkey, msg: Buffer.from('keep-first') });
    const second = alice.startMusig2({ dest: dest.pubkey, msg: Buffer.from('keep-second') });
    assert.ok(first && second);
    assert.strictEqual(alice._musigSessions.size, 1);
    assert.strictEqual(alice.getMusig2Session(first.sessionId), null);
    assert.ok(alice.getMusig2Session(second.sessionId));
  });
});
