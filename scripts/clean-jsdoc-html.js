#!/usr/bin/env node
/**
 * Reset JSDoc output under docs/ before `jsdoc` runs.
 *
 * JSDoc does not delete old outputs; without this, removed types leave stale
 * HTML and duplicate template assets (fonts, scripts, styles) accumulate in
 * git and on sites that publish _book/ + docs/ (e.g. dev.fabric.pub).
 *
 * Preserves curated **Markdown** under docs/ (e.g. README, PRODUCTION.md).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, '..', 'docs');

const JSDOC_ASSET_DIRS = ['fonts', 'scripts', 'styles', 'public'];

function walkRemoveHtml (dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkRemoveHtml(full);
    } else if (ent.name.endsWith('.html')) {
      fs.unlinkSync(full);
    }
  }
}

if (!fs.existsSync(docsDir)) {
  process.exit(0);
}

for (const sub of JSDOC_ASSET_DIRS) {
  const p = path.join(docsDir, sub);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

walkRemoveHtml(docsDir);
