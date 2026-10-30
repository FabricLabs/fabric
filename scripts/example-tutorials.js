'use strict';

/**
 * Run the offline tutorials. Each must exit 0 within 20 seconds.
 * Run: node scripts/example-tutorials.js
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIMIT_MS = 20000;
const FILES = [
  'examples/fabric-basic-usage.js',
  'examples/message-body.js',
  'examples/keys.js',
  'examples/passport.js',
  'examples/delegation.js',
  'examples/federation.js',
  'examples/sidechain.js',
  'examples/beacon-epoch.js',
  'examples/program.js',
  'examples/documents.js',
  'examples/coinjoin-fee.js',
  'examples/onion-forward.js',
  'examples/fabric-demo.js',
  'examples/index.js'
];

function run (file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, file)], {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ file, code: 'timeout' });
    }, LIMIT_MS);
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ file, code: code == null ? signal : code });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ file, code: error.message });
    });
  });
}

async function main () {
  let failed = 0;
  for (const file of FILES) {
    const result = await run(file);
    const ok = result.code === 0;
    console.log(ok ? 'ok' : 'FAIL', file, ok ? '' : result.code);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error('[EXAMPLES]', failed, 'tutorial(s) failed');
    process.exitCode = 1;
  }
}

main();
