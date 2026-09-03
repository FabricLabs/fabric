'use strict';

const assert = require('assert');
const { describe, it } = require('mocha');

const noise = require('../functions/noiseProtocolStream');

function waitMs (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor (predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await waitMs(25);
  }
  return predicate();
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

  it('does not restore a freed native pointer when verification resolves late', async function () {
    if (!noise.supported) this.skip();

    const beforeNative = noise.countNativeStreams();
    const pending = [];
    const session = (initiator) => noise({
      initiator,
      prologue: Buffer.from('FABRIC'),
      // Hold the decision so the session can be torn down mid-verification.
      verify: (localPrivateKey, localPublicKey, remotePublicKey, done) => pending.push(done)
    });

    const a = session(true);
    const b = session(false);
    const duplexes = [a.encrypt, a.decrypt, b.encrypt, b.decrypt];
    let handshakes = 0;
    for (const duplex of duplexes) duplex.on('handshake', () => { handshakes++; });

    a.encrypt.pipe(b.decrypt);
    b.encrypt.pipe(a.decrypt);

    assert.ok(await waitFor(() => pending.length === 2), 'both sides reach HANDSHAKE_SPLIT');

    for (const duplex of duplexes) duplex.destroy();
    await waitMs(75);
    assert.strictEqual(noise.countNativeStreams(), beforeNative);

    // Accepting after teardown must not hand the freed pointer back to a duplex.
    for (const done of pending) done(null, true);
    await waitMs(75);

    for (const duplex of duplexes) assert.strictEqual(duplex._streamPtr, null);
    assert.strictEqual(handshakes, 0);
    assert.strictEqual(noise.countNativeStreams(), beforeNative);
  });
});
