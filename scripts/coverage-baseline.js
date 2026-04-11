'use strict';

/**
 * Reads c8 json-summary after tests (see npm script report:coverage-baseline).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportsDir = path.join(root, 'reports');
const summaryPath = path.join(root, 'coverage', 'coverage-summary.json');

function main () {
  if (!fs.existsSync(summaryPath)) {
    console.error('Missing', summaryPath, '— run npm run report:coverage-baseline from package.json');
    process.exit(1);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const total = summary.total || {};

  const pct = (k) => (total[k] && total[k].pct != null ? total[k].pct : '—');

  const md = [
    '# Test coverage baseline',
    '',
    '_Generated: ' + new Date().toISOString() + ' — from `c8` json-summary after `npm test`._',
    '',
    '| Metric | % |',
    '| --- | ---: |',
    '| Lines | ' + pct('lines') + ' |',
    '| Statements | ' + pct('statements') + ' |',
    '| Functions | ' + pct('functions') + ' |',
    '| Branches | ' + pct('branches') + ' |',
    '',
    '**Goal:** raise toward 100% incrementally; prioritize `types/message.js`, `types/peer.js`, `services/bitcoin.js`, and CLI paths.',
    '',
    'Regenerate: `npm run report:coverage-baseline`.',
    '',
    'Raw JSON: `coverage/coverage-summary.json` (ignored by git; HTML via `npm run make:coverage`).'
  ].join('\n');

  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'COVERAGE-BASELINE.md'), md, 'utf8');
  console.error('Wrote reports/COVERAGE-BASELINE.md');
}

main();
