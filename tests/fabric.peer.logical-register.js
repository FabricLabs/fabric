'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { describe, it } = require('mocha');

const Actor = require('../types/actor');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  documentPublishEnvelopeBuffer,
  purchaseContentHashHex
} = require('../functions/publishedDocumentEnvelope');

describe('@fabric/core Peer logical first-writer-wins registration', function () {
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

  it('maps CONTRACT_PUBLISH / DOCUMENT_PUBLISH / PROPOSAL / ANNOUNCE / tip / alias keys', function () {
    const peer = offlinePeer();
    const def = { id: 'c-key', state: { v: 1 }, parties: ['aa'] };
    const cKey = peer._logicalRegistrationKey('CONTRACT_PUBLISH', def);
    assert.ok(cKey.startsWith('contract:'));
    assert.strictEqual(cKey, `contract:${new Actor(def).id}`);

    const doc = {
      id: 'doc-1',
      contentBase64: Buffer.from('hi').toString('base64'),
      size: 2,
      mime: 'text/plain',
      name: 'hi',
      revision: 1,
      sha256: crypto.createHash('sha256').update('hi').digest('hex')
    };
    const dKey = peer._logicalRegistrationKey('DOCUMENT_PUBLISH', doc);
    assert.strictEqual(dKey, `document:doc-1:${purchaseContentHashHex('doc-1', doc)}`);

    const prop = { contractId: 'x', chain: { merkleRoot: 'ab'.repeat(32) } };
    assert.strictEqual(
      peer._logicalRegistrationKey('CONTRACT_PROPOSAL', prop),
      `proposal:x:${'ab'.repeat(32)}`
    );

    const ann = { host: '1.2.3.4', port: 7777 };
    assert.strictEqual(
      peer._logicalRegistrationKey('P2P_PEER_ANNOUNCE', ann),
      `announce:${new Actor(ann).id}`
    );

    assert.strictEqual(
      peer._logicalRegistrationKey('BitcoinBlock', { tip: 'AB'.repeat(32) }),
      `btcblock:${'ab'.repeat(32)}`
    );
    assert.strictEqual(
      peer._logicalRegistrationKey('FlushChain', { snapshotBlockHash: 'CD'.repeat(32) }),
      `flush:${'cd'.repeat(32)}`
    );
    const signer = 'ee'.repeat(32);
    assert.strictEqual(
      peer._logicalRegistrationKey('P2P_PEER_ALIAS', { alias: 'Neo', signer }),
      `alias:${signer}:Neo`
    );
  });

  it('_claimLogicalRegistration is first-writer-wins and FIFO-capped', function () {
    const peer = offlinePeer({ logicalRegister: { maxCache: 2 } });
    const a = peer._claimLogicalRegistration('CONTRACT_PUBLISH', { id: 'a', state: {} }, '11'.repeat(32));
    const b = peer._claimLogicalRegistration('CONTRACT_PUBLISH', { id: 'b', state: {} }, '22'.repeat(32));
    assert.strictEqual(a.duplicate, false);
    assert.strictEqual(b.duplicate, false);
    assert.strictEqual(
      peer._claimLogicalRegistration('CONTRACT_PUBLISH', { id: 'a', state: {} }, '33'.repeat(32)).duplicate,
      true
    );
    // Evict oldest when claiming a third.
    peer._claimLogicalRegistration('CONTRACT_PUBLISH', { id: 'c', state: {} }, '44'.repeat(32));
    assert.strictEqual(peer._logicalRegisterOnce.size, 2);
    assert.strictEqual(
      peer._claimLogicalRegistration('CONTRACT_PUBLISH', { id: 'a', state: {} }, '55'.repeat(32)).duplicate,
      false,
      'evicted key may be claimed again'
    );
  });

  it('CONTRACT_PUBLISH re-sign is full no-op (no emit, no relay, no allow-list)', function () {
    const peer = offlinePeer();
    const owner = new Key();
    const attacker = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const attackerPub = String(attacker.pubkey).toLowerCase();
    const definition = { id: 'logical-c', state: { value: 1 }, parties: [ownerPub] };

    let publishes = 0;
    let relays = 0;
    peer.on('contract:publish', () => { publishes++; });
    peer.relayFrom = function () { relays++; };

    const wireOwner = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)])
      .signWithKey(owner);
    const wireAttacker = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)])
      .signWithKey(attacker);

    peer._handleGenericMessage({
      type: 'CONTRACT_PUBLISH',
      actor: { publicKey: ownerPub },
      object: definition
    }, { name: 'owner' }, null, wireOwner);
    peer._handleGenericMessage({
      type: 'CONTRACT_PUBLISH',
      actor: { publicKey: attackerPub },
      object: definition
    }, { name: 'attacker' }, null, wireAttacker);

    assert.strictEqual(publishes, 1);
    assert.strictEqual(relays, 1);
    const contractId = Object.keys(peer.contracts)[0];
    assert.strictEqual(peer._signerMayPatchContract(contractId, attackerPub), false);
  });

  it('DOCUMENT_PUBLISH re-sign of same content is no-op; content change is accepted', function () {
    const peer = offlinePeer();
    const k1 = new Key();
    const k2 = new Key();
    const bodyA = Buffer.from('content-a');
    const bodyB = Buffer.from('content-b');
    const parsedA = {
      id: 'doc-logical',
      contentBase64: bodyA.toString('base64'),
      size: bodyA.length,
      mime: 'text/plain',
      name: 'a',
      revision: 1,
      sha256: crypto.createHash('sha256').update(bodyA).digest('hex')
    };
    const parsedB = {
      ...parsedA,
      contentBase64: bodyB.toString('base64'),
      size: bodyB.length,
      sha256: crypto.createHash('sha256').update(bodyB).digest('hex')
    };

    let emits = 0;
    peer.on('documentPublish', () => { emits++; });

    const wireA = documentPublishEnvelopeBuffer('doc-logical', parsedA);
    const signedA = Message.fromBuffer(wireA).signWithKey(k1);
    peer._handleFabricMessage(signedA.toBuffer(), { name: 'p1' }, null);
    // Re-sign identical content with another key (different wire hash).
    const signedA2 = Message.fromBuffer(wireA).signWithKey(k2);
    peer._handleFabricMessage(signedA2.toBuffer(), { name: 'p2' }, null);
    assert.strictEqual(emits, 1);

    const wireB = documentPublishEnvelopeBuffer('doc-logical', parsedB);
    const signedB = Message.fromBuffer(wireB).signWithKey(k2);
    peer._handleFabricMessage(signedB.toBuffer(), { name: 'p2' }, null);
    assert.strictEqual(emits, 2, 'new content hash is a new logical registration');
  });

  it('P2P_PEER_ANNOUNCE duplicate does not grow candidates', function () {
    const peer = offlinePeer();
    const obj = { host: '10.9.8.7', port: 7777, pubkey: 'ab'.repeat(32) };
    peer._handleGenericMessage({ type: 'P2P_PEER_ANNOUNCE', object: obj }, { name: 'o1' });
    peer._handleGenericMessage({ type: 'P2P_PEER_ANNOUNCE', object: obj }, { name: 'o2' });
    assert.strictEqual(peer.candidates.length, 1);
  });

  it('P2P_DOCUMENT_PUBLISH pricing duplicate is no-op', function () {
    const peer = offlinePeer();
    let emits = 0;
    peer.on('documentPublish', () => { emits++; });
    const object = { hash: 'doc-price-1', rate: 100, contentHash: 'cd'.repeat(32) };
    peer._handleGenericMessage({ type: 'P2P_DOCUMENT_PUBLISH', object }, { name: 's1' });
    peer._handleGenericMessage({ type: 'P2P_DOCUMENT_PUBLISH', object }, { name: 's2' });
    assert.strictEqual(emits, 1);
  });

  it('P2P_STATE_ANNOUNCE duplicate is no-op', function () {
    const peer = offlinePeer({ debug: true });
    let debugs = 0;
    peer.on('debug', (msg) => {
      if (String(msg).includes('state_announce')) debugs++;
    });
    const object = { state: { clock: 1, root: 'ef'.repeat(32) } };
    peer._handleGenericMessage({ type: 'P2P_STATE_ANNOUNCE', object }, { name: 'o' });
    peer._handleGenericMessage({ type: 'P2P_STATE_ANNOUNCE', object }, { name: 'o' });
    assert.strictEqual(debugs, 1);
  });

  it('BitcoinBlock re-sign of same tip is no-op', function () {
    const peer = offlinePeer();
    const k1 = new Key();
    const k2 = new Key();
    const payload = { tip: 'ab'.repeat(32), height: 100, network: 'regtest' };
    let emits = 0;
    let relays = 0;
    peer.on('bitcoinBlock', () => { emits++; });
    peer.relayFrom = function () { relays++; };

    const w1 = Message.fromVector(['BitcoinBlock', JSON.stringify(payload)]).signWithKey(k1);
    const w2 = Message.fromVector(['BitcoinBlock', JSON.stringify(payload)]).signWithKey(k2);
    peer._handleFabricMessage(w1.toBuffer(), { name: 'p1' }, null);
    peer._handleFabricMessage(w2.toBuffer(), { name: 'p2' }, null);
    assert.strictEqual(emits, 1);
    assert.strictEqual(relays, 1);

    const next = { tip: 'cd'.repeat(32), height: 101, network: 'regtest' };
    const w3 = Message.fromVector(['BitcoinBlock', JSON.stringify(next)]).signWithKey(k1);
    peer._handleFabricMessage(w3.toBuffer(), { name: 'p1' }, null);
    assert.strictEqual(emits, 2);
  });

  it('P2P_PEER_ALIAS re-sign of same nickname is no-op; rename is accepted', function () {
    const peer = offlinePeer();
    const k1 = new Key();
    const k2 = new Key();
    let emits = 0;
    peer.on('peerAlias', () => { emits++; });

    const a1 = Message.fromVector(['P2P_PEER_ALIAS', 'Neorion']).signWithKey(k1);
    const a1b = Message.fromVector(['P2P_PEER_ALIAS', 'Neorion']).signWithKey(k1);
    // Different wire hash (new signature) but same logical alias+signer.
    peer._handleFabricMessage(a1.toBuffer(), { name: 'c1' }, null);
    peer._handleFabricMessage(a1b.toBuffer(), { name: 'c1' }, null);
    assert.strictEqual(emits, 1);

    const a2 = Message.fromVector(['P2P_PEER_ALIAS', 'Neorion-2']).signWithKey(k1);
    peer._handleFabricMessage(a2.toBuffer(), { name: 'c1' }, null);
    assert.strictEqual(emits, 2);

    // Other signer may claim the same display string.
    const a3 = Message.fromVector(['P2P_PEER_ALIAS', 'Neorion']).signWithKey(k2);
    peer._handleFabricMessage(a3.toBuffer(), { name: 'c2' }, null);
    assert.strictEqual(emits, 3);
  });

  it('DocumentContentKeyReveal duplicate is no-op', function () {
    const { paymentHashHexFromKey } = require('../functions/documentSealedExchange');
    const peer = offlinePeer();
    const keyHex = '11'.repeat(32);
    const reveal = {
      documentId: 'doc-reveal-1',
      keyHex,
      paymentHashHex: paymentHashHexFromKey(keyHex)
    };
    assert.strictEqual(
      peer._claimLogicalRegistration('DocumentContentKeyReveal', reveal, 'aa'.repeat(32)).duplicate,
      false
    );
    assert.strictEqual(
      peer._claimLogicalRegistration('DocumentContentKeyReveal', reveal, 'bb'.repeat(32)).duplicate,
      true
    );
  });

  it('DocumentContentKeyReveal junk paymentHash does not claim logical slot', function () {
    const { paymentHashHexFromKey } = require('../functions/documentSealedExchange');
    const peer = offlinePeer();
    const realKey = '33'.repeat(32);
    const realPay = paymentHashHexFromKey(realKey);
    const junk = {
      documentId: 'doc-reveal-junk',
      keyHex: '44'.repeat(32),
      paymentHashHex: realPay
    };
    assert.strictEqual(
      peer._logicalRegistrationKey('DocumentContentKeyReveal', junk),
      null,
      'mismatched key/paymentHash must not produce a claim key'
    );
    assert.strictEqual(
      peer._claimLogicalRegistration('DocumentContentKeyReveal', junk, 'aa'.repeat(32)).key,
      null
    );
    // Real preimage still claims its derived slot.
    const good = { documentId: 'doc-reveal-junk', keyHex: realKey, paymentHashHex: realPay };
    assert.strictEqual(
      peer._claimLogicalRegistration('DocumentContentKeyReveal', good, 'aa'.repeat(32)).duplicate,
      false
    );
  });
});
