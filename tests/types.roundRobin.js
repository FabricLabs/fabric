'use strict';

const assert = require('assert');
const Actor = require('../types/actor');
const Circuit = require('../types/circuit');
const RoundRobin = require('../types/roundRobin');

describe('@fabric/core/types/roundRobin', function () {
  it('extends Circuit (and Actor)', function () {
    const rr = new RoundRobin();
    assert.ok(rr instanceof RoundRobin);
    assert.ok(rr instanceof Circuit);
    assert.ok(rr instanceof Actor);
  });

  it('defaults name to RoundRobin', function () {
    const rr = new RoundRobin();
    assert.strictEqual(rr.settings.name, 'RoundRobin');
  });

  it('merges config over defaults', function () {
    const rr = new RoundRobin({ name: 'Pool-A' });
    assert.strictEqual(rr.settings.name, 'Pool-A');
  });

  it('next returns null for empty list', function () {
    const rr = new RoundRobin();
    assert.strictEqual(rr.next([]), null);
    assert.strictEqual(rr.next(), null);
  });

  it('next returns the sole element repeatedly', function () {
    const rr = new RoundRobin();
    assert.strictEqual(rr.next(['only']), 'only');
    assert.strictEqual(rr.next(['only']), 'only');
  });

  it('next walks items in order and wraps', function () {
    const rr = new RoundRobin();
    const pool = ['a', 'b', 'c'];
    assert.strictEqual(rr.next(pool), 'a');
    assert.strictEqual(rr.next(pool), 'b');
    assert.strictEqual(rr.next(pool), 'c');
    assert.strictEqual(rr.next(pool), 'a');
    assert.strictEqual(rr.next(pool), 'b');
  });

  it('next uses independent index per instance', function () {
    const a = new RoundRobin();
    const b = new RoundRobin();
    const pool = ['x', 'y'];
    assert.strictEqual(a.next(pool), 'x');
    assert.strictEqual(b.next(pool), 'x');
    assert.strictEqual(a.next(pool), 'y');
    assert.strictEqual(b.next(pool), 'y');
  });

  it('next handles pool length change without throwing', function () {
    const rr = new RoundRobin();
    assert.strictEqual(rr.next(['p', 'q', 'r']), 'p');
    assert.strictEqual(rr.next(['p', 'q']), 'q');
    assert.strictEqual(rr.next(['solo']), 'solo');
  });
});
