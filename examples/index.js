'use strict';

if (process.argv.includes('--smoke')) {
  const { spawnSync } = require('child_process');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const scripts = [
    'examples/fabric-basic-usage.js',
    'examples/fabric-demo.js',
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
  process.exit(0);
}

// # Examples with Fabric
// Fabric is like an operating system for the distributed web.  It manages
// application state, storage, and network interactions behind the scenes while
// providing your application with a convenient event-oriented interface.
//
// We use [strict mode](https://developer.mozilla.org/en-us/docs/Web/JavaScript/Reference/Strict_mode) to improve error handling and debugging, so we recommend you do the same.

// ## Importing Fabric
// Fabric is easily imported into existing applications.  When using JavaScript,
// use the `require` semantic to import as a library.
const Fabric = require('../');

// Most interactions with Fabric are asynchronous, so let's define our program's
// primary behavior.
async function main () {
  // 1. Create an instance of Fabric...
  const app = new Fabric();

  // 2. Add some state with a deterministic in-memory path.
  await app._SET('/examples/index/message', { input: 'Hello, world!' });
  const stored = await app._GET('/examples/index/message');

  // 3. Output some results without dumping the full object graph.
  console.log('[EXAMPLES:INDEX]', 'id:', app.id);
  console.log('[EXAMPLES:INDEX]', 'clock:', app.clock);
  console.log('[EXAMPLES:INDEX]', 'stored:', stored);
}

main().catch((exception) => {
  console.error('[EXAMPLES:INDEX]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
// Now that we've defined our program, let's run it to see the results.

// ### Next Steps
// That's all there is to it!  Now browse the [examples home](index.html) or the
// [API Explorer](https://dev.fabric.pub/docs).
