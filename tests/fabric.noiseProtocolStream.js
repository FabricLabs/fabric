'use strict';

const assert = require('assert');
const { describe, it } = require('mocha');

const noise = require('../functions/noiseProtocolStream');

function waitMs (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('@fabric/core/functions/noiseProtocolStream', function () {
  this.timeout(15000);

  it('drops shared handshake listeners when encrypt/decrypt are destroyed', async function () {
    const before = noise.countHandshakeListeners();
    const beforeNative = noise.countNativeStreams();
    const sessions = [];
    for (let i = 0; i < 24; i++) {
      sessions.push(noise({
        initiator: i % 2 === 0,
        prologue: Buffer.from('FABRIC')
      }));
    }
    const mid = noise.countHandshakeListeners();
    assert.ok(mid.write >= before.write + 24, `write listeners ${mid.write} after 24 sessions (was ${before.write})`);
    assert.ok(mid.read >= before.read + 24);
    assert.ok(mid.split >= before.split + 24);

    for (const pair of sessions) {
      pair.encrypt.destroy();
      pair.decrypt.destroy();
    }
    await waitMs(75);
    const after = noise.countHandshakeListeners();
    assert.strictEqual(after.write, before.write);
    assert.strictEqual(after.read, before.read);
    assert.strictEqual(after.split, before.split);
    assert.strictEqual(noise.countNativeStreams(), beforeNative);
  });
});
