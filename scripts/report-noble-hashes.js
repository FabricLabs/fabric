#!/usr/bin/env node
'use strict';

/**
 * Print `npm ls @noble/hashes` — quick check for duplicate versions in the tree.
 * See docs/CONSOLIDATION_PLAN.md item 2.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const r = spawnSync(npm, ['ls', '@noble/hashes'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exitCode = r.status === 0 ? 0 : (r.status || 1);
