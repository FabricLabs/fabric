'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Peer = require('../types/peer');
const sidechainState = require('../functions/sidechainState');
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
});

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

  it('emits federation:sign-request and federation:sign-response when validators set', function () {
    const key = new Key({ private: '4444444444444444444444444444444444444444444444444444444444444444' });
    const peer = new Peer(offlinePeerSettings({
      distributed: { federation: { validators: [key.pubkey], threshold: 1 } }
    }));
    let req = null;
    let res = null;
    peer.on('federation:sign-request', (ev) => { req = ev; });
    peer.on('federation:sign-response', (ev) => { res = ev; });
    peer._handleGenericMessage({
      type: 'FederationSignRequest',
      object: {
        type: 'FederationSignRequest',
        commitmentDigest: 'dd'.repeat(16),
        epoch: { clock: 2, height: 2, blockHash: 'ee'.repeat(32) },
        validators: [key.pubkey],
        threshold: 1
      }
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    peer._handleGenericMessage({
      type: 'FederationSignResponse',
      object: {
        type: 'FederationSignResponse',
        commitmentDigest: 'dd'.repeat(16),
        pubkey: key.pubkey,
        signature: 'ff'.repeat(32)
      }
    }, { name: 'peer@127.0.0.1:7777' }, null, null, {});
    assert.ok(req && req.request);
    assert.ok(res && res.response);
    assert.strictEqual(req.request.threshold, 1);
    assert.strictEqual(res.response.pubkey, key.pubkey);
  });
});
