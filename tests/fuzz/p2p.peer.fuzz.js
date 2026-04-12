'use strict';

const assert = require('assert');
const Peer = require('../../types/peer');
const { randomAmpFrame, fuzzIterations } = require('./helpers');
const { offlinePeerSettings } = require('../helpers/peer');

describe('fuzz: Peer._handleFabricMessage', function () {
  this.timeout(120000);

  it('does not throw on random frames (origin set; debug off)', function () {
    const peer = new Peer(offlinePeerSettings());
    const origins = [
      { name: '127.0.0.1:19999' },
      null,
      undefined,
      {},
      { name: undefined }
    ];
    const n = fuzzIterations(400);
    for (let i = 0; i < n; i++) {
      const buf = randomAmpFrame();
      const origin = origins[i % origins.length];
      try {
        peer._handleFabricMessage(buf, origin, null);
      } catch (e) {
        assert.fail(`_handleFabricMessage threw: ${e && e.stack}`);
      }
    }
  });
});
