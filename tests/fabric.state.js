'use strict';

const Fabric = require('../');
const assert = require('assert');
const EventEmitter = require('events');
const State = require('../types/state');

const SAMPLE_DATA = {
  content: 'Hello, world!',
  target: '/messages'
};

describe('@fabric/core/types/state', function () {
  describe('State', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.State instanceof Function, true);
    });

    it('provides a stable "@id" attribute for equivalent input', function () {
      const a = new Fabric.State(SAMPLE_DATA);
      const b = new Fabric.State(SAMPLE_DATA);
      assert.ok(a.id);
      assert.strictEqual(a.id, b.id);
    });

    it('can serialize to a sane element', function () {
      const state = new Fabric.State(SAMPLE_DATA);
      const serialized = state.serialize(SAMPLE_DATA);
      assert.ok(state);
      assert.ok(serialized);
      assert.strictEqual(serialized.type, 'Buffer');
      assert.ok(Array.isArray(serialized.data));
      const decoded = Buffer.from(serialized.data).toString('utf8');
      assert.deepStrictEqual(JSON.parse(decoded), SAMPLE_DATA);
    });

    it('can deserialize from a string into a plain object', function () {
      const state = State.fromString(JSON.stringify(SAMPLE_DATA));
      assert.ok(state);
      assert.deepStrictEqual(state, SAMPLE_DATA);
    });

    it('start open commit stop lifecycle (formerly Scribe)', async function () {
      const s = new State({ path: './stores/test-state-scribe', verbosity: 0, content: {}, target: '/' });
      await s.start();
      assert.strictEqual(s.status, 'started');
      await s.stop();
      assert.strictEqual(s.status, 'stopped');
    });

    it('log emits info', function (done) {
      const s = new State({ verbosity: 3, content: {}, target: '/' });
      s.once('info', (payload) => {
        assert.ok(Array.isArray(payload));
        done();
      });
      s.log('ping');
    });

    it('error emits error channel', function (done) {
      const s = new State({ verbose: false, content: {}, target: '/' });
      s.once('error', () => done());
      s.error('e');
    });

    it('warn emits warning channel', function (done) {
      const s = new State({ verbose: false, content: {}, target: '/' });
      s.once('warning', () => done());
      s.warn('w');
    });

    it('debug emits debug channel', function (done) {
      const s = new State({ verbose: false, content: {}, target: '/' });
      s.once('debug', () => done());
      s.debug('d');
    });

    it('trust wires source listeners', function () {
      const s = new State({ verbosity: 0, content: {}, target: '/' });
      const src = new EventEmitter();
      assert.strictEqual(s.trust(src), s);
    });

    it('sha256 helper returns hex digest', function () {
      const s = new State({ content: {}, target: '/' });
      assert.strictEqual(s.sha256('abc'), require('crypto').createHash('sha256').update('abc').digest('hex'));
    });
  });
});
