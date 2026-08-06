'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { offlinePeerSettings } = require('./helpers/peer');
const {
  xOnlyFromKey,
  wrapOnionPath,
  tryDecodeForward,
  P2P_FORWARD_MAX_HOPS
} = require('../functions/fabricOnion');

function wireMock (writes) {
  return {
    _writeFabric (buf) { writes.push(buf); },
    destroy () {}
  };
}

describe('Peer P2P_FORWARD onion', function () {
  it('peels when nextPeer is local and delivers inner chat', function () {
    const destKey = new Key();
    const originKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const localX = xOnlyFromKey(peer.key);
    assert.strictEqual(localX.toString('hex'), xOnlyFromKey(destKey).toString('hex'));
    const addr = '127.0.0.1:9100';
    peer.connections[addr] = wireMock([]);
    peer.peers[addr] = { id: 'relay', publicKey: originKey.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'dest-only']);
    payload.signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [localX],
      payload,
      key: originKey
    });

    const peels = [];
    const chats = [];
    peer.on('onion:peel', (d) => peels.push(d));
    peer.on('chat', (body) => chats.push(body));
    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.ok(peels.length >= 1, 'expected onion:peel');
    assert.ok(chats.length >= 1, 'expected chat delivery');
    assert.strictEqual(chats[0].text, 'dest-only');
  });

  it('forwards bit-identical outer to next hop when nextPeer is remote', function () {
    const relay = new Peer(offlinePeerSettings());
    const originKey = new Key();
    const nextKey = new Key();
    const fromAddr = '127.0.0.1:9200';
    const nextAddr = '127.0.0.1:9201';
    const nextWrites = [];

    relay.connections[fromAddr] = wireMock([]);
    relay.connections[nextAddr] = wireMock(nextWrites);
    relay.peers[fromAddr] = { id: 'a', publicKey: originKey.public.encodeCompressed('hex') };
    relay.peers[nextAddr] = { id: 'b', publicKey: nextKey.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'fwd']);
    payload.signWithKey(originKey);
    // Layer aimed at nextKey (not local relay) — dumb forward path
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(nextKey)],
      payload,
      key: originKey
    });

    const forwards = [];
    relay.on('onion:forward', (d) => forwards.push(d));
    relay._handleFabricMessage(outer.toBuffer(), { name: fromAddr }, null);

    assert.strictEqual(forwards.length, 1);
    assert.strictEqual(forwards[0].nextHop, nextAddr);
    assert.strictEqual(nextWrites.length, 1);
    assert.ok(nextWrites[0].equals(outer.toBuffer()));
  });

  it('sendOnion writes only to the first hop', function () {
    const origin = new Peer(offlinePeerSettings());
    const r1Key = new Key();
    const destKey = new Key();
    const r1Addr = '127.0.0.1:9300';
    const otherAddr = '127.0.0.1:9301';
    const r1Writes = [];
    const otherWrites = [];

    origin.connections[r1Addr] = wireMock(r1Writes);
    origin.connections[otherAddr] = wireMock(otherWrites);
    origin.peers[r1Addr] = { id: 'r1', publicKey: r1Key.public.encodeCompressed('hex') };
    origin.peers[otherAddr] = { id: 'other', publicKey: new Key().public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'private-path']);
    payload.signWithKey(origin.key);

    const ok = origin.sendOnion(
      [xOnlyFromKey(r1Key), xOnlyFromKey(destKey)],
      payload
    );
    assert.strictEqual(ok, true);
    assert.strictEqual(r1Writes.length, 1);
    assert.strictEqual(otherWrites.length, 0);

    const outer = Message.fromBuffer(r1Writes[0]);
    assert.strictEqual(outer.type, 'P2P_FORWARD');
    const fields = tryDecodeForward(outer);
    assert.ok(fields);
    assert.strictEqual(fields.nextPeer.toString('hex'), xOnlyFromKey(r1Key).toString('hex'));
  });

  it('three-hop peel chain: R1 peels then forwards to R2', function () {
    const originKey = new Key();
    const r1 = new Peer(offlinePeerSettings());
    const r2Key = new Key();
    const destKey = new Key();

    const fromAddr = '127.0.0.1:9400';
    const r2Addr = '127.0.0.1:9401';
    const r2Writes = [];

    r1.connections[fromAddr] = wireMock([]);
    r1.connections[r2Addr] = wireMock(r2Writes);
    r1.peers[fromAddr] = { id: 'src', publicKey: originKey.public.encodeCompressed('hex') };
    r1.peers[r2Addr] = { id: 'r2', publicKey: r2Key.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'multi']);
    payload.signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(r1.key), xOnlyFromKey(r2Key), xOnlyFromKey(destKey)],
      payload,
      key: originKey
    });

    r1._handleFabricMessage(outer.toBuffer(), { name: fromAddr }, null);

    assert.strictEqual(r2Writes.length, 1);
    const mid = Message.fromBuffer(r2Writes[0]);
    assert.strictEqual(mid.type, 'P2P_FORWARD');
    const midFields = tryDecodeForward(mid);
    assert.strictEqual(midFields.nextPeer.toString('hex'), xOnlyFromKey(r2Key).toString('hex'));
  });

  it('peeled bad-signature inner does not hard-disconnect the last hop', function () {
    const destKey = new Key();
    const relayKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9500';
    let destroyed = false;
    peer.connections[addr] = {
      _writeFabric () {},
      destroy () { destroyed = true; }
    };
    peer._addressToId[addr] = 'honest-relay';
    peer._state.peers = {
      'honest-relay': {
        id: 'honest-relay',
        address: addr,
        score: 200,
        publicKey: relayKey.public.encodeCompressed('hex')
      }
    };
    peer.peers[addr] = { id: 'honest-relay', publicKey: relayKey.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'tampered']);
    payload.signWithKey(new Key());
    const wire = Buffer.from(payload.toBuffer());
    // Corrupt AMP signature so verify fails after peel.
    if (wire.length > 80) wire[wire.length - 1] ^= 0xff;

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload: Message.fromBuffer(wire),
      key: relayKey
    });

    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(destroyed, false, 'must not destroy honest last-hop connection');
    assert.strictEqual(peer._isPeerBanned(addr), false);
    assert.ok(peer.connections[addr], 'last-hop connection must remain');
    assert.strictEqual(peer._state.peers['honest-relay'].score, 200, 'must not derank last hop');
  });

  it('peeled bad P2P_SESSION_OPEN does not hard-disconnect the last hop', function () {
    const destKey = new Key();
    const relayKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9502';
    let destroyed = false;
    peer.connections[addr] = {
      _writeFabric () {},
      destroy () { destroyed = true; }
    };
    peer._addressToId[addr] = 'honest-relay-session';
    peer._state.peers = {
      'honest-relay-session': {
        id: 'honest-relay-session',
        address: addr,
        score: 190,
        publicKey: relayKey.public.encodeCompressed('hex')
      }
    };
    peer.peers[addr] = {
      id: 'honest-relay-session',
      publicKey: relayKey.public.encodeCompressed('hex')
    };

    // Minimal session open missing actor key material → session-key violation.
    const payload = Message.fromVector(['P2P_SESSION_OPEN', JSON.stringify({
      type: 'P2P_SESSION_OPEN',
      actor: { id: 'attacker' },
      object: { counterparty: 'x', solution: 'y' }
    })]).signWithKey(new Key());

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: relayKey
    });

    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(destroyed, false);
    assert.strictEqual(peer._isPeerBanned(addr), false);
    assert.strictEqual(peer._state.peers['honest-relay-session'].score, 190);
  });

  it('peeled nested P2P_RELAY beyond nest cap does not hard-disconnect last hop', function () {
    const destKey = new Key();
    const relayKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic },
      peerScore: { maxRelayNestDepth: 1 }
    }));
    const addr = '127.0.0.1:9503';
    let destroyed = false;
    peer.connections[addr] = {
      _writeFabric () {},
      destroy () { destroyed = true; }
    };
    peer._addressToId[addr] = 'honest-relay-nest';
    peer._state.peers = {
      'honest-relay-nest': {
        id: 'honest-relay-nest',
        address: addr,
        score: 175,
        publicKey: relayKey.public.encodeCompressed('hex')
      }
    };
    peer.peers[addr] = {
      id: 'honest-relay-nest',
      publicKey: relayKey.public.encodeCompressed('hex')
    };

    const attacker = new Key();
    const leaf = Message.fromVector(['P2P_PING', JSON.stringify({ nest: true })]).signWithKey(attacker);
    const mid = Message.fromVector(['P2P_RELAY', leaf.toBuffer()]).signWithKey(attacker);
    const nested = Message.fromVector(['P2P_RELAY', mid.toBuffer()]).signWithKey(attacker);

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload: nested,
      key: relayKey
    });

    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(destroyed, false);
    assert.strictEqual(peer._isPeerBanned(addr), false);
    assert.strictEqual(peer._state.peers['honest-relay-nest'].score, 175);
  });

  it('valid peeled P2P_SESSION_OFFER does not rebind last-hop identity', function () {
    const destKey = new Key();
    const relayKey = new Key();
    const attackerKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9504';
    const writes = [];
    peer.connections[addr] = wireMock(writes);
    peer._addressToId[addr] = 'honest-relay-bind';
    const relayPub = relayKey.public.encodeCompressed('hex');
    peer._state.peers = {
      'honest-relay-bind': {
        id: 'honest-relay-bind',
        address: addr,
        score: 200,
        publicKey: relayPub
      }
    };
    peer.peers[addr] = { id: 'honest-relay-bind', publicKey: relayPub };

    const attackerId = 'attacker-session-id';
    const proof = peer._sessionKeyProofMessage(attackerId, attackerKey.pubkey, attackerKey.pubkey);
    const payload = Message.fromVector(['P2P_SESSION_OFFER', JSON.stringify({
      type: 'P2P_SESSION_OFFER',
      actor: {
        id: attackerId,
        pubkey: attackerKey.pubkey,
        parentPubkey: attackerKey.pubkey,
        parentSignature: attackerKey.signSchnorr(proof).toString('hex')
      },
      object: { challenge: 'peel-rebind' }
    })]).signWithKey(attackerKey);

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: relayKey
    });

    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(peer._addressToId[addr], 'honest-relay-bind');
    assert.strictEqual(peer.peers[addr].publicKey, relayPub);
    assert.strictEqual(writes.length, 0, 'must not SESSION_OPEN-reply on peel');
    assert.strictEqual(peer._state.peers['honest-relay-bind'].publicKey, relayPub);
  });

  it('peeled chat delivers locally without mesh-relaying under last hop', function () {
    const destKey = new Key();
    const originKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic },
      chat: { maxRelaysPerOriginPerMinute: 1 }
    }));
    const addr = '127.0.0.1:9505';
    const otherAddr = '127.0.0.1:9506';
    const otherWrites = [];
    peer.connections[addr] = wireMock([]);
    peer.connections[otherAddr] = wireMock(otherWrites);
    peer.peers[addr] = { id: 'relay', publicKey: originKey.public.encodeCompressed('hex') };
    peer.peers[otherAddr] = { id: 'other', publicKey: new Key().public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'peel-local-only']);
    payload.signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: originKey
    });

    const chats = [];
    peer.on('chat', (body) => chats.push(body));
    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(chats.length, 1);
    assert.strictEqual(chats[0].text, 'peel-local-only');
    assert.strictEqual(otherWrites.length, 0, 'must not mesh-relay peeled chat');
  });

  it('peeled P2P_PEERING_OFFER does not enqueue candidates or mesh-relay', function () {
    const destKey = new Key();
    const originKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9507';
    const otherAddr = '127.0.0.1:9508';
    const otherWrites = [];
    peer.connections[addr] = wireMock([]);
    peer.connections[otherAddr] = wireMock(otherWrites);
    peer.peers[addr] = { id: 'relay', publicKey: originKey.public.encodeCompressed('hex') };
    peer.peers[otherAddr] = { id: 'other', publicKey: new Key().public.encodeCompressed('hex') };

    const beforeQueue = (peer.candidates && peer.candidates.length) || 0;
    const payload = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify({
      type: 'P2P_PEERING_OFFER',
      object: {
        transport: 'fabric',
        host: '203.0.113.9',
        port: 17777,
        peeringHop: 5
      }
    })]).signWithKey(originKey);

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: originKey
    });

    const offers = [];
    peer.on('peeringOffer', (d) => offers.push(d));
    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.ok(offers.length >= 1, 'expect local peeringOffer observe');
    assert.strictEqual(offers[0].peeledForward, true);
    const afterQueue = (peer.candidates && peer.candidates.length) || 0;
    assert.strictEqual(afterQueue, beforeQueue, 'must not enqueue peel dial targets');
    assert.ok(!peer._candidateKeys.has('203.0.113.9:17777'));
    assert.strictEqual(otherWrites.length, 0, 'must not mesh-relay peeled peering offer');
  });

  it('peeled body-hash mismatch does not hard-disconnect the last hop', function () {
    const destKey = new Key();
    const relayKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9501';
    let destroyed = false;
    peer.connections[addr] = {
      _writeFabric () {},
      destroy () { destroyed = true; }
    };
    peer._addressToId[addr] = 'honest-relay-2';
    peer._state.peers = {
      'honest-relay-2': {
        id: 'honest-relay-2',
        address: addr,
        score: 180,
        publicKey: relayKey.public.encodeCompressed('hex')
      }
    };
    peer.peers[addr] = { id: 'honest-relay-2', publicKey: relayKey.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'hash-bad']).signWithKey(new Key());
    const buf = Buffer.from(payload.toBuffer());
    // Flip a body byte after the 208-byte header so header.hash mismatches.
    if (buf.length > 208) buf[208] ^= 0xff;

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload: Message.fromBuffer(buf),
      key: relayKey
    });

    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(destroyed, false);
    assert.strictEqual(peer._isPeerBanned(addr), false);
    assert.strictEqual(peer._state.peers['honest-relay-2'].score, 180);
  });

  it('drops P2P_FORWARD with ttl=0 (no peel, no forward)', function () {
    const peer = new Peer(offlinePeerSettings());
    const originKey = new Key();
    const fromAddr = '127.0.0.1:9600';
    const nextWrites = [];
    peer.connections[fromAddr] = wireMock([]);
    peer.connections['127.0.0.1:9601'] = wireMock(nextWrites);
    peer.peers[fromAddr] = { id: 'src', publicKey: originKey.public.encodeCompressed('hex') };

    const inner = Message.fromVector(['P2P_CHAT_MESSAGE', 'ttl0']).signWithKey(originKey).toBuffer();
    const outer = Message.fromFields('P2P_FORWARD', {
      nextPeer: xOnlyFromKey(peer.key),
      ttl: 0,
      inner
    }).signWithKey(originKey);

    const peels = [];
    const forwards = [];
    peer.on('onion:peel', (d) => peels.push(d));
    peer.on('onion:forward', (d) => forwards.push(d));
    peer._handleFabricMessage(outer.toBuffer(), { name: fromAddr }, null);

    assert.strictEqual(peels.length, 0);
    assert.strictEqual(forwards.length, 0);
    assert.strictEqual(nextWrites.length, 0);
  });

  it('refuses bounce of P2P_FORWARD back to origin', function () {
    const relay = new Peer(offlinePeerSettings());
    const originKey = new Key();
    const nextKey = new Key();
    const fromAddr = '127.0.0.1:9610';
    const fromWrites = [];
    relay.connections[fromAddr] = wireMock(fromWrites);
    relay.peers[fromAddr] = { id: 'src', publicKey: nextKey.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'bounce']).signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(nextKey)],
      payload,
      key: originKey
    });

    const forwards = [];
    relay.on('onion:forward', (d) => forwards.push(d));
    relay._handleFabricMessage(outer.toBuffer(), { name: fromAddr }, null);

    assert.strictEqual(forwards.length, 0);
    assert.strictEqual(fromWrites.length, 0, 'must not write bounce back to origin');
  });

  it('emits onion:undeliverable when next hop is missing', function () {
    const relay = new Peer(offlinePeerSettings());
    const originKey = new Key();
    const missingKey = new Key();
    const fromAddr = '127.0.0.1:9620';
    relay.connections[fromAddr] = wireMock([]);
    relay.peers[fromAddr] = { id: 'src', publicKey: originKey.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'gone']).signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(missingKey)],
      payload,
      key: originKey
    });

    const misses = [];
    relay.on('onion:undeliverable', (d) => misses.push(d));
    relay._handleFabricMessage(outer.toBuffer(), { name: fromAddr }, null);

    assert.strictEqual(misses.length, 1);
    assert.strictEqual(misses[0].reason, 'next-hop-missing');
    assert.strictEqual(misses[0].nextPeer, xOnlyFromKey(missingKey).toString('hex'));
    assert.strictEqual(relay._isPeerBanned(fromAddr), false);
  });

  it('sendOnion fails on empty path and missing first hop', function () {
    const peer = new Peer(offlinePeerSettings());
    const r1Key = new Key();
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'x']).signWithKey(peer.key);

    const warnings = [];
    const undeliverable = [];
    peer.on('warning', (w) => warnings.push(String(w)));
    peer.on('onion:undeliverable', (d) => undeliverable.push(d));

    assert.strictEqual(peer.sendOnion([], payload), false);
    assert.ok(warnings.some((w) => /empty path/i.test(w)));

    assert.strictEqual(peer.sendOnion([xOnlyFromKey(r1Key)], payload), false);
    assert.ok(undeliverable.some((d) => d.reason === 'first-hop-missing'));
  });

  it('sendOnion wrap failure returns false for oversized path', function () {
    const peer = new Peer(offlinePeerSettings());
    const path = [];
    for (let i = 0; i < P2P_FORWARD_MAX_HOPS + 1; i++) path.push(xOnlyFromKey(new Key()));
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'big']).signWithKey(peer.key);
    const warnings = [];
    peer.on('warning', (w) => warnings.push(String(w)));
    assert.strictEqual(peer.sendOnion(path, payload), false);
    assert.ok(warnings.some((w) => /wrap failed/i.test(w)));
  });

  it('peeled forbidden CONTRACT_MESSAGE ops do not cut last hop', function () {
    const destKey = new Key();
    const relayKey = new Key();
    const owner = new Key();
    const attacker = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9630';
    let destroyed = false;
    peer.connections[addr] = {
      _writeFabric () {},
      destroy () { destroyed = true; }
    };
    peer._addressToId[addr] = 'honest-relay-ops';
    peer._state.peers = {
      'honest-relay-ops': {
        id: 'honest-relay-ops',
        address: addr,
        score: 160,
        publicKey: relayKey.public.encodeCompressed('hex')
      }
    };
    peer.peers[addr] = {
      id: 'honest-relay-ops',
      publicKey: relayKey.public.encodeCompressed('hex')
    };
    peer._state.content.contracts = { c1: { value: 1 } };
    peer._mergeContractPatchAllowList('c1', {
      parties: [String(owner.pubkey).toLowerCase()]
    }, String(owner.pubkey).toLowerCase());

    const payload = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: 'c1',
      ops: [{ op: 'replace', path: '/value', value: 99 }]
    })]).signWithKey(attacker);

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: relayKey
    });

    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(peer._state.content.contracts.c1.value, 1);
    assert.strictEqual(destroyed, false);
    assert.strictEqual(peer._isPeerBanned(addr), false);
    assert.strictEqual(peer._state.peers['honest-relay-ops'].score, 160);
  });

  it('peeled P2P_PEER_ALIAS does not overlay last-hop nickname or mesh-relay', function () {
    const destKey = new Key();
    const originKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9650';
    const otherAddr = '127.0.0.1:9651';
    const otherWrites = [];
    peer.connections[addr] = wireMock([]);
    peer.connections[otherAddr] = wireMock(otherWrites);
    peer.peers[addr] = {
      id: 'honest-relay-alias',
      publicKey: originKey.public.encodeCompressed('hex')
    };
    peer._addressToId[addr] = 'honest-relay-alias';
    peer._state.peers = {
      'honest-relay-alias': {
        id: 'honest-relay-alias',
        address: addr,
        score: 140,
        publicKey: originKey.public.encodeCompressed('hex'),
        alias: 'relay-nick'
      }
    };
    peer.connections[addr]._alias = 'relay-nick';

    const attacker = new Key();
    const payload = Message.fromVector(['P2P_PEER_ALIAS', 'attacker-nick']).signWithKey(attacker);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: originKey
    });

    const aliases = [];
    peer.on('peerAlias', (d) => aliases.push(d));
    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.ok(aliases.length >= 1);
    assert.strictEqual(aliases[0].alias, 'attacker-nick');
    assert.strictEqual(aliases[0].peeledForward, true);
    assert.strictEqual(peer.connections[addr]._alias, 'relay-nick');
    assert.strictEqual(peer._state.peers['honest-relay-alias'].alias, 'relay-nick');
    assert.strictEqual(peer._state.peers['honest-relay-alias'].address, addr);
    assert.strictEqual(otherWrites.length, 0, 'must not mesh-relay peeled alias');
  });

  it('peeled P2P_PEER_GOSSIP observes locally without budget burn or mesh-relay', function () {
    const destKey = new Key();
    const originKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic },
      gossip: { maxRelaysPerOriginPerMinute: 1 }
    }));
    const addr = '127.0.0.1:9660';
    const otherAddr = '127.0.0.1:9661';
    const otherWrites = [];
    peer.connections[addr] = wireMock([]);
    peer.connections[otherAddr] = wireMock(otherWrites);
    peer.peers[addr] = { id: 'relay', publicKey: originKey.public.encodeCompressed('hex') };

    const payload = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify({
      type: 'P2P_PEER_GOSSIP',
      object: { peer: 'deadbeef', gossipHop: 5 }
    })]).signWithKey(originKey);

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: originKey
    });

    const gossips = [];
    peer.on('peeringGossip', (d) => gossips.push(d));
    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.ok(gossips.length >= 1);
    assert.strictEqual(gossips[0].peeledForward, true);
    assert.strictEqual(peer._gossipRelayByOrigin.has(addr), false, 'must not burn last-hop gossip budget');
    assert.strictEqual(otherWrites.length, 0, 'must not mesh-relay peeled gossip');
  });

  it('undecodable P2P_FORWARD body is dropped', function () {
    const peer = new Peer(offlinePeerSettings());
    const fromAddr = '127.0.0.1:9640';
    peer.connections[fromAddr] = wireMock([]);
    // Valid AMP envelope with wrong body shape for P2P_FORWARD.
    const bogus = Message.fromVector(['P2P_FORWARD', 'not-a-field-body']).signWithKey(peer.key);
    const peels = [];
    peer.on('onion:peel', (d) => peels.push(d));
    peer._handleFabricMessage(bogus.toBuffer(), { name: fromAddr }, null);
    assert.strictEqual(peels.length, 0);
    assert.strictEqual(tryDecodeForward(bogus), null);
  });
});
