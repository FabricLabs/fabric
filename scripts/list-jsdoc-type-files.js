#!/usr/bin/env node
// Lists types paths for JSDoc tooling; omits legacy/experimental modules from API.md and docs/.
'use strict';

const fs = require('fs');
const path = require('path');

const typesDir = path.join(__dirname, '..', 'types');
const skip = new Set();
const recursive = process.argv.includes('--recursive');

function walk (dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? path.join(base, ent.name) : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walk(full, rel));
    } else if (ent.name.endsWith('.js') && !skip.has(ent.name)) {
      out.push(path.join('types', rel));
    }
  }
  return out;
}

function topLevelOnly () {
  return fs.readdirSync(typesDir)
    .filter((f) => f.endsWith('.js') && !skip.has(f))
    .map((f) => path.join('types', f));
}

const files = recursive ? walk(typesDir) : topLevelOnly();
process.stdout.write(files.sort().join(' '));
