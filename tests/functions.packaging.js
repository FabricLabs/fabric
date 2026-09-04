'use strict';

/**
 * Packaging closure: what we publish must actually load once installed.
 *
 * `@fabric/hub` CI went red on the http version of this bug — a published
 * `types/browser.js` whose `../components/*` requires were never added to
 * `files[]`. Nothing was missing from git, and both `npm test` and `npm pack`
 * were green locally, because the break only exists for an *installed*
 * consumer. `npm run report:install` does not catch it either: it resolves from
 * the repo, not from the tarball.
 *
 * Two properties are pinned here:
 *
 *   1. Every relative `require` of a packed module is itself packed (with a
 *      documented allowance for the two optional-by-design load paths).
 *   2. The set of packed-but-unloadable modules is *exactly* the known-rotten
 *      list below — so new rot fails immediately, and cleaning one up fails
 *      loudly too, prompting an update here rather than silent drift.
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_PREFIXES = ['types/', 'functions/', 'services/', 'contracts/'];

/**
 * Deliberately unpacked require targets.
 * - `build/Release/fabric.node` — optional native addon; `fabricNativeAccel`
 *   documents the pure-JS fallback and tolerates MODULE_NOT_FOUND.
 * - `settings/local.js` — gitignored operator overlay; `loadLocalSettings`
 *   falls back to `settings/local.example.js` by design.
 */
const INTENTIONALLY_UNPACKED = new Set(['build/Release/fabric.node', 'settings/local.js']);

/**
 * Modules that ship but throw on `require`. Empty after the RC ship-set cut:
 * unloadable exchange/mqtt/turntable/authority/component/renderer/typetree are
 * excluded from `package.json` `files[]` (repo copies may remain for history /
 * local experiments). Any *new* packed unloadable fails this suite.
 */
const KNOWN_UNLOADABLE = new Set([]);

/** Direct deps that must be declared so NOISE transport cannot silently break. */
const NOISE_DIRECT_DEPS = [
  'duplexify',
  'end-of-stream',
  'length-prefixed-stream',
  'stream-each',
  'through2'
];

/** Modules deliberately omitted from the published tarball. */
const SHIP_EXCLUDED = [
  'services/exchange.js',
  'services/mqtt.js',
  'services/turntable.js',
  'types/authority.js',
  'types/component.js',
  'types/renderer.js',
  'types/typetree.js'
];

function packedPaths () {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const parsed = JSON.parse(raw.trim());
  // `--json` is an array on older npm and a name-keyed map on newer.
  const packages = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const files = [];
  for (const entry of packages) for (const f of (entry.files || [])) files.push(f.path);
  return new Set(files.map((p) => p.replace(/\\/g, '/')));
}

function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function resolveRelative (fromFile, request) {
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), request);
  for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(ROOT, candidate).replace(/\\/g, '/');
    }
  }
  return null;
}

describe('packaging closure', function () {
  this.timeout(180000);

  let packed = null;
  let sources = [];

  before(function () {
    try {
      packed = packedPaths();
    } catch (exception) {
      this.skip();
      return;
    }
    sources = [...packed].filter(
      (p) => p.endsWith('.js') && SOURCE_PREFIXES.some((prefix) => p.startsWith(prefix))
    );
  });

  it('packs a plausible source set', function () {
    assert.ok(packed.size > 200, `expected a substantial package, saw ${packed.size} files`);
    assert.ok(sources.length > 150, `expected 150+ packed source modules, saw ${sources.length}`);
    assert.ok(packed.has('types/message.js'), 'types/message.js should ship');
  });

  it('packs every relative require of a packed module', function () {
    const missing = [];
    for (const file of sources) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      for (const match of src.matchAll(/require\(\s*['"](\.[^'"]*)['"]\s*\)/g)) {
        const target = resolveRelative(file, match[1]);
        if (!target || INTENTIONALLY_UNPACKED.has(target)) continue;
        if (!packed.has(target)) missing.push(`${file} -> ${match[1]} (resolves to ${target}, NOT packed)`);
      }
    }
    assert.deepStrictEqual(
      missing,
      [],
      `packed modules requiring unpacked files (breaks on install):\n  ${missing.join('\n  ')}`
    );
  });

  it('has exactly the known set of packed-but-unloadable modules', function () {
    const unloadable = [];
    for (const file of sources) {
      try {
        require(path.join(ROOT, file));
      } catch (exception) {
        unloadable.push(file);
      }
    }

    const unexpected = unloadable.filter((f) => !KNOWN_UNLOADABLE.has(f));
    assert.deepStrictEqual(
      unexpected,
      [],
      `new packed modules fail to load — add the missing dep or drop the module:\n  ${unexpected.join('\n  ')}`
    );

    const fixed = [...KNOWN_UNLOADABLE].filter((f) => packed.has(f) && !unloadable.includes(f));
    assert.deepStrictEqual(
      fixed,
      [],
      `these now load — remove them from KNOWN_UNLOADABLE:\n  ${fixed.join('\n  ')}`
    );
  });

  it('does not pack quarantined unloadable modules', function () {
    const stillPacked = SHIP_EXCLUDED.filter((f) => packed.has(f));
    assert.deepStrictEqual(
      stillPacked,
      [],
      `these must stay out of files[]:\n  ${stillPacked.join('\n  ')}`
    );
  });

  it('declares NOISE stream deps directly (no phantom hoist)', function () {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = pkg.dependencies || {};
    const missing = NOISE_DIRECT_DEPS.filter((name) => !deps[name]);
    assert.deepStrictEqual(
      missing,
      [],
      `declare these for functions/noiseProtocolStream.js:\n  ${missing.join('\n  ')}`
    );
  });
});
