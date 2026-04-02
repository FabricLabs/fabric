'use strict';

const assert = require('assert');
const { runAll, getScenarios, formatConsoleTable, buildReportPayload } = require('../../scripts/benchmark-lib');

describe('benchmark smoke', function () {
  this.timeout(120000);

  it('runs all scenarios with low multiplier without throwing', async function () {
    const rows = await runAll({ multiplier: 0.04 });
    assert.strictEqual(rows.length, getScenarios().length);
    for (const r of rows) {
      assert.ok(r.name && typeof r.ms === 'number');
      assert.ok(r.iterations >= 30);
      assert.ok(Number.isFinite(r.opsPerSec));
      assert.ok(r.ms >= 0);
    }
    void formatConsoleTable(rows);
    const payload = buildReportPayload(rows, { multiplier: 0.04 });
    assert.ok(payload.generatedAt);
    assert.ok(Array.isArray(payload.rows));
  });
});
