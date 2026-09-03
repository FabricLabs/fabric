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
});
