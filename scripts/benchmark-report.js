#!/usr/bin/env node
'use strict';

/**
 * Print micro-benchmark throughput (ops/s, ns/op) and write JSON to reports/benchmark-latest.json.
 *
 * Env:
 *   BENCHMARK_MULTIPLIER — scale iteration counts (default 1; use 0.05 for a quick run)
 */

const fs = require('fs');
const path = require('path');
const { runAll, formatConsoleTable, buildReportPayload } = require('./benchmark-lib');

const REPORT = path.join(__dirname, '..', 'reports', 'benchmark-latest.json');

async function main () {
  const multiplier = Number(process.env.BENCHMARK_MULTIPLIER);
  const mult = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;

  const rows = await runAll({ multiplier: mult });
  const payload = buildReportPayload(rows, { multiplier: mult });

  console.log('[BENCHMARK] @fabric/core — expected performance (warmup + timed loop)');
  console.log(`[BENCHMARK] Node ${payload.node}  multiplier=${payload.multiplier}`);
  console.log(formatConsoleTable(rows));

  const dir = path.dirname(REPORT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[BENCHMARK] Wrote ${REPORT}`);
}

main().catch((err) => {
  console.error('[BENCHMARK] failed:', err);
  process.exitCode = 1;
});
