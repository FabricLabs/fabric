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

    it('trust forwards transaction events to log hooks', function (done) {
      const s = new State({ verbosity: 0, content: {}, target: '/' });
      const src = new EventEmitter();
      s.trust(src);
      s.once('info', (parts) => {
        assert.ok(parts.some((p) => String(p).includes('TRANSACTION')));
        done();
      });
      src.emit('transaction', { id: 'tx1' });
    });

    it('inherits appends peer namespace to tags', function () {
      const a = new State({ namespace: 'peer/ns', tags: [], content: {}, target: '/' });
      const b = new State({ tags: [], content: {}, target: '/' });
      assert.strictEqual(b.inherits(a), 1);
      assert.deepStrictEqual(b.settings.tags, ['peer/ns']);
    });

    it('fromJSON logs parse failures and returns null', function () {
      const prev = console.error;
      let called = false;
      console.error = (...args) => {
        called = true;
        assert.ok(args.some((x) => String(x).includes('Failure')));
      };
      try {
        assert.strictEqual(State.fromJSON('{"bad":'), null);
        assert.strictEqual(called, true);
      } finally {
        console.error = prev;
      }
    });

    it('error warn debug hit console when verbose', function () {
      const errs = [];
      const warns = [];
      const deb = [];
      const prevE = console.error;
      const prevW = console.warn;
      const prevD = console.debug;
      console.error = (...a) => errs.push(a.join(' '));
      console.warn = (...a) => warns.push(a.join(' '));
      console.debug = (...a) => deb.push(a.join(' '));
      try {
        const s = new State({ verbose: true, content: {}, target: '/' });
        s.on('error', () => {});
        s.on('warning', () => {});
        s.on('debug', () => {});
        s.error('e1');
        s.warn('w1');
        s.debug('d1');
        assert.ok(errs.some((x) => x.includes('e1')));
        assert.ok(warns.some((x) => x.includes('w1')));
        assert.ok(deb.some((x) => x.includes('d1')));
      } finally {
        console.error = prevE;
        console.warn = prevW;
        console.debug = prevD;
      }
    });

    it('sha256 helper returns hex digest', function () {
      const s = new State({ content: {}, target: '/' });
      assert.strictEqual(s.sha256('abc'), require('crypto').createHash('sha256').update('abc').digest('hex'));
    });
  });
});
