'use strict';

const assert = require('assert');
const Message = require('../types/message');
const Peer = require('../types/peer');
const Key = require('../types/key');
const { offlinePeerSettings } = require('./helpers/peer');

describe('Peer P2P_RELAY origin guard', function () {
  it('does not throw when origin is null or missing name (no relay peers)', function () {
    const peer = new Peer(offlinePeerSettings());
    const k = new Key();
    const relay = Message.fromVector(['P2P_RELAY', JSON.stringify({ hop: 1, payload: 'x' })]);
    relay.signWithKey(k);
    const buf = relay.toBuffer();

    const origRelay = peer.relayFrom;
    let relayCalls = 0;
    peer.relayFrom = function relayFromStub () {
      relayCalls++;
      return origRelay.apply(this, arguments);
    };
    try {
      assert.doesNotThrow(() => peer._handleFabricMessage(buf, null, null));
      assert.doesNotThrow(() => peer._handleFabricMessage(buf, undefined, null));
      assert.doesNotThrow(() => peer._handleFabricMessage(buf, {}, null));
      assert.doesNotThrow(() => peer._handleFabricMessage(buf, { name: undefined }, null));
      assert.strictEqual(relayCalls, 0, 'invalid origins must not invoke relayFrom');
    } finally {
      peer.relayFrom = origRelay;
    }
  });
});
