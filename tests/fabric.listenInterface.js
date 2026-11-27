'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveFabricPeerInterface
} = require('../functions/fabricListenInterface');

test('resolveFabricPeerInterface defaults to 0.0.0.0', () => {
  assert.equal(resolveFabricPeerInterface({ env: {} }), '0.0.0.0');
});

test('resolveFabricPeerInterface prefers FABRIC_INTERFACE', () => {
  assert.equal(resolveFabricPeerInterface({
    env: { FABRIC_INTERFACE: '65.21.231.149', FABRIC_PEER_INTERFACE: '1.2.3.4' },
    interface: '9.9.9.9'
  }), '65.21.231.149');
});

test('resolveFabricPeerInterface falls back to settings.interface', () => {
  assert.equal(resolveFabricPeerInterface({
    env: {},
    interface: '65.21.231.149'
  }), '65.21.231.149');
});
