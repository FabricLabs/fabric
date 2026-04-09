'use strict';

/**
 * Optional node-gyp build for `fabric.node` (Noise, secp256k1, libwally, etc.).
 *
 * - **FABRIC_SKIP_NODE_GYP=1**: skip rebuild entirely (fastest; no compiler).
 * - **FABRIC_REQUIRE_NODE_GYP=1**: fail install if rebuild fails (CI / strict).
 * - Default: attempt rebuild; on failure warn and exit 0 so `npm install` succeeds
 *   without system libs; JS uses fallbacks unless FABRIC_NATIVE_* opts in.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function shouldSkip () {
  const v = process.env.FABRIC_SKIP_NODE_GYP;
  return v === '1' || v === 'true';
}

function shouldRequireNativeBuild () {
  const v = process.env.FABRIC_REQUIRE_NODE_GYP;
  return v === '1' || v === 'true';
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
      '[@fabric/core] Continuing without native addon. JS fallbacks remain available. ' +
      'Set FABRIC_REQUIRE_NODE_GYP=1 to fail install when native build is unavailable.'
  );
  process.exit(0);
}

if (shouldSkip()) {
  console.warn(
    '[@fabric/core] Skipping node-gyp rebuild (FABRIC_SKIP_NODE_GYP). ' +
      'Without build/Release/fabric.node, optional FABRIC_NATIVE_* paths need a local build or FABRIC_ADDON_PATH.'
  );
  process.exit(0);
}

let nodeGypJs;
try {
  nodeGypJs = require.resolve('node-gyp/bin/node-gyp.js', { paths: [root] });
} catch {
  failOrWarn('[@fabric/core] node-gyp not found; run npm install from the package root.');
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
