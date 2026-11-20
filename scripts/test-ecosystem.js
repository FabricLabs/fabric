#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Run this package's tests, then the tests of each sibling
 * checkout that depends on it, one at a time, stopping at the first failure.
 *
 * Usage: `node scripts/test-ecosystem.js [dir …] [--ci] [--install]
 * [--from <repo>] [--no-bail] [--dry-run]`
 *
 * With no directories, a sibling checkout is included when its
 * `package.json` depends on this package.
 * `FABRIC_REPOS` (a comma-separated list of paths) replaces that discovery.
 * Order follows those declared dependencies. Each repository runs `npm test`
 * (`--ci`: `npm run ci` where that script exists), after `npm run
 * report:install` with `--install`. A test script that is a single mocha
 * command also gets `--bail`. `--from <repo>` resumes at that repository.
 * `FABRIC_TEST_TIMEOUT_MINUTES` (default 60) bounds each command.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CORE_ROOT = path.resolve(__dirname, '..');
const SINGLE_MOCHA = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*mocha\b[^&|;]*$/;

/**
 * This checkout, plus each sibling that declares a dependency on this
 * package. The names are read from those package.json files.
 * @param {string} [root]
 * @returns {Array<{ dir: string, pkg: object }>}
 */
function discoverRepos (root = CORE_ROOT) {
  const here = path.resolve(root);
  const self = readPackage(here);
  const found = [];
  if (self && self.name) found.push({ dir: here, pkg: self });
  const parent = path.dirname(here);
  let names = [];
  try {
    names = fs.readdirSync(parent);
  } catch (_) {
    names = [];
  }
  names.sort();
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const dir = path.resolve(parent, name);
    if (dir === here) continue;
    const pkg = readPackage(dir);
    if (!pkg || !pkg.name || !self || !self.name) continue;
    const deps = declaredDependencies(pkg);
    if (Object.prototype.hasOwnProperty.call(deps, self.name)) found.push({ dir, pkg });
  }
  return found;
}

function declaredDependencies (pkg) {
  return Object.assign({}, pkg && pkg.dependencies, pkg && pkg.devDependencies, pkg && pkg.peerDependencies, pkg && pkg.optionalDependencies);
}

function readPackage (dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Repositories ordered so each comes after every repository it depends on.
 * @param {Array<{ dir: string, pkg: object }>} repos in tie-break order
 * @returns {Array<{ dir: string, pkg: object, needs: string[] }>}
 */
function orderRepos (repos) {
  const byName = new Map(repos.map((r) => [r.pkg.name, r]));
  const nodes = repos.map((r) => {
    const deps = declaredDependencies(r.pkg);
    const needs = Object.keys(deps).filter((name) => name !== r.pkg.name && byName.has(name));
    return Object.assign({}, r, { needs: needs.map((name) => byName.get(name).dir) });
  });
  const done = new Set();
  const ordered = [];
  while (ordered.length < nodes.length) {
    const next = nodes.find((n) => !done.has(n.dir) && n.needs.every((d) => done.has(d)));
    if (!next) {
      const stuck = nodes.filter((n) => !done.has(n.dir)).map((n) => path.basename(n.dir));
      throw new Error(`Dependency cycle among: ${stuck.join(', ')}`);
    }
    done.add(next.dir);
    ordered.push(next);
  }
  return ordered;
}

/**
 * The npm arguments that test one repository, or null when it has no tests.
 * @param {object} pkg
 * @param {{ ci?: boolean, bail?: boolean }} [opts]
 * @returns {string[]|null}
 */
function testCommand (pkg, opts = {}) {
  const scripts = pkg.scripts || {};
  if (opts.ci && scripts.ci) return ['run', 'ci'];
  if (!scripts.test || /no test specified/.test(scripts.test)) return null;
  if (opts.bail !== false && SINGLE_MOCHA.test(scripts.test.trim())) return ['test', '--', '--bail'];
  return ['test'];
}

function defaultRepos () {
  if (process.env.FABRIC_REPOS) {
    return process.env.FABRIC_REPOS.split(',').map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  }
  return discoverRepos().map((repo) => repo.dir);
}

function parseArgs (argv) {
  const opts = { dirs: [], ci: false, install: false, bail: true, dryRun: false, from: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ci') opts.ci = true;
    else if (a === '--install') opts.install = true;
    else if (a === '--no-bail') opts.bail = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--from') opts.from = argv[++i];
    else if (a.startsWith('--from=')) opts.from = a.slice('--from='.length);
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else opts.dirs.push(path.resolve(a));
  }
  return opts;
}

function quoteArg (value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@+=,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command that reruns this process from a failed repository, keeping the
 * directories and flags of the run that failed.
 * @param {string} failedName
 * @param {{ dirs: string[], ci?: boolean, install?: boolean, bail?: boolean }} opts
 * @returns {string}
 */
function resumeCommand (failedName, opts) {
  const parts = ['node', 'scripts/test-ecosystem.js'];
  if (opts.ci) parts.push('--ci');
  if (opts.install) parts.push('--install');
  if (opts.bail === false) parts.push('--no-bail');
  for (const dir of opts.dirs || []) parts.push(quoteArg(dir));
  parts.push('--from', quoteArg(failedName));
  return parts.join(' ');
}

/**
 * @param {string[]} dirs
 * @param {boolean} explicit When true, a missing or nameless package.json is an error.
 * @returns {Array<{ dir: string, pkg: object }>}
 */
function selectRepos (dirs, explicit) {
  const repos = [];
  const invalid = [];
  for (const dir of dirs) {
    const pkg = readPackage(dir);
    if (!pkg || !pkg.name) {
      if (explicit) invalid.push(dir);
      continue;
    }
    repos.push({ dir, pkg });
  }
  if (invalid.length) throw new Error(`Invalid repository selection: ${invalid.join(', ')}`);
  return repos;
}

function npmLaunch (args) {
  if (process.platform !== 'win32') return { command: 'npm', args };
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) return { command: process.execPath, args: [cli].concat(args) };
  return { command: 'npm.cmd', args };
}

function run (dir, args, timeoutMs) {
  const started = Date.now();
  const launch = npmLaunch(args);
  const result = spawnSync(launch.command, launch.args, { cwd: dir, stdio: 'inherit', timeout: timeoutMs });
  const seconds = Math.round((Date.now() - started) / 1000);
  const ok = result.status === 0;
  let reason = null;
  if (result.error && result.error.code === 'ETIMEDOUT') reason = `timed out after ${Math.round(timeoutMs / 60000)} min`;
  else if (result.error) reason = result.error.message;
  else if (!ok) reason = result.signal ? `killed by ${result.signal}` : `exit ${result.status}`;
  return { ok, seconds, reason };
}

function main (argv) {
  const opts = parseArgs(argv);
  const explicit = opts.dirs.length > 0 || Boolean(process.env.FABRIC_REPOS);
  const repos = selectRepos(opts.dirs.length ? opts.dirs : defaultRepos(), explicit);
  let ordered = orderRepos(repos);
  if (opts.from) {
    const at = ordered.findIndex((r) => path.basename(r.dir) === opts.from || r.pkg.name === opts.from);
    if (at < 0) throw new Error(`--from ${opts.from}: no such repository`);
    ordered = ordered.slice(at);
  }

  console.log('Order:');
  ordered.forEach((r, i) => {
    const needs = r.needs.map((d) => path.basename(d)).join(', ');
    console.log(`  ${i + 1}. ${path.basename(r.dir)} (${r.pkg.name})${needs ? ` ← ${needs}` : ''}`);
  });
  if (opts.dryRun) return 0;

  const timeoutMs = Number(process.env.FABRIC_TEST_TIMEOUT_MINUTES || 60) * 60000;
  const passed = [];
  for (const r of ordered) {
    const name = path.basename(r.dir);
    const steps = [];
    if (opts.install) steps.push(['run', 'report:install']);
    const test = testCommand(r.pkg, opts);
    if (test) steps.push(test);
    if (!test) console.log(`\n=== ${name}: no test script, skipped`);
    for (const args of steps) {
      console.log(`\n=== ${name}: npm ${args.join(' ')}`);
      const result = run(r.dir, args, timeoutMs);
      if (!result.ok) {
        console.error(`\n✗ ${name}: npm ${args.join(' ')} failed (${result.reason}, ${result.seconds}s)`);
        if (passed.length) console.error(`Passed before it: ${passed.join(', ')}`);
        console.error(`Resume with: ${resumeCommand(name, opts)}`);
        return 1;
      }
      console.log(`✓ ${name}: npm ${args.join(' ')} (${result.seconds}s)`);
    }
    if (test) passed.push(name);
  }
  console.log(`\nAll ${passed.length} repositories passed: ${passed.join(', ')}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}

module.exports = { orderRepos, testCommand, discoverRepos, selectRepos, resumeCommand };
