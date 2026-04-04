'use strict';

/**
 * Optional node-gyp build for `fabric.node` (Noise, secp256k1, libwally, etc.).
 * CI and minimal environments set **FABRIC_SKIP_NODE_GYP=1** so `npm ci` succeeds
 * without system C headers; the JS stack and tests use fallbacks / mock addon paths.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function shouldSkip () {
  const v = process.env.FABRIC_SKIP_NODE_GYP;
  return v === '1' || v === 'true';
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
  console.error('[@fabric/core] node-gyp not found; run npm install from the package root.');
  process.exit(1);
}

const r = spawnSync(process.execPath, [nodeGypJs, 'rebuild'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

if (r.error) {
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
