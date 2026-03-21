#!/usr/bin/env node
/**
 * Remove top-level docs/*.html before `jsdoc` so removed types do not leave
 * stale pages or broken global nav links (JSDoc does not delete old outputs).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, '..', 'docs');

for (const name of fs.readdirSync(docsDir)) {
  if (!name.endsWith('.html')) continue;
  fs.unlinkSync(path.join(docsDir, name));
}
