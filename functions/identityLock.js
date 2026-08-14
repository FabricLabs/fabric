'use strict';

/**
 * In-memory identity / wallet lock session.
 *
 * Holds secret material only while unlocked. Auto-relock after an idle
 * timeout (Hub IdentityManager default: 30 minutes; 0 disables). Used by
 * `fabric setup`, the shell (`/unlock` `/lock`), and any consumer that
 * should not keep xprv/seed in RAM indefinitely.
 *
 * @fileoverview Generic lock / unlock / idle-timeout session for secret material.
 * @module functions/identityLock
 */

const EventEmitter = require('events');

const DEFAULT_LOCK_TIMEOUT_MINUTES = 30;
const MIN_LOCK_TIMEOUT_MINUTES = 1;
const MAX_LOCK_TIMEOUT_MINUTES = 24 * 60;

/**
 * @param {number} minutes
 * @returns {number} Clamped minutes (0 disables).
 */
function clampLockTimeoutMinutes (minutes) {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LOCK_TIMEOUT_MINUTES;
  if (n === 0) return 0;
  return Math.min(MAX_LOCK_TIMEOUT_MINUTES, Math.max(MIN_LOCK_TIMEOUT_MINUTES, n));
}

/**
 * @param {number} minutes
 * @returns {number}
 */
function lockTimeoutMinutesToMs (minutes) {
  const n = clampLockTimeoutMinutes(minutes);
  if (!n) return 0;
  return n * 60 * 1000;
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMinutes]
 * @param {number} [opts.timeoutMs] Test override (takes precedence when set).
 * @param {Function} [opts.now]
 * @param {Function} [opts.setTimeout]
 * @param {Function} [opts.clearTimeout]
 * @class IdentityLock
 */
class IdentityLock extends EventEmitter {
  constructor (opts = {}) {
    super();
    this._now = typeof opts.now === 'function' ? opts.now : Date.now;
    this._setTimeout = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
    this._clearTimeout = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
    this._timeoutMinutes = clampLockTimeoutMinutes(
      opts.timeoutMinutes != null ? opts.timeoutMinutes : DEFAULT_LOCK_TIMEOUT_MINUTES
    );
    if (Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0) {
      this._timeoutMsOverride = opts.timeoutMs;
    } else {
      this._timeoutMsOverride = null;
    }
    this._payload = null;
    this._unlockedAt = 0;
    this._timer = null;
  }

  get locked () {
    return this._payload == null;
  }

  get timeoutMinutes () {
    return this._timeoutMinutes;
  }

  get timeoutMs () {
    if (this._timeoutMsOverride != null) return this._timeoutMsOverride;
    return lockTimeoutMinutesToMs(this._timeoutMinutes);
  }

  /**
   * @returns {{ locked: boolean, timeoutMinutes: number, unlockedAt: number, remainingMs: number|null }}
   */
  snapshot () {
    const locked = this.locked;
    let remainingMs = null;
    if (!locked && this.timeoutMs > 0 && this._unlockedAt) {
      remainingMs = Math.max(0, this.timeoutMs - (this._now() - this._unlockedAt));
    }
    return {
      locked,
      timeoutMinutes: this._timeoutMinutes,
      unlockedAt: locked ? 0 : this._unlockedAt,
      remainingMs
    };
  }

  /**
   * @param {*} payload Secret material held only while unlocked.
   * @returns {IdentityLock}
   */
  unlock (payload) {
    if (payload == null) throw new Error('Unlock payload is required.');
    this._payload = payload;
    this._unlockedAt = this._now();
    this._arm();
    this.emit('unlock', this.snapshot());
    return this;
  }

  /**
   * Drop secret material and cancel the idle timer.
   * @returns {IdentityLock}
   */
  lock () {
    const wasUnlocked = !this.locked;
    this._payload = null;
    this._unlockedAt = 0;
    this._disarm();
    if (wasUnlocked) this.emit('lock', this.snapshot());
    return this;
  }

  /**
   * Reset the idle timer while unlocked (keystroke / command).
   * @returns {IdentityLock}
   */
  touch () {
    if (this.locked) return this;
    this._unlockedAt = this._now();
    this._arm();
    this.emit('touch', this.snapshot());
    return this;
  }

  /**
   * @returns {*} Current payload, or null when locked.
   */
  peek () {
    return this._payload;
  }

  /**
   * @param {number} minutes 0 disables auto-lock.
   * @returns {IdentityLock}
   */
  setTimeoutMinutes (minutes) {
    this._timeoutMinutes = clampLockTimeoutMinutes(minutes);
    this._timeoutMsOverride = null;
    if (!this.locked) this._arm();
    this.emit('timeout', this.snapshot());
    return this;
  }

  /**
   * @private
   */
  _disarm () {
    if (this._timer != null) {
      this._clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * @private
   */
  _arm () {
    this._disarm();
    const ms = this.timeoutMs;
    if (!ms || this.locked) return;
    this._timer = this._setTimeout(() => {
      this._timer = null;
      this.lock();
    }, ms);
  }
}

module.exports = {
  IdentityLock,
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  MIN_LOCK_TIMEOUT_MINUTES,
  MAX_LOCK_TIMEOUT_MINUTES,
  clampLockTimeoutMinutes,
  lockTimeoutMinutesToMs
};
