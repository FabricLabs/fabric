'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { offlinePeerSettings } = require('./helpers/peer');
const {
  xOnlyFromKey,
  wrapOnionPath,
  tryDecodeForward
} = require('../functions/fabricOnion');
const {
  ONION_CHAT_SEAL_TYPE,
  isOnionChatSeal,
  sealOnionChatText,
  tryOpenOnionChatText,
  onionPathRecipientXOnly
} = require('../functions/onionChatSeal');

describe('@fabric/core onionChatSeal', function () {
  it('seals to recipient and opens only with matching key', function () {
    const dest = new Key();
    const other = new Key();
    const wire = sealOnionChatText('secret-hop', dest.pubkey);
    assert.ok(isOnionChatSeal(wire));
    assert.ok(wire.includes(ONION_CHAT_SEAL_TYPE));
    assert.ok(!wire.includes('secret-hop'));

    const ok = tryOpenOnionChatText(wire, { keyOrPrivate: dest });
    assert.strictEqual(ok.sealed, true);
    assert.strictEqual(ok.opened, true);
    assert.strictEqual(ok.text, 'secret-hop');

    const bad = tryOpenOnionChatText(wire, { keyOrPrivate: other });
    assert.strictEqual(bad.sealed, true);
    assert.strictEqual(bad.opened, false);
    assert.strictEqual(bad.text, null);
  });

  it('onionPathRecipientXOnly uses path tip', function () {
    const a = new Key();
    const b = new Key();
    const tip = onionPathRecipientXOnly([
      xOnlyFromKey(a).toString('hex'),
      xOnlyFromKey(b).toString('hex')
    ]);
    assert.strictEqual(tip, xOnlyFromKey(b).toString('hex'));
  });

  it('Peer peels sealed onion chat and emits plaintext', function () {
    const destKey = new Key();
    const originKey = new Key();
    const peer = new Peer(offlinePeerSettings({
      key: { mnemonic: destKey.mnemonic }
    }));
    const addr = '127.0.0.1:9300';
    peer.connections[addr] = { _writeFabric () {}, destroy () {} };
    peer.peers[addr] = { id: 'relay', publicKey: originKey.public.encodeCompressed('hex') };

    const sealed = sealOnionChatText('sealed-via-onion', destKey.pubkey);
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', sealed]);
    payload.signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(peer.key)],
      payload,
      key: originKey
    });

    const chats = [];
    peer.on('chat', (body, meta) => chats.push({ body, meta }));
    peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

    assert.strictEqual(chats.length, 1);
    assert.strictEqual(chats[0].body.text, 'sealed-via-onion');
    assert.strictEqual(chats[0].body.onionSealed, true);
    assert.strictEqual(chats[0].meta.onionSealed, true);
  });

  it('Peer drops sealed chat it cannot open', function () {
    const destKey = new Key();
    const wrongPeer = new Peer(offlinePeerSettings());
    const originKey = new Key();
    const addr = '127.0.0.1:9301';
    wrongPeer.connections[addr] = { _writeFabric () {}, destroy () {} };
    wrongPeer.peers[addr] = { id: 'relay', publicKey: originKey.public.encodeCompressed('hex') };

    const sealed = sealOnionChatText('not-for-you', destKey.pubkey);
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', sealed]);
    payload.signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(wrongPeer.key)],
      payload,
      key: originKey
    });

    const chats = [];
    wrongPeer.on('chat', (body) => chats.push(body));
    wrongPeer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);
    assert.strictEqual(chats.length, 0);
  });

  it('multi-hop: curious relay can recurse to chat body but sees ciphertext only', function () {
    const originKey = new Key();
    const relay = new Peer(offlinePeerSettings());
    const destKey = new Key();
    const fromAddr = '127.0.0.1:9310';
    const destAddr = '127.0.0.1:9311';
    const destWrites = [];

    relay.connections[fromAddr] = { _writeFabric () {}, destroy () {} };
    relay.connections[destAddr] = {
      _writeFabric (buf) { destWrites.push(buf); },
      destroy () {}
    };
    relay.peers[fromAddr] = { id: 'src', publicKey: originKey.public.encodeCompressed('hex') };
    relay.peers[destAddr] = { id: 'dest', publicKey: destKey.public.encodeCompressed('hex') };

    const plaintext = 'multi-hop-secret';
    const sealed = sealOnionChatText(plaintext, destKey.pubkey);
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', sealed]).signWithKey(originKey);
    const outer = wrapOnionPath({
      path: [xOnlyFromKey(relay.key), xOnlyFromKey(destKey)],
      payload,
      key: originKey
    });

    const relayChats = [];
    relay.on('chat', (body) => relayChats.push(body));
    relay._handleFabricMessage(outer.toBuffer(), { name: fromAddr }, null);

    assert.strictEqual(relayChats.length, 0, 'relay must not emit chat on mid-hop peel');
    assert.strictEqual(destWrites.length, 1);

    // Snooping relay: recurse nested P2P_FORWARD inners until the application Message.
    let cursor = Message.fromBuffer(destWrites[0]);
    for (let i = 0; i < 8; i++) {
      const fields = tryDecodeForward(cursor);
      if (!fields) break;
      cursor = Message.fromBuffer(fields.inner);
    }
    assert.strictEqual(cursor.type, 'P2P_CHAT_MESSAGE');
    const snooped = cursor.data.toString('utf8');
    assert.ok(isOnionChatSeal(snooped));
    assert.ok(!snooped.includes(plaintext));
    assert.strictEqual(tryOpenOnionChatText(snooped, { keyOrPrivate: relay.key }).opened, false);

    const dest = new Peer(offlinePeerSettings({ key: { mnemonic: destKey.mnemonic } }));
    const tipChats = [];
    dest.connections[destAddr] = { _writeFabric () {}, destroy () {} };
    dest.peers[destAddr] = { id: 'relay', publicKey: relay.key.public.encodeCompressed('hex') };
    dest.on('chat', (body) => tipChats.push(body));
    dest._handleFabricMessage(destWrites[0], { name: destAddr }, null);
    assert.strictEqual(tipChats.length, 1);
    assert.strictEqual(tipChats[0].text, plaintext);
    assert.strictEqual(tipChats[0].onionSealed, true);
  });

  it('mesh flood P2P_CHAT_MESSAGE stays cleartext (no onion seal path)', function () {
    const peer = new Peer(offlinePeerSettings());
    const author = new Key();
    const addr = '127.0.0.1:9320';
    const peersWrites = [];
    peer.connections[addr] = {
      _writeFabric (buf) { peersWrites.push(buf); },
      destroy () {}
    };
    peer.peers[addr] = { id: 'neighbor', publicKey: author.public.encodeCompressed('hex') };
    peer._addressToId[addr] = 'neighbor';
    peer._state.peers = {
      neighbor: {
        id: 'neighbor',
        address: addr,
        score: 100,
        publicKey: author.public.encodeCompressed('hex')
      }
    };

    const clear = 'mesh-cleartext-hello';
    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', clear]).signWithKey(author);
    const chats = [];
    peer.on('chat', (body, meta) => chats.push({ body, meta }));
    peer._handleFabricMessage(msg.toBuffer(), { name: addr }, null);

    assert.strictEqual(chats.length, 1);
    assert.strictEqual(chats[0].body.text, clear);
    assert.ok(!chats[0].body.onionSealed);
    assert.strictEqual(isOnionChatSeal(clear), false);
  });
});
