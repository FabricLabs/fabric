'use strict';

/**
 * Strict Protocol V1 — opcode × delivery-mode matrix.
 * Asserts meshDeliveryContext local-observe for foreign RELAY + peel on base types.
 */

const assert = require('assert');
const { describe, it } = require('mocha');
const {
  BASE_V1_TYPES,
  offlinePeer,
  signFrame,
  defaultOkBody,
  hostileBody,
  deliver,
  assertLocalObserve,
  peelReadyPeer,
  Key
} = require('./helpers');
const SIGNING_TAGS = require('../../functions/signingTags');

function buildSessionOfferBody (peer, authorKey, nonce) {
  const attackerId = `v1-session-${nonce}`;
  const proof = peer._sessionKeyProofMessage(attackerId, authorKey.pubkey, authorKey.pubkey);
  return {
    type: 'P2P_SESSION_OFFER',
    actor: {
      id: attackerId,
      pubkey: authorKey.pubkey,
      parentPubkey: authorKey.pubkey,
      parentSignature: authorKey.signSchnorr(proof, SIGNING_TAGS.SESSION_KEY).toString('hex')
    },
    object: { challenge: nonce }
  };
}

describe('protocol-v1 delivery matrix', function () {
  this.timeout(60000);

  const modes = ['direct', 'foreignRelay', 'peel'];

  for (const type of BASE_V1_TYPES) {
    describe(type, function () {
      for (const mode of modes) {
        it(`${mode}: ok body respects delivery trust boundary`, function () {
          const authorKey = new Key();
          let peer;
          let destKey = null;
          if (mode === 'peel') {
            ({ peer, destKey } = peelReadyPeer());
          } else {
            peer = offlinePeer({
              constraints: { peers: { max: 32 } },
              peering: { maxCandidates: 16, maxRelaysPerOriginPerMinute: 30 },
              gossip: { maxRelaysPerOriginPerMinute: 30 },
              chat: { maxRelaysPerOriginPerMinute: 30 },
              serveLocalDocumentInventory: false,
              relayInventoryRequest: false
            });
          }

          const nonce = `${type}-${mode}`;
          let body;
          if (type === 'P2P_SESSION_OFFER') {
            body = buildSessionOfferBody(peer, authorKey, nonce);
          } else {
            body = defaultOkBody(type, {
              nonce,
              host: `203.0.113.${(BASE_V1_TYPES.indexOf(type) % 200) + 10}`,
              port: 17000 + BASE_V1_TYPES.indexOf(type)
            });
          }
          const inner = signFrame(authorKey, type, body);
          const originName = '127.0.0.1:17100';
          const other = '127.0.0.1:17101';

          const { before, after, edgeWrites } = deliver({
            peer,
            inner,
            mode,
            authorKey,
            destKey,
            originName,
            otherEdges: [other]
          });

          if (mode === 'foreignRelay' || mode === 'peel') {
            assertLocalObserve(before, after, {
              allowMesh: mode === 'foreignRelay'
            });
            if (mode === 'foreignRelay') {
              for (const bufs of Object.values(edgeWrites)) {
                assert.ok(bufs.length <= 1, `${type} foreignRelay must not amplify beyond outer`);
                if (bufs.length === 1) {
                  const Message = require('../../types/message');
                  assert.strictEqual(Message.fromBuffer(bufs[0]).type, 'P2P_RELAY');
                }
              }
            }
            if (type === 'P2P_PEERING_OFFER' || type === 'P2P_PEER_ANNOUNCE') {
              assert.strictEqual(after.candidates, before.candidates,
                `${type} ${mode} must not enqueue dial candidates`);
            }
            if (type === 'P2P_PEER_ALIAS') {
              assert.strictEqual(after.alias, null, 'peel/RELAY must not set connection alias');
            }
            if (type === 'P2P_SESSION_OFFER') {
              assert.strictEqual(after.addressMap, before.addressMap);
              assert.strictEqual(after.pin, before.pin);
            }
          } else {
            assert.strictEqual(after.banned, false);
            assert.strictEqual(after.destroyed, false);
            if (type === 'P2P_PEERING_OFFER' || type === 'P2P_PEER_ANNOUNCE') {
              assert.ok(after.candidates >= before.candidates,
                `${type} direct should be allowed to enqueue when under peer cap`);
            }
          }
        });

        it(`${mode}: hostile body must not cut last hop on envelope path`, function () {
          const authorKey = new Key();
          let peer;
          let destKey = null;
          if (mode === 'peel') {
            ({ peer, destKey } = peelReadyPeer({
              serveLocalDocumentInventory: true,
              relayInventoryRequest: true
            }));
          } else {
            peer = offlinePeer({
              constraints: { peers: { max: 32 } },
              serveLocalDocumentInventory: true,
              relayInventoryRequest: true,
              peering: { maxCandidates: 8 }
            });
          }

          const inner = signFrame(authorKey, type, hostileBody(type));
          const originName = '127.0.0.1:17200';
          const other = '127.0.0.1:17201';

          const { before, after, edgeWrites } = deliver({
            peer,
            inner,
            mode,
            authorKey,
            destKey,
            originName,
            otherEdges: [other]
          });

          if (mode !== 'direct') {
            assertLocalObserve(before, after, { allowMesh: mode === 'foreignRelay' });
            void edgeWrites;
          } else if (type === 'P2P_SESSION_OFFER') {
            // Direct session-key violations hard-punish the attributable TCP peer — expected.
            assert.ok(after.banned || after.destroyed || after.score < before.score,
              'direct hostile SESSION_OFFER should punish attributable peer');
          } else {
            assert.strictEqual(after.banned, false, 'hostile well-formed body must not hard-ban');
            assert.strictEqual(after.destroyed, false);
          }
        });
      }
    });
  }

  it('matrix covers the curated BASE_V1_TYPES list', function () {
    assert.ok(BASE_V1_TYPES.length >= 8);
    assert.ok(BASE_V1_TYPES.includes('P2P_PEERING_OFFER'));
    assert.ok(BASE_V1_TYPES.includes('P2P_BASE_MESSAGE'));
  });
});
