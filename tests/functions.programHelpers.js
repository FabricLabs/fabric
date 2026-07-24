'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('../types/key');
const {
  jsonSafe,
  stableStringify
} = require('../functions/fabricCanonicalJson');
const {
  signingStringForBeaconEpoch,
  epochCommitmentDigestHex,
  verifyFederationWitnessOnMessage,
  BEACON_EPOCH_SIGNING_KIND
} = require('../functions/beaconFederationSigning');
const { parseProgramManifestV1 } = require('../functions/fabricProgramManifest');

describe('@fabric/core federation / program helpers (ex-distributedExecution)', function () {
  it('jsonSafe round-trips JSON-serializable data and drops undefined', function () {
    const o = { a: 1, b: null, c: 'x' };
    assert.deepStrictEqual(jsonSafe(o), o);
    assert.deepStrictEqual(jsonSafe({ u: undefined }), {});
  });

  it('stableStringify aliases fabricCanonicalJson', function () {
    const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
    const o = { b: 1, a: 2 };
    assert.strictEqual(stableStringify(o), fabricCanonicalJson(o));
  });

  it('signingStringForBeaconEpoch is deterministic for the same epoch payload', function () {
    const epoch = { height: 12, tipHash: 'aa', balance: '1' };
    const s1 = signingStringForBeaconEpoch(epoch);
    const s2 = signingStringForBeaconEpoch(epoch);
    assert.strictEqual(s1, s2);
    assert.ok(s1.includes(BEACON_EPOCH_SIGNING_KIND));
  });

  it('epochCommitmentDigestHex is sha256 hex of signing string', function () {
    const epoch = { h: 1 };
    const s = signingStringForBeaconEpoch(epoch);
    const want = crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
    assert.strictEqual(epochCommitmentDigestHex(epoch), want);
  });

  it('verifyFederationWitnessOnMessage accepts a valid Schnorr witness', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epoch = { clock: 1 };
    const msg = Buffer.from(signingStringForBeaconEpoch(epoch), 'utf8');
    const sig = key.signSchnorr(msg);
    const witness = { signatures: { [key.pubkey]: sig.toString('hex') } };
    assert.strictEqual(verifyFederationWitnessOnMessage(msg, witness, [key.pubkey], 1), true);
  });

  it('verifyFederationWitnessOnMessage rejects bad inputs', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const msg = Buffer.from('x', 'utf8');
    assert.strictEqual(verifyFederationWitnessOnMessage(msg, null, [key.pubkey]), false);
    assert.strictEqual(verifyFederationWitnessOnMessage(msg, {}, [key.pubkey]), false);
    assert.strictEqual(verifyFederationWitnessOnMessage('not-buffer', { signatures: {} }, [key.pubkey]), false);
    assert.strictEqual(verifyFederationWitnessOnMessage(msg, { signatures: { x: 'bad' } }, [key.pubkey]), false);
  });

  it('verifyFederationWitnessOnMessage respects threshold across pubkeys', function () {
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const k2 = new Key({ seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
    const msg = Buffer.from(signingStringForBeaconEpoch({ n: 2 }), 'utf8');
    const witness = {
      signatures: {
        [k1.pubkey]: k1.signSchnorr(msg).toString('hex'),
        [k2.pubkey]: k2.signSchnorr(msg).toString('hex')
      }
    };
    assert.strictEqual(verifyFederationWitnessOnMessage(msg, witness, [k1.pubkey, k2.pubkey], 2), true);
    assert.strictEqual(verifyFederationWitnessOnMessage(msg, witness, [k1.pubkey, k2.pubkey], 3), false);
  });

  describe('parseProgramManifestV1', function () {
    it('accepts a minimal valid v1 manifest', function () {
      const r = parseProgramManifestV1({
        version: 1,
        programId: 'prog',
        programHash: 'deadbeef',
        allowedMessageTypes: ['P2P_PING', 1, 'x'],
        federation: { validators: ['02aa', 3], threshold: 2 }
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.manifest.version, 1);
      assert.deepStrictEqual(r.manifest.allowedMessageTypes, ['P2P_PING', 'x']);
      assert.deepStrictEqual(r.manifest.federation.validators, ['02aa']);
      assert.strictEqual(r.manifest.federation.threshold, 2);
    });

    it('returns ok false for invalid manifests', function () {
      assert.strictEqual(parseProgramManifestV1(null).ok, false);
      assert.strictEqual(parseProgramManifestV1({}).ok, false);
      assert.strictEqual(parseProgramManifestV1({ version: 2 }).ok, false);
      assert.strictEqual(parseProgramManifestV1({ version: 1, programId: '', programHash: 'x' }).ok, false);
      assert.strictEqual(parseProgramManifestV1({ version: 1, programId: 'p', programHash: '' }).ok, false);
    });

    it('omits federation when not an object', function () {
      const r = parseProgramManifestV1({
        version: 1,
        programId: 'a',
        programHash: 'b',
        federation: 'nope'
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.manifest.federation, null);
    });
  });
});
