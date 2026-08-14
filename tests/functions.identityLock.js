'use strict';

const assert = require('assert');
const {
  IdentityLock,
  clampLockTimeoutMinutes,
  lockTimeoutMinutesToMs,
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  MAX_LOCK_TIMEOUT_MINUTES
} = require('../functions/identityLock');

function fakeClock () {
  let now = 1_000_000;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => now,
    advance (ms) {
      now += ms;
      for (const [id, t] of [...timers.entries()]) {
        if (t.fireAt <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    setTimeout (fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, fireAt: now + ms });
      return id;
    },
    clearTimeout (id) {
      timers.delete(id);
    }
  };
}

describe('@fabric/core/functions/identityLock', function () {
  it('clamps timeout minutes (0 disables)', function () {
    assert.strictEqual(clampLockTimeoutMinutes(0), 0);
    assert.strictEqual(clampLockTimeoutMinutes(-3), DEFAULT_LOCK_TIMEOUT_MINUTES);
    assert.strictEqual(clampLockTimeoutMinutes(99999), MAX_LOCK_TIMEOUT_MINUTES);
    assert.strictEqual(lockTimeoutMinutesToMs(0), 0);
    assert.strictEqual(lockTimeoutMinutesToMs(1), 60 * 1000);
  });

  it('holds a payload only while unlocked', function () {
    const lock = new IdentityLock({ timeoutMinutes: 0 });
    assert.strictEqual(lock.locked, true);
    lock.unlock({ xprv: 'secret' });
    assert.strictEqual(lock.locked, false);
    assert.deepStrictEqual(lock.peek(), { xprv: 'secret' });
    lock.lock();
    assert.strictEqual(lock.locked, true);
    assert.strictEqual(lock.peek(), null);
  });

  it('auto-locks after idle timeout and resets on touch', function () {
    const clock = fakeClock();
    const lock = new IdentityLock({
      timeoutMs: 50,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout
    });
    const events = [];
    lock.on('lock', () => events.push('lock'));
    lock.on('unlock', () => events.push('unlock'));
    lock.on('touch', () => events.push('touch'));

    lock.unlock({ ok: true });
    clock.advance(40);
    assert.strictEqual(lock.locked, false);
    lock.touch();
    clock.advance(40);
    assert.strictEqual(lock.locked, false, 'touch should reset the idle timer');
    clock.advance(20);
    assert.strictEqual(lock.locked, true);
    assert.deepStrictEqual(events, ['unlock', 'touch', 'lock']);
  });

  it('setTimeoutMinutes(0) disables auto-lock', function () {
    const clock = fakeClock();
    const lock = new IdentityLock({
      timeoutMs: 10,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout
    });
    lock.unlock({ ok: true });
    lock.setTimeoutMinutes(0);
    clock.advance(1000);
    assert.strictEqual(lock.locked, false);
    assert.strictEqual(lock.timeoutMinutes, 0);
  });
});
