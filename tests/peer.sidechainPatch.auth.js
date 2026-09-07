'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const sidechainState = require('../functions/sidechainState');
const bfs = require('../functions/beaconFederationSigning');
const { offlinePeerSettings } = require('./helpers/peer');

describe('Peer SIDECHAIN_STATE_PATCH authorization', function () {
  it('fail-closes when no federation validators are configured', function () {
    const peer = new Peer(offlinePeerSettings());
    let emitted = false;
    peer.on('sidechain:patch', () => { emitted = true; });
    peer._handleGenericMessage({
      type: 'SIDECHAIN_STATE_PATCH',
      object: {
        type: sidechainState.SIDECHAIN_STATE_PATCH_TYPE,
        basisClock: 0,
        basisDigest: 'aa',
        patches: [{ op: 'add', path: '/x', value: 1 }]
      }
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    assert.strictEqual(emitted, false);
  });

  it('rejects malformed SIDECHAIN_STATE_PATCH bodies', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const peer = new Peer(offlinePeerSettings({
      distributed: { federation: { validators: [key.pubkey], threshold: 1 } }
    }));
    let emitted = false;
    peer.on('sidechain:patch', () => { emitted = true; });
    peer._handleGenericMessage({
      type: 'SIDECHAIN_STATE_PATCH',
      object: { not: 'a patch' }
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    assert.strictEqual(emitted, false);
  });

  it('rejects missing or invalid federationWitness even when validators are set', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const peer = new Peer(offlinePeerSettings({
      distributed: { federation: { validators: [key.pubkey], threshold: 1 } }
    }));
    let emitted = false;
    peer.on('sidechain:patch', () => { emitted = true; });
    peer._handleGenericMessage({
      type: 'SIDECHAIN_STATE_PATCH',
      object: {
        type: sidechainState.SIDECHAIN_STATE_PATCH_TYPE,
        basisClock: 0,
        basisDigest: 'aa',
        patches: [{ op: 'add', path: '/x', value: 1 }]
      }
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    assert.strictEqual(emitted, false);

    const attacker = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const signed = sidechainState.buildSignedSidechainPatchMessage({
      proposal: {
        basisClock: 0,
        basisDigest: 'aa',
        patches: [{ op: 'add', path: '/x', value: 1 }]
      },
      signKey: attacker
    });
    peer._handleGenericMessage({
      type: 'SIDECHAIN_STATE_PATCH',
      object: JSON.parse(signed.data.toString('utf8'))
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    assert.strictEqual(emitted, false);
  });

  it('emits sidechain:patch when federationWitness meets threshold', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const peer = new Peer(offlinePeerSettings({
      distributed: {
        federation: {
          validators: [key.pubkey],
          threshold: 1
        }
      }
    }));
    const proposal = {
      basisClock: 0,
      basisDigest: 'aa',
      patches: [{ op: 'add', path: '/x', value: 1 }]
    };
    const signed = sidechainState.buildSignedSidechainPatchMessage({
      proposal,
      signKey: key
    });
    const body = JSON.parse(signed.data.toString('utf8'));
    let got = null;
    peer.on('sidechain:patch', (ev) => { got = ev; });
    peer._handleGenericMessage({
      type: 'SIDECHAIN_STATE_PATCH',
      object: body
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    assert.ok(got);
    assert.ok(got.proposal);
    assert.ok(got.federationWitness);
  });

  it('suppresses replay of the same patch under a differently signed envelope', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const key2 = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const peer = new Peer(offlinePeerSettings({
      distributed: {
        federation: {
          validators: [key.pubkey, key2.pubkey],
          threshold: 1
        }
      }
    }));
    const proposal = {
      basisClock: 0,
      basisDigest: 'cc',
      patches: [{ op: 'add', path: '/replay', value: 1 }]
    };
    const first = sidechainState.buildSignedSidechainPatchMessage({ proposal, signKey: key });
    const second = sidechainState.buildSignedSidechainPatchMessage({ proposal, signKey: key2 });
    let count = 0;
    peer.on('sidechain:patch', () => { count += 1; });
    peer._handleGenericMessage({
      type: 'SIDECHAIN_STATE_PATCH',
      object: JSON.parse(first.data.toString('utf8'))
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    peer._handleGenericMessage({
      type: 'SIDECHAIN_STATE_PATCH',
      object: JSON.parse(second.data.toString('utf8'))
    }, { name: 'peer@127.0.0.1:7778' }, null, null, {});
    assert.strictEqual(count, 1);
  });

  it('honors FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS for patch authz', function () {
    const key = new Key({ private: '3333333333333333333333333333333333333333333333333333333333333333' });
    const prevV = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    const prevT = process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD;
    process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = key.pubkey;
    process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD = '1';
    try {
      const peer = new Peer(offlinePeerSettings());
      const signed = sidechainState.buildSignedSidechainPatchMessage({
        proposal: {
          basisClock: 0,
          basisDigest: 'bb',
          patches: [{ op: 'add', path: '/env', value: 1 }]
        },
        signKey: key
      });
      let got = null;
      peer.on('sidechain:patch', (ev) => { got = ev; });
      peer._handleGenericMessage({
        type: 'SIDECHAIN_STATE_PATCH',
        object: JSON.parse(signed.data.toString('utf8'))
      }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
      assert.ok(got);
    } finally {
      if (prevV == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
      else process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = prevV;
      if (prevT == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD;
      else process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD = prevT;
    }
  });

  it('reads FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD when validators come from settings', function () {
    const key = new Key({ private: '4444444444444444444444444444444444444444444444444444444444444444' });
    const prevT = process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD;
    const prevV = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    delete process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD = '2';
    try {
      const peer = new Peer(Object.assign(offlinePeerSettings(), {
        distributed: {
          federation: {
            validators: [key.pubkey],
            threshold: 1
          }
        }
      }));
      assert.strictEqual(peer._distributedFederationThresholdFromSettings(), 2);
    } finally {
      if (prevV == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
      else process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = prevV;
      if (prevT == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD;
      else process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD = prevT;
    }
  });
});

function signedFederationCarrier (key, type, object) {
  const body = Object.assign({ type }, object);
  return Message.fromVector(['GenericMessage', JSON.stringify(body)]).signWithKey(key);
}

function carrierObject (wire) {
  const raw = wire && (wire.data != null ? wire.data : wire.raw && wire.raw.data);
  return JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
}

describe('Peer FederationSignRequest / FederationSignResponse', function () {
  it('ignores FederationSign* when no validators are configured', function () {
    const peer = new Peer(offlinePeerSettings());
    let req = null;
    let res = null;
    peer.on('federation:sign-request', (ev) => { req = ev; });
    peer.on('federation:sign-response', (ev) => { res = ev; });
    peer._handleGenericMessage({
      type: 'FederationSignRequest',
      object: { type: 'FederationSignRequest', commitmentDigest: 'aa', epoch: { clock: 1 } }
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    peer._handleGenericMessage({
      type: 'FederationSignResponse',
      object: { type: 'FederationSignResponse', commitmentDigest: 'aa', pubkey: 'bb', signature: 'cc' }
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    assert.strictEqual(req, null);
    assert.strictEqual(res, null);
  });

  it('rejects FederationSign* from non-validator AMP signers', function () {
    const validator = new Key({ private: '4444444444444444444444444444444444444444444444444444444444444444' });
    const outsider = new Key({ private: '5555555555555555555555555555555555555555555555555555555555555555' });
    const peer = new Peer(offlinePeerSettings({
      distributed: { federation: { validators: [validator.pubkey], threshold: 1 } }
    }));
    const epoch = { clock: 2, height: 2, blockHash: 'ee'.repeat(32) };
    const digest = bfs.epochCommitmentDigestHex(epoch);
    let req = null;
    peer.on('federation:sign-request', (ev) => { req = ev; });
    const wire = signedFederationCarrier(outsider, 'FederationSignRequest', {
      commitmentDigest: digest,
      epoch,
      validators: [validator.pubkey],
      threshold: 1
    });
    peer._handleGenericMessage({
      type: 'FederationSignRequest',
      object: carrierObject(wire)
    }, { name: 'peer@127.0.0.1:7777' }, null, wire, {});
    assert.strictEqual(req, null);
  });

  it('emits federation:sign-request and federation:sign-response when validator-signed', function () {
    const key = new Key({ private: '4444444444444444444444444444444444444444444444444444444444444444' });
    const peer = new Peer(offlinePeerSettings({
      distributed: { federation: { validators: [key.pubkey], threshold: 1 } }
    }));
    const epoch = { clock: 2, height: 2, blockHash: 'ee'.repeat(32) };
    const digest = bfs.epochCommitmentDigestHex(epoch);
    let req = null;
    let res = null;
    let relayed = 0;
    peer.relayFrom = () => { relayed += 1; };
    peer.on('federation:sign-request', (ev) => { req = ev; });
    peer.on('federation:sign-response', (ev) => { res = ev; });

    const reqWire = signedFederationCarrier(key, 'FederationSignRequest', {
      commitmentDigest: digest,
      epoch,
      validators: [key.pubkey],
      threshold: 1
    });
    peer._handleGenericMessage({
      type: 'FederationSignRequest',
      object: carrierObject(reqWire)
    }, { name: 'peer@127.0.0.1:7777' }, null, reqWire, {});

    const resWire = signedFederationCarrier(key, 'FederationSignResponse', {
      commitmentDigest: digest,
      pubkey: key.pubkey,
      signature: 'ff'.repeat(32)
    });
    peer._handleGenericMessage({
      type: 'FederationSignResponse',
      object: carrierObject(resWire)
    }, { name: 'peer@127.0.0.1:7777' }, null, resWire, {});

    assert.ok(req && req.request);
    assert.ok(res && res.response);
    assert.strictEqual(req.request.threshold, 1);
    assert.strictEqual(res.response.pubkey, key.pubkey);
    assert.strictEqual(relayed, 0);
  });

  it('rejects FederationSignRequest when commitmentDigest mismatches epoch', function () {
    const key = new Key({ private: '6666666666666666666666666666666666666666666666666666666666666666' });
    const peer = new Peer(offlinePeerSettings({
      distributed: { federation: { validators: [key.pubkey], threshold: 1 } }
    }));
    const epoch = { clock: 3, height: 3, blockHash: '11'.repeat(32) };
    let req = null;
    peer.on('federation:sign-request', (ev) => { req = ev; });
    const wire = signedFederationCarrier(key, 'FederationSignRequest', {
      commitmentDigest: '00'.repeat(32),
      epoch,
      validators: [key.pubkey],
      threshold: 1
    });
    peer._handleGenericMessage({
      type: 'FederationSignRequest',
      object: carrierObject(wire)
    }, { name: 'peer@127.0.0.1:7777' }, null, wire, {});
    assert.strictEqual(req, null);
  });
});
