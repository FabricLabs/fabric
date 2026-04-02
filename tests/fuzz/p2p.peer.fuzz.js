'use strict';

const assert = require('assert');
const Peer = require('../../types/peer');
const { randomAmpFrame, fuzzIterations } = require('./helpers');

describe('fuzz: Peer._handleFabricMessage', function () {
  this.timeout(120000);

  it('does not throw on random frames (origin set; debug off)', function () {
    const peer = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      debug: false,
      reconnectToKnownPeers: false
    });
    const origin = { name: '127.0.0.1:19999' };
    const n = fuzzIterations(400);
    for (let i = 0; i < n; i++) {
      const buf = randomAmpFrame();
      try {
        peer._handleFabricMessage(buf, origin, null);
      } catch (e) {
        assert.fail(`_handleFabricMessage threw: ${e && e.stack}`);
      }
    }
  });
});
