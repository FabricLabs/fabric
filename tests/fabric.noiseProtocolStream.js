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

  function closedWithError (pair) {
    return new Promise((resolve) => {
      let error = null;
      pair.decrypt.on('error', (err) => { error = err; });
      pair.encrypt.on('error', () => {});
      pair.decrypt.once('close', () => resolve(error));
    });
  }

  it('rejects an oversize length prefix before allocating it', async function () {
    const pair = noise({ initiator: false, prologue: Buffer.from('FABRIC') });
    const closed = closedWithError(pair);
    const before = process.memoryUsage().arrayBuffers;
    // varint(512 MiB) followed by three body bytes: upstream allocates 512 MiB here.
    const prefix = Buffer.from([0x80, 0x80, 0x80, 0x80, 0x02]);
    pair.decrypt.write(Buffer.concat([prefix, Buffer.from([1, 2, 3])]));
    const err = await closed;
    const grown = process.memoryUsage().arrayBuffers - before;
    assert.ok(err && /noise_message_too_large/.test(err.message), `expected limit error, got ${err && err.message}`);
    assert.ok(grown < 16 * 1024 * 1024, `arrayBuffers grew ${grown} bytes`);
    assert.strictEqual(pair.encrypt.destroyed, true);
  });

  it('rejects a 65536-byte message even when it fits the varint prefix', async function () {
    const pair = noise({ initiator: false, prologue: Buffer.from('FABRIC') });
    const closed = closedWithError(pair);
    pair.decrypt.write(Buffer.from([0x80, 0x80, 0x04])); // varint(65536)
    const err = await closed;
    assert.ok(err && /noise_message_too_large/.test(err.message));
  });

  it('enforces the pre-handshake byte budget', async function () {
    const pair = noise({ initiator: false, prologue: Buffer.from('FABRIC'), handshakeMaxBytes: 1024 });
    const closed = closedWithError(pair);
    // Two well-formed 600-byte length-prefixed messages: under the frame limit, over the budget.
    const msg = Buffer.concat([Buffer.from([0xd8, 0x04]), Buffer.alloc(600, 7)]);
    pair.decrypt.write(msg);
    pair.decrypt.write(msg);
    const err = await closed;
    assert.ok(err && /noise_handshake_budget/.test(err.message), `expected budget error, got ${err && err.message}`);
  });

  it('destroys a session whose handshake does not finish in handshakeTimeout', async function () {
    const pair = noise({ initiator: false, prologue: Buffer.from('FABRIC'), handshakeTimeout: 150 });
    const closed = closedWithError(pair);
    const started = Date.now();
    const err = await closed;
    assert.ok(err && /noise_handshake_timeout/.test(err.message));
    assert.ok(Date.now() - started < 5000);
  });

  it('completes a handshake under the limits and carries a full-size AMP frame', async function () {
    if (!noise.supported) this.skip();
    const { MAX_FRAME_BYTES } = require('../constants');
    const a = noise({ initiator: true, prologue: Buffer.from('FABRIC'), handshakeTimeout: 5000 });
    const b = noise({ initiator: false, prologue: Buffer.from('FABRIC'), handshakeTimeout: 5000 });
    a.encrypt.pipe(b.decrypt);
    b.encrypt.pipe(a.decrypt);
    const frame = Buffer.alloc(MAX_FRAME_BYTES, 0x5a);
    const received = new Promise((resolve) => {
      const chunks = [];
      let total = 0;
      b.decrypt.on('data', (data) => {
        chunks.push(data);
        total += data.length;
        if (total >= frame.length) resolve(Buffer.concat(chunks));
      });
    });
    await new Promise((resolve) => a.encrypt.once('handshake', resolve));
    a.encrypt.write(frame);
    const got = await received;
    assert.ok(got.equals(frame));
    for (const d of [a.encrypt, a.decrypt, b.encrypt, b.decrypt]) d.destroy();
  });
});
