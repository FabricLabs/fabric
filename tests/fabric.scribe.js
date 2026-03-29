'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const Scribe = require('../types/scribe');

describe('@fabric/core/types/scribe', function () {
  it('start open commit stop lifecycle', async function () {
    const s = new Scribe({ path: './stores/test-scribe', verbosity: 0 });
    await s.start();
    assert.strictEqual(s.status, 'started');
    await s.stop();
    assert.strictEqual(s.status, 'stopped');
  });

  it('log emits info', function (done) {
    const s = new Scribe({ verbosity: 0 });
    s.once('info', (payload) => {
      assert.ok(Array.isArray(payload));
      done();
    });
    s.log('ping');
  });

  it('error emits error channel', function (done) {
    const s = new Scribe({ verbose: false });
    s.once('error', () => done());
    s.error('e');
  });

  it('warn emits warning channel', function (done) {
    const s = new Scribe({ verbose: false });
    s.once('warning', () => done());
    s.warn('w');
  });

  it('debug emits debug channel', function (done) {
    const s = new Scribe({ verbose: false });
    s.once('debug', () => done());
    s.debug('d');
  });

  it('trust wires source listeners', function () {
    const s = new Scribe({ verbosity: 0 });
    const src = new EventEmitter();
    assert.strictEqual(s.trust(src), s);
  });

  it('sha256 helper returns hex digest', function () {
    const s = new Scribe({});
    assert.strictEqual(s.sha256('abc'), require('crypto').createHash('sha256').update('abc').digest('hex'));
  });
});
