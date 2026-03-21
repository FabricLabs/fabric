'use strict';

/**
 * Writes reports under ./reports:
 * - WARNINGS.md — npm warnings from install.log (+ optional dry-run)
 * - DEPRECATIONS.md — registry deprecations (package-lock), settings/deprecations.js, @deprecated in first-party JS
 * - SECURITY-AUDIT.md + npm-audit.json — full npm audit (all severities)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const reportsDir = path.join(root, 'reports');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '_book', 'assets', 'coverage', 'build', '.cursor',
  'stores', '_site'
]);

function isoNow () {
  return new Date().toISOString();
}

function ensureReportsDir () {
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
}

function readInstallLogWarnings () {
  const p = path.join(reportsDir, 'install.log');
  if (!fs.existsSync(p)) {
    return {
      found: false,
      body: '_No `reports/install.log` yet. Generate with `npm run report:install-ci` (or CI artifact)._'
    };
  }
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split(/\n/).filter((l) => {
    return /npm warn|npm WARN|npm notice|WARN\s|^warning:/i.test(l);
  });
  return {
    found: lines.length > 0,
    body: lines.length ? ['```', ...lines, '```'].join('\n') : '_No warning-shaped lines in `install.log`._'
  };
}

function npmProbeStderr () {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['config', 'get', 'prefix'], {
    cwd: root,
    encoding: 'utf8'
  });
  const stderr = (r.stderr || '').trim();
  if (!stderr) return '_No stderr from `npm config get prefix`._';
  return ['```', stderr, '```'].join('\n');
}

function npmDryRunWarnings () {
  if (process.env.SKIP_NPM_DRY_RUN === '1') {
    return '_Skipped (`SKIP_NPM_DRY_RUN=1`)._';
  }
  try {
    const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180000
    });
    const lines = out.split('\n').filter((l) => /warn|notice|deprecated/i.test(l));
    return lines.length ? ['```', ...lines, '```'].join('\n') : '_`npm ci --dry-run` produced no warn/notice lines._';
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join('\n');
    return [
      '_`npm ci --dry-run` exited non-zero (lock mismatch or npm error); captured output:_',
      '',
      '```',
      out || e.message,
      '```'
    ].join('\n');
  }
}

function collectLockfileDeprecations () {
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const rows = [];
  const pkgs = lock.packages || {};
  for (const [pkgPath, meta] of Object.entries(pkgs)) {
    if (meta && meta.deprecated) {
      rows.push({
        path: pkgPath || '(root)',
        version: meta.version || '',
        message: meta.deprecated
      });
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

function formatLockfileDeprecationsTable (rows) {
  if (!rows.length) return '_No `deprecated` fields in package-lock.json._';
  const lines = [
    '| Lockfile path | Version | Registry message |',
    '| --- | --- | --- |'
  ];
  for (const r of rows) {
    const msg = String(r.message).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| \`${r.path}\` | ${r.version || '—'} | ${msg} |`);
  }
  return lines.join('\n');
}

function readSettingsDeprecationsSnippet () {
  const p = path.join(root, 'settings', 'deprecations.js');
  if (!fs.existsSync(p)) return '_Missing settings/deprecations.js._';
  return ['```javascript', fs.readFileSync(p, 'utf8'), '```'].join('\n');
}

function walkJsForDeprecated (dir, acc, base = root) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsForDeprecated(full, acc, base);
    else if (ent.isFile() && ent.name.endsWith('.js')) {
      const rel = path.relative(base, full);
      if (rel.startsWith('node_modules')) continue;
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!/@deprecated/i.test(text)) continue;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (!/@deprecated/i.test(line)) return;
        acc.push({ file: rel, line: i + 1, text: line.trim() });
      });
    }
  }
}

function formatSourceDeprecated (items) {
  if (!items.length) return '_No `@deprecated` JSDoc lines found in scanned tree._';
  const lines = ['| File | Line | Line |', '| --- | ---: | --- |'];
  for (const it of items) {
    const t = it.text.replace(/\|/g, '\\|');
    lines.push(`| \`${it.file}\` | ${it.line} | ${t} |`);
  }
  return lines.join('\n');
}

function runNpmAuditJson () {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120000
    });
    return JSON.parse(out);
  } catch (e) {
    const out = e.stdout && String(e.stdout).trim();
    if (out && out.startsWith('{')) return JSON.parse(out);
    throw e;
  }
}

function auditSummaryMarkdown (data) {
  const meta = data.metadata && data.metadata.vulnerabilities
    ? data.metadata.vulnerabilities
    : {};
  const counts = ['info', 'low', 'moderate', 'high', 'critical']
    .map((k) => `${k}: ${meta[k] != null ? meta[k] : 0}`)
    .join(' · ');
  const lines = [
    '## Summary',
    '',
    counts,
    ''
  ];
  const vulns = data.vulnerabilities || {};
  const names = Object.keys(vulns).sort();
  if (!names.length) {
    lines.push('_No advisories in `vulnerabilities` object (tree may be clean or audit format differed)._');
    return lines.join('\n');
  }
  lines.push('## Advisories (name → severity)', '');
  for (const name of names) {
    const v = vulns[name];
    const sev = v.severity || '?';
    const via = Array.isArray(v.via) ? v.via.map((x) => (typeof x === 'string' ? x : x && x.title)).filter(Boolean).join('; ') : '';
    lines.push(`- **${name}** — _${sev}_${via ? ` — ${via}` : ''}`);
  }
  return lines.join('\n');
}

function writeWarnings () {
  const install = readInstallLogWarnings();
  const md = [
    '# Install & npm warnings',
    '',
    `_Generated: ${isoNow()}_`,
    '',
    '## From `reports/install.log`',
    '',
    install.body,
    '',
    '## From `npm ci --dry-run`',
    '',
    npmDryRunWarnings(),
    '',
    '## npm stderr probe (`npm config get prefix`)',
    '',
    'Catches environment/config notices (for example IDE-set `devdir`) that may not appear in `install.log`.',
    '',
    npmProbeStderr(),
    '',
    '---',
    '',
    'Refresh install log: `npm run report:install-ci`.',
    'Disable dry-run section: `SKIP_NPM_DRY_RUN=1 npm run report:warnings`.'
  ].join('\n');
  fs.writeFileSync(path.join(reportsDir, 'WARNINGS.md'), md, 'utf8');
}

function writeDeprecations () {
  const lockRows = collectLockfileDeprecations();
  const deprecatedLines = [];
  walkJsForDeprecated(root, deprecatedLines);
  deprecatedLines.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));

  const md = [
    '# Deprecations',
    '',
    `_Generated: ${isoNow()}_`,
    '',
    '## Registry (package-lock)',
    '',
    'Packages marked deprecated on the npm registry (as recorded in `package-lock.json`).',
    '',
    formatLockfileDeprecationsTable(lockRows),
    '',
    '## `settings/deprecations.js`',
    '',
    'Curated façade deprecations (re-exports):',
    '',
    readSettingsDeprecationsSnippet(),
    '',
    '## First-party `@deprecated` JSDoc',
    '',
    'Scan: repo root `.js` files excluding `node_modules`, `assets`, `coverage`, `build`, etc.',
    '',
    formatSourceDeprecated(deprecatedLines),
    '',
    '---',
    '',
    'Regenerate: `npm run report:deprecations` (or `npm run report:quality`).'
  ].join('\n');
  fs.writeFileSync(path.join(reportsDir, 'DEPRECATIONS.md'), md, 'utf8');
}

function writeSecurity () {
  let data;
  try {
    data = runNpmAuditJson();
  } catch (e) {
    const errBlob = {
      error: String(e.message || e),
      stderr: e.stderr ? String(e.stderr) : undefined,
      note: 'npm audit failed — see captured fields or run with network access'
    };
    fs.writeFileSync(path.join(reportsDir, 'npm-audit.json'), JSON.stringify(errBlob, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(reportsDir, 'SECURITY-AUDIT.md'),
      ['# Security audit', '', '_Generated: ' + isoNow() + '_', '', '```', errBlob.error, errBlob.stderr || '', '```'].join('\n'),
      'utf8'
    );
    return;
  }

  fs.writeFileSync(path.join(reportsDir, 'npm-audit.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');

  let human = '';
  try {
    human = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000
    });
  } catch (e) {
    human = [e.stdout, e.stderr].filter(Boolean).join('\n') || String(e.message || e);
  }

  const md = [
    '# Security audit (npm)',
    '',
    `_Generated: ${isoNow()}_`,
    '',
    'Machine-readable: [`npm-audit.json`](./npm-audit.json) (full `npm audit --json`).',
    '',
    '---',
    '',
    auditSummaryMarkdown(data),
    '',
    '---',
    '',
    '## `npm audit` (text)',
    '',
    '```',
    human.trim() || '(empty)',
    '```',
    '',
    '---',
    '',
    'CI / automation may use `npm audit --audit-level=...`. Legacy script `npm run audit` only wrote critical-level JSON to `AUDIT.json`.',
    '',
    'Regenerate: `npm run report:security` or `npm run report:quality`.'
  ].join('\n');
  fs.writeFileSync(path.join(reportsDir, 'SECURITY-AUDIT.md'), md, 'utf8');
}

function main () {
  const arg = (process.argv[2] || 'all').toLowerCase();
  if (!['warnings', 'deprecations', 'security', 'all'].includes(arg)) {
    console.error('Usage: node scripts/gen-quality-reports.js [warnings|deprecations|security|all]');
    process.exit(1);
  }
  ensureReportsDir();

  if (arg === 'warnings' || arg === 'all') writeWarnings();
  if (arg === 'deprecations' || arg === 'all') writeDeprecations();
  if (arg === 'security' || arg === 'all') writeSecurity();

  console.error(`Wrote reports to ${reportsDir} (${arg})`);
}

main();
