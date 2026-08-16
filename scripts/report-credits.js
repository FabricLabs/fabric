#!/usr/bin/env node
'use strict';

/**
 * Emit license-checker-compatible JSON from package-lock.json + node_modules.
 * Replaces the deprecated license-checker devDependency.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lockPath = path.join(root, 'package-lock.json');
const nodeModules = path.join(root, 'node_modules');

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING'];

function repoUrl (pkg) {
  if (!pkg || !pkg.repository) return undefined;
  const r = pkg.repository;
  if (typeof r === 'string') return r;
  if (r.url) {
    return String(r.url)
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/\.git$/, '');
  }
  return undefined;
}

function formatLicense (pkg) {
  if (pkg.license) return String(pkg.license);
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).filter(Boolean).join(' AND ');
  }
  return 'UNKNOWN';
}

function findLicenseFile (dir) {
  for (const name of LICENSE_FILES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function main () {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packages = lock.packages || {};
  const out = {};

  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath || pkgPath === '' || !meta.version) continue;
    const nmPath = path.join(root, pkgPath);
    if (!fs.existsSync(nmPath)) continue;

    const pkgJsonPath = path.join(nmPath, 'package.json');
    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }

    const key = `${pkg.name}@${meta.version}`;
    if (out[key]) continue;

    const entry = {
      licenses: formatLicense(pkg),
      path: nmPath
    };
    const repository = repoUrl(pkg);
    if (repository) entry.repository = repository;
    if (pkg.author) {
      if (typeof pkg.author === 'string') {
        entry.publisher = pkg.author;
      } else {
        if (pkg.author.name) entry.publisher = pkg.author.name;
        if (pkg.author.email) entry.email = pkg.author.email;
        if (pkg.author.url) entry.url = pkg.author.url;
      }
    }
    const licenseFile = findLicenseFile(nmPath);
    if (licenseFile) entry.licenseFile = licenseFile;
    out[key] = entry;
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main();
