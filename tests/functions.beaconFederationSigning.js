'use strict';

const assert = require('assert');
const Key = require('../types/key');
const bfs = require('../functions/beaconFederationSigning');

describe('@fabric/core/functions/beaconFederationSigning', function () {
  it('collects threshold Schnorr signatures over an epoch commitment', function () {
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const k2 = new Key({ seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
    const epoch = {
      clock: 1,
      blockHash: 'aa'.repeat(32),
      height: 100,
      sidechain: { clock: 0, stateDigest: 'dd'.repeat(32) }
    };
    const round = bfs.createRound(epoch, {
      validators: [k1.pubkey, k2.pubkey],
      threshold: 2
    });
    assert.strictEqual(bfs.roundMeetsThreshold(round), false);
    const msg = bfs.messageBufferForPayload(epoch);
    assert.strictEqual(bfs.addSignature(round, k1.pubkey, k1.signSchnorr(msg).toString('hex')).sealed, false);
    assert.strictEqual(bfs.addSignature(round, k2.pubkey, k2.signSchnorr(msg).toString('hex')).sealed, true);
    assert.strictEqual(
      bfs.verifyFederationWitnessOnMessage(msg, round.witness, [k1.pubkey, k2.pubkey], 2),
      true
    );
  });

  it('encode/parse FederationSignResponse', function () {
    const body = bfs.encodeSignResponse('abcd', '02ab', 'deadbeef');
    assert.strictEqual(body.type, bfs.FEDERATION_SIGN_RESPONSE);
    const parsed = bfs.parseSignResponse(body);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.commitmentDigest, 'abcd');
  });
});
