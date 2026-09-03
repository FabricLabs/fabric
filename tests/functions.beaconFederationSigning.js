'use strict';

const assert = require('assert');
const Key = require('../types/key');
const bfs = require('../functions/beaconFederationSigning');

describe('@fabric/core/functions/beaconFederationSigning', function () {
  it('canonicalEpochForFederation drops balance/timestamp and keeps contracts merkleRoot', function () {
    const epoch = {
      clock: 7,
      blockHash: 'aa'.repeat(32),
      height: 42,
      balance: 12.5,
      balanceSats: 1250000000,
      timestamp: '2026-01-01T00:00:00.000Z',
      sidechain: { clock: 3, stateDigest: 'bb'.repeat(32) },
      contracts: {
        clock: 2,
        stateDigest: 'cc'.repeat(32),
        merkleRoot: 'cc'.repeat(32),
        kind: 'TrackedApplicationContracts',
        acceptedCount: 1
      }
    };
    const canonical = bfs.canonicalEpochForFederation(epoch);
    assert.strictEqual(canonical.clock, 7);
    assert.strictEqual(canonical.height, 42);
    assert.strictEqual(canonical.balance, undefined);
    assert.strictEqual(canonical.timestamp, undefined);
    assert.strictEqual(canonical.contracts.merkleRoot, 'cc'.repeat(32));
    assert.strictEqual(
      bfs.epochCommitmentDigestHex(epoch),
      bfs.epochCommitmentDigestHex(canonical)
    );
  });

  it('two validators independently compute the same commitment digest', function () {
    const epoch = {
      clock: 1,
      blockHash: '11'.repeat(32),
      height: 10,
      contracts: { clock: 0, stateDigest: '22'.repeat(32), merkleRoot: '22'.repeat(32) }
    };
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const k2 = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const r1 = bfs.createRound(epoch, { validators: [k1.pubkey, k2.pubkey], threshold: 2 });
    const r2 = bfs.createRound(epoch, { validators: [k1.pubkey, k2.pubkey], threshold: 2 });
    assert.strictEqual(r1.commitmentDigest, r2.commitmentDigest);
  });

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

  it('createRound tolerates omitted policy (empty validators)', function () {
    const epoch = { clock: 1, blockHash: 'bb'.repeat(32), height: 1 };
    const round = bfs.createRound(epoch);
    assert.ok(round);
    assert.deepStrictEqual(round.validators, []);
    assert.strictEqual(round.status, 'ready');
    assert.strictEqual(bfs.roundMeetsThreshold(round), true);
  });

  it('createRound with a complete initial witness is ready', function () {
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epoch = { clock: 3, blockHash: 'dd'.repeat(32), height: 3 };
    const msg = bfs.messageBufferForPayload(epoch);
    const sig = k1.signSchnorr(msg).toString('hex');
    const round = bfs.createRound(epoch, {
      validators: [k1.pubkey],
      threshold: 1
    }, { signatures: { [k1.pubkey]: sig } });
    assert.strictEqual(round.status, 'ready');
    assert.strictEqual(bfs.roundMeetsThreshold(round), true);
  });

  it('createRound with validators and no signatures stays collecting', function () {
    const k1 = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const epoch = { clock: 4, blockHash: 'ee'.repeat(32), height: 4 };
    const round = bfs.createRound(epoch, { validators: [k1.pubkey], threshold: 1 });
    assert.strictEqual(round.status, 'collecting');
    assert.strictEqual(bfs.roundMeetsThreshold(round), false);
  });

  it('addSignature rejects an omitted-policy round that is already ready', function () {
    const k1 = new Key({ private: '5555555555555555555555555555555555555555555555555555555555555555' });
    const epoch = { clock: 5, blockHash: '11'.repeat(32), height: 5 };
    const round = bfs.createRound(epoch);
    assert.strictEqual(round.status, 'ready');
    const msg = bfs.messageBufferForPayload(epoch);
    const again = bfs.addSignature(round, k1.pubkey, k1.signSchnorr(msg).toString('hex'));
    assert.strictEqual(again.ok, false);
    assert.match(again.error, /not open/i);
  });

  it('addSignature rejects further signatures once status is ready', function () {
    const k1 = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const epoch = { clock: 2, blockHash: 'cc'.repeat(32), height: 2 };
    const round = bfs.createRound(epoch, { validators: [k1.pubkey], threshold: 1 });
    const msg = bfs.messageBufferForPayload(epoch);
    const first = bfs.addSignature(round, k1.pubkey, k1.signSchnorr(msg).toString('hex'));
    assert.strictEqual(first.sealed, true);
    assert.strictEqual(round.status, 'ready');
    const again = bfs.addSignature(round, k1.pubkey, k1.signSchnorr(msg).toString('hex'));
    assert.strictEqual(again.ok, false);
    assert.match(again.error, /not open/i);
  });

  it('addSignature rejects non-validator, empty fields, and bad Schnorr', function () {
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const k2 = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const epoch = { clock: 6, blockHash: '66'.repeat(32), height: 6 };
    const round = bfs.createRound(epoch, { validators: [k1.pubkey], threshold: 1 });
    assert.strictEqual(bfs.addSignature(round, '', 'aa').ok, false);
    assert.strictEqual(bfs.addSignature(round, k2.pubkey, 'aa').error, 'pubkey not in federation validators');
    assert.strictEqual(bfs.addSignature(round, k1.pubkey, '00').error, 'invalid Schnorr signature');
  });

  it('verifyFederationWitnessOnMessage rejects bad threshold and duplicate pubkey padding', function () {
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epoch = { clock: 7, blockHash: '77'.repeat(32), height: 7 };
    const msg = bfs.messageBufferForPayload(epoch);
    const sig = k1.signSchnorr(msg).toString('hex');
    const witness = { signatures: { [k1.pubkey]: sig } };
    assert.strictEqual(
      bfs.verifyFederationWitnessOnMessage(msg, witness, [k1.pubkey, k1.pubkey], 2),
      false,
      'deduped validators cannot satisfy k=2 with one key'
    );
    assert.strictEqual(bfs.verifyFederationWitnessOnMessage(msg, witness, [k1.pubkey], 0), false);
    assert.strictEqual(bfs.verifyFederationWitnessOnMessage('not-a-buffer', witness, [k1.pubkey], 1), false);
  });

  it('encodeSignRequest + persist/load pending rounds round-trip', async function () {
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epoch = { clock: 8, blockHash: '88'.repeat(32), height: 8 };
    const round = bfs.createRound(epoch, { validators: [k1.pubkey], threshold: 1 });
    const req = bfs.encodeSignRequest(round);
    assert.strictEqual(req.type, bfs.FEDERATION_SIGN_REQUEST);
    assert.strictEqual(req.commitmentDigest, round.commitmentDigest);
    assert.deepStrictEqual(req.validators, [k1.pubkey]);

    const store = Object.create(null);
    const fs = {
      readFile (p) { return store[p] != null ? store[p] : null; },
      async publish (p, v) { store[p] = typeof v === 'string' ? v : JSON.stringify(v); }
    };
    await bfs.persistPendingDoc(fs, { version: 1, rounds: { [round.commitmentDigest]: round } });
    const loaded = bfs.loadPendingDoc(fs);
    assert.ok(loaded.rounds[round.commitmentDigest]);
    assert.strictEqual(bfs.loadPendingDoc(null).rounds && Object.keys(bfs.loadPendingDoc(null).rounds).length, 0);
  });

  it('parseSignResponse rejects wrong type and incomplete bodies', function () {
    assert.strictEqual(bfs.parseSignResponse(null).ok, false);
    assert.strictEqual(bfs.parseSignResponse({ type: 'Other' }).ok, false);
    assert.strictEqual(bfs.parseSignResponse({
      type: bfs.FEDERATION_SIGN_RESPONSE,
      commitmentDigest: 'aa'
    }).ok, false);
  });
});
