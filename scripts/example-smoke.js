'use strict';

/**
 * Run curated flagship examples back-to-back (CI / local smoke).
 * Usage: node scripts/example-smoke.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const scripts = [
  'examples/fabric-basic-usage.js',
  'examples/fabric-demo.js',
  'examples/fabric-chat-app.js',
  'examples/onion-forward.js',
  'examples/message.js'
];

let failed = 0;
const TIMEOUT_MS = Number(process.env.FABRIC_EXAMPLE_TIMEOUT_MS || 60000);
for (const rel of scripts) {
  console.log('\n===', rel, '===');
  const result = spawnSync(process.execPath, [path.join(root, rel)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL'
  });
  if (result.status !== 0) {
    failed += 1;
    const reason = result.error ? result.error.message : `signal ${result.signal}`;
    console.error('[example-smoke] FAILED', rel, 'exit', result.status, '-', reason);
  }
}

if (failed) {
  console.error(`[example-smoke] ${failed}/${scripts.length} failed`);
  process.exit(1);
}
console.log(`\n[example-smoke] ok — ${scripts.length} demos`);
