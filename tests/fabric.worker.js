'use strict';

const assert = require('assert');
const Worker = require('../types/worker');

describe('@fabric/core/types/worker', function () {
  let _log;
  before(function () {
    _log = console.log;
    console.log = function () {};
  });
  after(function () {
    console.log = _log;
  });

  describe('Worker', function () {
    it('is a constructor with machine and router', function () {
      const w = new Worker();
      assert.ok(w.machine);
      assert.ok(w.router);
      assert.strictEqual(typeof w.compute, 'function');
    });

    it('use delegates to router.use', function () {
      const w = new Worker();
      let called = false;
      w.router.use = (def) => { called = true; return 'ok'; };
      assert.strictEqual(w.use({ x: 1 }), 'ok');
      assert.strictEqual(called, true);
    });

    it('compute returns machine result and emits pong on PING input', async function () {
      const w = new Worker();
      let pong = false;
      w.on('pong', () => { pong = true; });
      const out = await w.compute('PING');
      assert.strictEqual(out, w.machine);
      assert.strictEqual(pong, true);
    });

    it('route default branch awaits compute (no return value)', async function () {
      const w = new Worker();
      const clockBefore = w.machine.clock;
      const out = await w.route('any-path');
      assert.strictEqual(out, undefined);
      assert.ok(w.machine.clock > clockBefore);
    });
  });
});
