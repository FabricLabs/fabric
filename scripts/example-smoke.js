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
for (const rel of scripts) {
  console.log('\n===', rel, '===');
  const result = spawnSync(process.execPath, [path.join(root, rel)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    failed += 1;
    console.error('[example-smoke] FAILED', rel, 'exit', result.status);
  }
}

if (failed) {
  console.error(`[example-smoke] ${failed}/${scripts.length} failed`);
  process.exit(1);
}
console.log(`\n[example-smoke] ok — ${scripts.length} demos`);
