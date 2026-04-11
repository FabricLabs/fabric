'use strict';

/**
 * Validates links under _book/ (the tree `npm run dev` serves after `npm run make:dev`).
 *
 * - Relative hrefs: target file must exist.
 * - http(s) hrefs: optional probe with `CHECK_BOOK_EXTERNAL=1` (HEAD request, short timeout).
 *
 * Usage:
 *   npm run make:dev
 *   npm run check:book-links
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const root = path.resolve(__dirname, '..');
const bookRoot = process.env.BOOK_ROOT
  ? path.resolve(process.env.BOOK_ROOT)
  : path.join(root, '_book');
const checkExternal = process.env.CHECK_BOOK_EXTERNAL === '1';
const externalTimeoutMs = Number(process.env.CHECK_BOOK_EXTERNAL_MS || 8000);
/** Comma-separated path prefixes (relative to _book) to skip — default skips JSDoc tree with many unresolved `App.html` refs. */
const skipPrefixes = (process.env.BOOK_LINK_SKIP_PREFIXES != null
  ? process.env.BOOK_LINK_SKIP_PREFIXES
  : 'docs/'
).split(',')
  .map((s) => s.trim().replace(/\\/g, '/'))
  .filter(Boolean);

const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;

/** Skip JSDoc-style type links (`User`, `Actor#id`) — not filesystem paths. */
function looksLikeFileHref (href) {
  const pathPart = href.split('#')[0];
  if (!pathPart) return false;
  if (/^https?:\/\//i.test(pathPart)) return false;
  if (pathPart.startsWith('mailto:')) return false;
  if (pathPart.startsWith('data:')) return false;
  if (pathPart.includes('/')) return true;
  if (pathPart.startsWith('.')) return true;
  if (/\.(md|html?|xhtml)$/i.test(pathPart)) return true;
  return false;
}

function listHtmlFiles (dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) listHtmlFiles(full, acc);
    else if (name.isFile() && name.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}

function probeExternalUrl (url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(
      url,
      { method: 'HEAD', timeout: externalTimeoutMs },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 'timeout' });
    });
    req.on('error', (e) => resolve({ ok: false, status: String(e.message || e) }));
    req.end();
  });
}

async function run () {
  if (!fs.existsSync(bookRoot)) {
    console.error(
      `Missing ${bookRoot}. Run: npm run make:dev\n` +
      'Then re-run: npm run check:book-links'
    );
    process.exit(1);
  }

  const htmlFiles = listHtmlFiles(bookRoot);
  const broken = [];
  const external = [];
  let scanned = 0;

  for (const file of htmlFiles) {
    const relFromBook = path.relative(bookRoot, file);
    if (skipPrefixes.some((p) => relFromBook.startsWith(p))) continue;
    scanned++;

    const text = fs.readFileSync(file, 'utf8');
    let m;
    hrefRe.lastIndex = 0;
    while ((m = hrefRe.exec(text)) !== null) {
      const href = m[1].trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('data:')) continue;
      if (href === '#' || href.startsWith('#')) continue;

      if (href.startsWith('http://') || href.startsWith('https://')) {
        external.push({ from: relFromBook, href });
        continue;
      }

      const [pathPart] = href.split('#');
      if (!pathPart || pathPart === '') continue;
      if (!looksLikeFileHref(href)) continue;

      const target = path.normalize(path.join(path.dirname(file), pathPart));
      if (!fs.existsSync(target)) {
        broken.push({ from: relFromBook, href, resolved: path.relative(root, target) });
      }
    }
  }

  if (broken.length) {
    console.error('Broken relative links (_book):');
    for (const b of broken) {
      console.error(`  ${b.from}\n    href=${b.href}\n    expected=${b.resolved}`);
    }
    process.exitCode = 1;
  } else {
    console.error(
      'Relative links: OK (%d HTML files scanned; %d skipped via BOOK_LINK_SKIP_PREFIXES=%s)',
      scanned,
      htmlFiles.length - scanned,
      skipPrefixes.join(',') || '(none)'
    );
  }

  if (external.length && checkExternal) {
    console.error('Checking %d external hrefs (HEAD)...', external.length);
    for (const e of external) {
      const r = await probeExternalUrl(e.href);
      if (!r.ok) {
        console.error(`  FAIL ${e.from} -> ${e.href} (${r.status})`);
        process.exitCode = 1;
      }
    }
    console.error('External links: done');
  } else if (external.length) {
    console.error(
      'External hrefs found: %d (set CHECK_BOOK_EXTERNAL=1 to probe). Sample:',
      external.length
    );
    external.slice(0, 8).forEach((e) => console.error(`  ${e.href}`));
  }

  process.exit(process.exitCode || 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
