'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { describe, it } = require('mocha');

const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  PEER_SCORE_BODY_HASH_MISMATCH_PENALTY,
  PEER_SCORE_INVALID_SIGNATURE_PENALTY,
  PEER_SCORE_SIGNER_PIN_MISMATCH_PENALTY,
  PEER_SCORE_CONTRACT_OPS_FORBIDDEN_PENALTY,
  PEER_SCORE_LOGICAL_REGISTER_HIJACK_PENALTY,
  PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_PENALTY
} = require('../constants');

describe('@fabric/core Peer scoring / misbehavior', function () {
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

  function seedScore (peer, originName, peerId, score) {
    peer._addressToId[originName] = peerId;
    peer._state.peers = peer._state.peers || {};
    peer._state.peers[peerId] = {
      id: peerId,
      address: originName,
      score
    };
    let destroyed = false;
    peer.connections[originName] = {
      destroy () { destroyed = true; },
      get destroyed () { return destroyed; }
    };
    return () => destroyed;
  }

  it('body hash mismatch deranks and disconnects; does not retain wire hash', function () {
    const peer = offlinePeer();
    const origin = '127.0.0.1:bh';
    const wasDestroyed = seedScore(peer, origin, 'peer-bh', 200);
    const msg = Message.fromVector(['P2P_PING', JSON.stringify({ t: 1 })]).signWithKey(peer.key);
    const buf = Buffer.from(msg.toBuffer());
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (buf.length > 208) buf[208] = buf[208] ^ 0xff;
    else buf[80] = buf[80] ^ 0xff;

    peer._handleFabricMessage(buf, { name: origin }, null);
    assert.strictEqual(peer._state.peers['peer-bh'].score, 200 - PEER_SCORE_BODY_HASH_MISMATCH_PENALTY);
    assert.strictEqual(wasDestroyed(), true);
    assert.strictEqual(peer.messages[hash], undefined, 'failed frames must not fill wire-hash cache');
  });

  it('invalid signature deranks and disconnects; does not retain wire hash', function () {
    const peer = offlinePeer();
    const origin = '127.0.0.1:sig';
    const wasDestroyed = seedScore(peer, origin, 'peer-sig', 150);
    const other = new Key();
    const msg = Message.fromVector(['P2P_PING', JSON.stringify({ t: 2 })]).signWithKey(other);
    const buf = Buffer.from(msg.toBuffer());
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    buf.fill(0, 144, 208);

    peer._handleFabricMessage(buf, { name: origin }, null);
    assert.strictEqual(peer._state.peers['peer-sig'].score, 150 - PEER_SCORE_INVALID_SIGNATURE_PENALTY);
    assert.strictEqual(wasDestroyed(), true);
    assert.strictEqual(peer.messages[hash], undefined);
  });

  it('signer pin mismatch deranks and disconnects', function () {
    const peer = offlinePeer();
    const origin = '127.0.0.1:pin';
    const wasDestroyed = seedScore(peer, origin, 'peer-pin', 180);
    const pinned = new Key();
    const author = new Key();
    peer.peers[origin] = { publicKey: pinned.pubkey };
    const msg = Message.fromVector(
      ['P2P_DOCUMENT_PUBLISH', JSON.stringify({ hash: 'doc', rate: 1, contentHash: 'ab'.repeat(32) })]
    ).signWithKey(author);

    peer._handleFabricMessage(msg.toBuffer(), { name: origin }, null);
    assert.strictEqual(peer._state.peers['peer-pin'].score, 180 - PEER_SCORE_SIGNER_PIN_MISMATCH_PENALTY);
    assert.strictEqual(wasDestroyed(), true);
  });

  it('CONTRACT_PUBLISH non-party re-sign is rejected before claim (no hijack path, no disconnect)', function () {
    const peer = offlinePeer();
    peer.relayFrom = function () {};
    const owner = new Key();
    const attacker = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const attackerPub = String(attacker.pubkey).toLowerCase();
    const attackerOrigin = '127.0.0.1:hijack';
    const wasDestroyed = seedScore(peer, attackerOrigin, 'peer-hijack', 100);
    const definition = { id: 'score-hijack', state: { v: 1 }, parties: [ownerPub] };

    const wireOwner = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    const wireAttacker = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(attacker);

    peer._handleGenericMessage({
      type: 'CONTRACT_PUBLISH',
      actor: { publicKey: ownerPub },
      object: definition
    }, { name: 'owner' }, null, wireOwner);

    // Non-party AMP signer is rejected before logical registration — no hijack
    // soft-punish path (and no allow-list elevation).
    peer._handleGenericMessage({
      type: 'CONTRACT_PUBLISH',
      actor: { publicKey: attackerPub },
      object: definition
    }, { name: attackerOrigin }, null, wireAttacker);

    assert.strictEqual(peer._state.peers['peer-hijack'].score, 100);
    assert.strictEqual(wasDestroyed(), false);
    const contractId = Object.keys(peer.contracts)[0];
    assert.strictEqual(peer._signerMayPatchContract(contractId, attackerPub), false);
  });

  it('CONTRACT_PUBLISH logical hijack deranks when a co-party re-signs after first writer', function () {
    const peer = offlinePeer();
    peer.relayFrom = function () {};
    const owner = new Key();
    const coParty = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const coPub = String(coParty.pubkey).toLowerCase();
    const coOrigin = '127.0.0.1:hijack-co';
    const wasDestroyed = seedScore(peer, coOrigin, 'peer-hijack-co', 100);
    // Both listed — second publisher is authorized but still a logical duplicate.
    const definition = { id: 'score-hijack-co', state: { v: 1 }, parties: [ownerPub, coPub] };

    const wireOwner = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    const wireCo = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(coParty);

    peer._handleGenericMessage({
      type: 'CONTRACT_PUBLISH',
      actor: { publicKey: ownerPub },
      object: definition
    }, { name: 'owner' }, null, wireOwner);

    peer._handleGenericMessage({
      type: 'CONTRACT_PUBLISH',
      actor: { publicKey: coPub },
      object: definition
    }, { name: coOrigin }, null, wireCo);

    assert.strictEqual(
      peer._state.peers['peer-hijack-co'].score,
      100 - PEER_SCORE_LOGICAL_REGISTER_HIJACK_PENALTY
    );
    assert.strictEqual(wasDestroyed(), false);
  });

  it('BitcoinBlock logical duplicate soft-deranks once per window', function () {
    const peer = offlinePeer({
      peerScore: { logicalRegisterDuplicateWindowMs: 600000 }
    });
    peer.relayFrom = function () {};
    const k1 = new Key();
    const k2 = new Key();
    const origin2 = '127.0.0.1:tip2';
    seedScore(peer, origin2, 'peer-tip2', 50);
    const payload = { tip: 'ab'.repeat(32), height: 10 };

    const w1 = Message.fromVector(['BitcoinBlock', JSON.stringify(payload)]).signWithKey(k1);
    peer._handleFabricMessage(w1.toBuffer(), { name: '127.0.0.1:tip1' }, null);

    const w2a = Message.fromVector(['BitcoinBlock', JSON.stringify(payload)]).signWithKey(k2);
    peer._handleFabricMessage(w2a.toBuffer(), { name: origin2 }, null);
    assert.strictEqual(
      peer._state.peers['peer-tip2'].score,
      50 - PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_PENALTY
    );

    // Third signer, same tip, same origin — soft window must not stack.
    const k3 = new Key();
    const w2c = Message.fromVector(['BitcoinBlock', JSON.stringify(payload)]).signWithKey(k3);
    peer._handleFabricMessage(w2c.toBuffer(), { name: origin2 }, null);
    assert.strictEqual(
      peer._state.peers['peer-tip2'].score,
      50 - PEER_SCORE_LOGICAL_REGISTER_DUPLICATE_PENALTY,
      'second logical dup in window must not stack soft penalty'
    );
  });

  it('forbidden CONTRACT_MESSAGE ops derank, disconnect, and do not relay', function () {
    const peer = offlinePeer();
    const owner = new Key();
    const attacker = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const origin = '127.0.0.1:ops';
    const wasDestroyed = seedScore(peer, origin, 'peer-ops', 120);
    peer._state.content.contracts = { c1: { value: 1 } };
    peer._mergeContractPatchAllowList('c1', { parties: [ownerPub] }, ownerPub);

    let relays = 0;
    let emits = 0;
    peer.relayFrom = function () { relays++; };
    peer.on('contract:message', () => { emits++; });

    const wire = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: 'c1',
      ops: [{ op: 'replace', path: '/value', value: 99 }]
    })]).signWithKey(attacker);

    peer._handleGenericMessage({
      type: 'CONTRACT_MESSAGE',
      actor: { publicKey: String(attacker.pubkey).toLowerCase() },
      object: { contract: 'c1', ops: [{ op: 'replace', path: '/value', value: 99 }] }
    }, { name: origin }, null, wire);

    assert.strictEqual(peer._state.content.contracts.c1.value, 1);
    assert.strictEqual(relays, 0);
    assert.strictEqual(emits, 0);
    assert.strictEqual(
      peer._state.peers['peer-ops'].score,
      120 - PEER_SCORE_CONTRACT_OPS_FORBIDDEN_PENALTY
    );
    assert.strictEqual(wasDestroyed(), true);
  });

  it('disconnectOnHardMisbehavior=false deranks without destroy', function () {
    const peer = offlinePeer({
      peerScore: { disconnectOnHardMisbehavior: false }
    });
    const origin = '127.0.0.1:soft';
    const wasDestroyed = seedScore(peer, origin, 'peer-soft', 100);
    const msg = Message.fromVector(['P2P_PING', JSON.stringify({ t: 9 })]).signWithKey(peer.key);
    const buf = Buffer.from(msg.toBuffer());
    if (buf.length > 208) buf[208] ^= 0xff;
    peer._handleFabricMessage(buf, { name: origin }, null);
    assert.strictEqual(peer._state.peers['peer-soft'].score, 100 - PEER_SCORE_BODY_HASH_MISMATCH_PENALTY);
    assert.strictEqual(wasDestroyed(), false);
  });
});
