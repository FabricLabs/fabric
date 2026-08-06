'use strict';

/**
 * Optional node-gyp build for `fabric.node` (Noise, secp256k1, libwally, etc.).
 *
 * **Default (npm install):** do **not** compile the C addon. `@fabric/core` 0.1.0
 * treats the **JavaScript** Message/Peer path as the canonical protocol. C sources
 * remain in-tree for optional local builds (`npm run build:c`).
 *
 * Opt-in native rebuild:
 * - **FABRIC_BUILD_NATIVE=1** — attempt `node-gyp rebuild`; warn and continue on failure
 * - **FABRIC_REQUIRE_NODE_GYP=1** — attempt rebuild and **fail** install on error
 *
 * Legacy: **FABRIC_SKIP_NODE_GYP=1** still skips (no-op with the new default).
 */

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function envFlag (name) {
  const v = process.env[name];
  return v === '1' || v === 'true';
}

function shouldBuildNative () {
  return envFlag('FABRIC_BUILD_NATIVE') || envFlag('FABRIC_REQUIRE_NODE_GYP');
}

function shouldRequireNativeBuild () {
  return envFlag('FABRIC_REQUIRE_NODE_GYP');
}

function failOrWarn (message, err) {
  if (shouldRequireNativeBuild()) {
    if (err) console.error(err);
    console.error(message);
    process.exit(1);
  }
  if (err) console.warn(err);
  console.warn(
    `${message}\n` +
      '[@fabric/core] Continuing without native addon. JS protocol path remains available. ' +
      'Set FABRIC_REQUIRE_NODE_GYP=1 to fail install when a native build is required.'
  );
  process.exit(0);
}

if (!shouldBuildNative()) {
  console.log(
    '[@fabric/core] Skipping native addon build (JS is the canonical protocol). ' +
      'Optional: FABRIC_BUILD_NATIVE=1 or npm run build:c'
  );
  process.exit(0);
}

let nodeGypJs;
try {
  nodeGypJs = require.resolve('node-gyp/bin/node-gyp.js', { paths: [root] });
} catch (err) {
  failOrWarn('[@fabric/core] node-gyp not found; run npm install from the package root.', err);
}

const r = spawnSync(process.execPath, [nodeGypJs, 'rebuild'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

if (r.error) {
  failOrWarn('[@fabric/core] node-gyp failed to execute.', r.error);
}
if (r.status !== 0) {
  failOrWarn(`[@fabric/core] node-gyp rebuild failed with exit code ${r.status === null ? 'null' : r.status}.`);
}

process.exit(0);
