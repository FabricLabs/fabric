'use strict';

/**
 * @fileoverview Coverage locks from FabricLabs/fabric PR review comments.
 *
 * Sources: [#185](https://github.com/FabricLabs/fabric/pull/185) (open — Codecov
 * 57 missing patch lines; unresolved Bugbot/CodeRabbit threads) and closed [#183](https://github.com/FabricLabs/fabric/pull/183).
 * Heavy-lift product work (isolatePeerContent collections, unique Service commit
 * ids, Blessed TUI markup) stays deferred in docs/OUTSTANDING.md.
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const { describe, it } = require('mocha');

const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { offlinePeerSettings } = require('./helpers/peer');

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

  it('isolatePeerContent treats null and array state as empty maps', function () {
    const fromNull = new Peer(offlinePeerSettings({ state: null }));
    const fromArray = new Peer(offlinePeerSettings({ state: [] }));
    assert.deepStrictEqual(fromNull._state.content.documents, {});
    assert.deepStrictEqual(fromArray._state.content.messages, {});
    assert.ok(!fromNull._state.content.collections);
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
});
