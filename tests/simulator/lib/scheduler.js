'use strict';

/**
 * Weighted random action scheduler.
 */

class ActionScheduler {
  /**
   * @param {object} opts
   * @param {Array<{ name: string, weight: number, run: Function }>} opts.actions
   * @param {*} opts.rng
   * @param {import('./metrics').Metrics} opts.metrics
   * @param {number} [opts.steps=40]
   * @param {number} [opts.yieldEvery=8]
   */
  constructor (opts) {
    this.actions = (opts.actions || []).filter((a) => a && a.weight > 0 && typeof a.run === 'function');
    this.rng = opts.rng;
    this.metrics = opts.metrics;
    this.steps = Math.max(1, Number(opts.steps) || 40);
    this.yieldEvery = opts.yieldEvery != null ? Number(opts.yieldEvery) : 8;
    this._totalWeight = this.actions.reduce((s, a) => s + a.weight, 0);
  }

  pick () {
    if (!this.actions.length || this._totalWeight <= 0) return null;
    let r = this.rng.next() * this._totalWeight;
    for (const a of this.actions) {
      r -= a.weight;
      if (r < 0) return a;
    }
    return this.actions[this.actions.length - 1];
  }

  /**
   * @param {object} ctx network + shared state
   */
  async run (ctx) {
    for (let i = 0; i < this.steps; i++) {
      const action = this.pick();
      if (!action) break;
      const t0 = Date.now();
      try {
        await action.run(ctx, this.rng);
        this.metrics.recordAction(action.name, Date.now() - t0);
      } catch (err) {
        this.metrics.recordHardError({
          action: action.name,
          msg: err && (err.message || String(err))
        });
        this.metrics.recordAction(action.name, Date.now() - t0);
      }
      if (ctx.network) {
        this.metrics.observeConnections(ctx.network.connectionCount());
      }
      if (this.yieldEvery > 0 && ((i + 1) % this.yieldEvery) === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }
  }
}

module.exports = { ActionScheduler };
