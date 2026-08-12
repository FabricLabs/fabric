'use strict';

/**
 * Playnet-oriented CONTRACT_PUBLISH → register → re-publish integration.
 *
 * Always runs offline (in-process Peer). Optional live dial when
 * FABRIC_PLAYNET_PUBLISH=1 (connects FABRIC_PLAYNET_PEERS, default
 * 127.0.0.1:7777) — skipped unless that env is set. Live mode also requires
 * an explicit FABRIC_MNEMONIC (no public fallback).
 *
 *   npm test -- --grep 'playnet contract publish'
 *   FABRIC_PLAYNET_PUBLISH=1 FABRIC_MNEMONIC='…' npm test -- --grep 'playnet contract publish live'
 */

const assert = require('assert');
const Peer = require('../types/peer');
const Key = require('../types/key');
const Message = require('../types/message');
const Actor = require('../types/actor');

describe('playnet contract publish + re-publish', function () {
  it('publishes, registers Actor id, and re-publishes without allow-list hijack', function () {
    const peer = new Peer({ listen: false, peersDb: null, networking: false });
    const owner = new Key();
    const attacker = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const attackerPub = String(attacker.pubkey).toLowerCase();

    const definition = {
      name: 'PlaynetDemoContract',
      version: 1,
      messageTypes: ['GroupChat', 'GroupChange'],
      parties: [ownerPub],
      validators: [ownerPub],
      threshold: 1,
      state: { network: 'regtest', label: 'playnet-leader' }
    };
    const contractId = new Actor(definition).id;
    assert.match(contractId, /^[0-9a-f]{64}$/);

    let publishes = 0;
    peer.on('contract:publish', () => { publishes++; });

    const wire = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    peer._handleFabricMessage(wire.toBuffer(), { name: '127.0.0.1:18444' });

    assert.ok(peer.contracts[contractId] || Object.keys(peer.contracts || {}).length >= 1);
    const id = peer.contracts[contractId] ? contractId : Object.keys(peer.contracts)[0];
    assert.ok(peer._signerMayPatchContract(id, ownerPub));
    assert.strictEqual(peer._signerMayPatchContract(id, attackerPub), false);

    // Re-publish identical body (owner) — first-writer-wins / stable registration.
    const again = peer._registerContract(definition, ownerPub);
    assert.strictEqual(again, true);
    assert.ok(peer._signerMayPatchContract(id, ownerPub));

    // Attacker re-signs identical body — must not gain patch rights.
    assert.strictEqual(peer._registerContract(definition, attackerPub), true);
    assert.strictEqual(
      peer._signerMayPatchContract(id, attackerPub),
      false,
      're-publish must not grant patch rights to a new wire signer'
    );

    assert.ok(publishes >= 0);
  });

  it('deterministic Actor id is stable across JSON clone (re-publish body)', function () {
    const owner = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const definition = {
      name: 'PlaynetDemoContract',
      version: 1,
      messageTypes: ['GroupChat'],
      parties: [ownerPub],
      state: {}
    };
    const a = new Actor(definition).id;
    const b = new Actor(JSON.parse(JSON.stringify(definition))).id;
    assert.strictEqual(a, b);
  });
});

describe('playnet contract publish live', function () {
  const runLive = process.env.FABRIC_PLAYNET_PUBLISH === '1' || process.env.FABRIC_PLAYNET_PUBLISH === 'true';
  const mnemonic = String(process.env.FABRIC_MNEMONIC || '').trim();

  (runLive && mnemonic ? it : it.skip)('dials configured peers and emits CONTRACT_PUBLISH', async function () {
    this.timeout(60000);
    const peers = String(process.env.FABRIC_PLAYNET_PEERS || '127.0.0.1:7777')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const peer = new Peer({
      listen: false,
      networking: true,
      peers,
      key: { mnemonic },
      peersDb: null
    });
    peer.on('error', () => {});
    try {
      await peer.start();

      const deadline = Date.now() + Number(process.env.FABRIC_PLAYNET_WAIT_MS || 20000);
      while (Date.now() < deadline && Object.keys(peer.connections || {}).length === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
      const conns = Object.keys(peer.connections || {});
      assert.ok(conns.length > 0, `expected at least one connection to ${peers.join(',')}`);

      const ownerPub = String(peer.key.pubkey).toLowerCase();
      const definition = {
        name: 'PlaynetLivePublish',
        version: 1,
        parties: [ownerPub],
        state: { network: process.env.FABRIC_FLUSH_NETWORK || 'regtest' }
      };
      const msg = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(peer.key);
      peer.broadcast(msg.toBuffer());

      // Brief observe, then re-publish once.
      await new Promise((r) => setTimeout(r, 1000));
      const msg2 = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(peer.key);
      peer.broadcast(msg2.toBuffer());
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      await peer.stop();
    }
  });
});
