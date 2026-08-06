'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { offlinePeerSettings } = require('./helpers/peer');
const { xOnlyFromKey, wrapOnionPath, tryDecodeForward } = require('../functions/fabricOnion');

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
});
