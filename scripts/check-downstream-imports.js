#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Check that every `@fabric/core/<path>` import in the sibling
 * repositories still resolves in this checkout, so a move or removal here is
 * caught before a downstream pin bump.
 *
 * Usage: `node scripts/check-downstream-imports.js [dir …] [--json]`
 * Repositories default to the siblings in `DEFAULT_REPOS` (missing ones are
 * skipped), or `FABRIC_DOWNSTREAM` (comma list of paths). Exits 1 when an
 * import does not resolve.
 */

const fs = require('fs');
const path = require('path');

const CORE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPOS = Object.freeze([
  'hub.fabric.pub',
  'fabric-http',
  'fabric-browser-extension',
  'star-citizen-live',
  'goon.vc',
  'fabric-discord',
  'sensemaker'
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);
// Generated bundles, staged copies, and archives: their imports follow the sources.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'builds', 'assets', 'coverage', 'stores', 'reports',
  'bundles', 'vendor', 'libraries', 'release', 'out', 'android', 'android-www', 'ios',
  'backups'
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const IMPORT_PATTERN = /(?:require\s*\(\s*|import\s*\(\s*|\bfrom\s+|^\s*import\s+)['"`]@fabric\/core\/([A-Za-z0-9_@./-]+)['"`]/g;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

function listSources (dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) listSources(full, out);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith('.min.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Whether `@fabric/core/<subpath>` resolves in the core checkout at `root`.
 * @param {string} subpath
 * @param {string} [root]
 * @returns {boolean}
 */
function resolvesInCore (subpath, root = CORE_ROOT) {
  const base = path.join(root, subpath);
  if (!base.startsWith(root + path.sep)) return false;
  const candidates = [base, `${base}.js`, `${base}.json`, `${base}.mjs`, path.join(base, 'index.js')];
  return candidates.some((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch (_) {
      return false;
    }
  });
}

/**
 * Every `@fabric/core/<subpath>` import in one repository.
 * @param {string} repo directory
 * @returns {Array<{ file: string, line: number, subpath: string }>}
 */
function findImports (repo) {
  const found = [];
  for (const file of listSources(repo)) {
    let text;
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    if (!text.includes('@fabric/core/')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (COMMENT_LINE.test(lines[i])) continue;
      IMPORT_PATTERN.lastIndex = 0;
      let m;
      while ((m = IMPORT_PATTERN.exec(lines[i])) !== null) {
        found.push({ file: path.relative(repo, file), line: i + 1, subpath: m[1].replace(/\/$/, '') });
      }
    }
  }
  return found;
}

/**
 * @param {string[]} repos directories
 * @param {string} [root] core checkout
 * @returns {{ repos: object[], missing: object[] }}
 */
function checkDownstream (repos, root = CORE_ROOT) {
  const report = { repos: [], missing: [] };
  for (const repo of repos) {
    const imports = findImports(repo);
    const name = path.basename(repo);
    const paths = new Set(imports.map((i) => i.subpath));
    report.repos.push({ name, imports: imports.length, paths: paths.size });
    for (const imp of imports) {
      if (!resolvesInCore(imp.subpath, root)) report.missing.push(Object.assign({ repo: name }, imp));
    }
  }
  return report;
}

function defaultRepos () {
  if (process.env.FABRIC_DOWNSTREAM) {
    return process.env.FABRIC_DOWNSTREAM.split(',').map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  }
  return DEFAULT_REPOS.map((name) => path.resolve(CORE_ROOT, '..', name));
}

function main (argv) {
  const json = argv.includes('--json');
  const dirs = argv.filter((a) => !a.startsWith('--'));
  const repos = (dirs.length ? dirs.map((d) => path.resolve(d)) : defaultRepos())
    .filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
  const report = checkDownstream(repos);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const r of report.repos) console.log(`${r.name}: ${r.imports} imports of ${r.paths} core paths`);
    if (!report.missing.length) {
      console.log('All downstream @fabric/core imports resolve.');
    } else {
      console.log(`\n${report.missing.length} imports do not resolve in this checkout:`);
      for (const m of report.missing) console.log(`  ${m.repo}/${m.file}:${m.line}  @fabric/core/${m.subpath}`);
    }
  }
  return report.missing.length ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { checkDownstream, findImports, resolvesInCore, DEFAULT_REPOS };
