'use strict';

/**
 * Lightweight metrics collector for simulator runs.
 */

class Metrics {
  constructor () {
    this.startedAt = null;
    this.endedAt = null;
    this.actionsExecuted = 0;
    this.actionCounts = Object.create(null);
    this.events = Object.create(null);
    this.hardErrors = [];
    this.samples = {
      connectMs: [],
      actionMs: []
    };
    this.maxConnectionsObserved = 0;
    this.notes = [];
  }

  start () {
    this.startedAt = Date.now();
  }

  end () {
    this.endedAt = Date.now();
  }

  recordAction (name, durationMs = 0) {
    this.actionsExecuted += 1;
    this.actionCounts[name] = (this.actionCounts[name] || 0) + 1;
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.samples.actionMs.push(durationMs);
    }
  }

  recordEvent (name, n = 1) {
    this.events[name] = (this.events[name] || 0) + n;
  }

  recordConnectMs (ms) {
    if (Number.isFinite(ms) && ms >= 0) this.samples.connectMs.push(ms);
  }

  recordHardError (entry) {
    this.hardErrors.push(entry);
  }

  note (msg) {
    this.notes.push(String(msg));
  }

  observeConnections (count) {
    if (count > this.maxConnectionsObserved) this.maxConnectionsObserved = count;
  }

  /**
   * @param {number[]} values
   * @param {number} p percentile 0..100
   */
  static percentile (values, p) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  toReport (extra = {}) {
    const elapsedMs = (this.endedAt != null && this.startedAt != null)
      ? (this.endedAt - this.startedAt)
      : null;
    const actionsPerSec = (elapsedMs && elapsedMs > 0)
      ? (this.actionsExecuted / (elapsedMs / 1000))
      : null;
    return {
      generatedAt: new Date().toISOString(),
      elapsedMs,
      actionsExecuted: this.actionsExecuted,
      actionsPerSec,
      actionCounts: { ...this.actionCounts },
      events: { ...this.events },
      hardErrors: this.hardErrors.slice(),
      maxConnectionsObserved: this.maxConnectionsObserved,
      connectMs: {
        n: this.samples.connectMs.length,
        median: Metrics.percentile(this.samples.connectMs, 50),
        p95: Metrics.percentile(this.samples.connectMs, 95)
      },
      actionMs: {
        n: this.samples.actionMs.length,
        median: Metrics.percentile(this.samples.actionMs, 50),
        p95: Metrics.percentile(this.samples.actionMs, 95)
      },
      notes: this.notes.slice(),
      ...extra
    };
  }
}

module.exports = { Metrics };
