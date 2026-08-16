'use strict';

const assert = require('assert');
const { describe, it } = require('mocha');
const {
  resolveFabricPeerInterface
} = require('../functions/fabricListenInterface');

describe('@fabric/core/functions/fabricListenInterface', function () {
  it('defaults to 0.0.0.0', function () {
    assert.strictEqual(resolveFabricPeerInterface({ env: {} }), '0.0.0.0');
  });

  it('prefers FABRIC_INTERFACE over FABRIC_PEER_INTERFACE and settings', function () {
    assert.strictEqual(resolveFabricPeerInterface({
      env: { FABRIC_INTERFACE: '65.21.231.149', FABRIC_PEER_INTERFACE: '1.2.3.4' },
      interface: '9.9.9.9'
    }), '65.21.231.149');
  });

  it('falls back to FABRIC_PEER_INTERFACE when FABRIC_INTERFACE is empty', function () {
    assert.strictEqual(resolveFabricPeerInterface({
      env: { FABRIC_INTERFACE: '  ', FABRIC_PEER_INTERFACE: '1.2.3.4' },
      interface: '9.9.9.9'
    }), '1.2.3.4');
  });

  it('falls back to settings.interface when env is unset', function () {
    assert.strictEqual(resolveFabricPeerInterface({
      env: {},
      interface: '65.21.231.149'
    }), '65.21.231.149');
  });

  it('accepts settings.host as an alias for interface', function () {
    assert.strictEqual(resolveFabricPeerInterface({
      env: {},
      host: '192.0.2.8'
    }), '192.0.2.8');
  });

  it('honours custom envKeys and explicit fallback', function () {
    assert.strictEqual(resolveFabricPeerInterface({
      env: { FABRIC_INTERFACE: '9.9.9.9', OTHER_BIND: '10.0.0.1' },
      envKeys: ['OTHER_BIND'],
      fallback: '127.0.0.1'
    }), '10.0.0.1');
    assert.strictEqual(resolveFabricPeerInterface({
      env: {},
      envKeys: ['OTHER_BIND'],
      fallback: '127.0.0.1'
    }), '127.0.0.1');
  });
});
