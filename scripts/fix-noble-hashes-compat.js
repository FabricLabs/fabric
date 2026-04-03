'use strict';

/**
 * After upgrading to @noble/hashes@2, several dependencies still import removed subpaths
 * (e.g. `@noble/hashes/ripemd160`, `@noble/hashes/sha256`). This script rewrites those requires
 * in installed packages to `legacy.js` / `sha2.js` on every `npm install`.
 *
 * This is independent of the `elliptic` dependency alias (`@soatok/elliptic-to-noble`): that
 * package satisfies the `elliptic` name for code that expects the old API, while this file
 * keeps bitcoinjs-lib / bs58check / wif working with noble 2.x without maintaining patch-package
 * blobs in the repo.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function patchIfChanged (absPath, transform) {
  if (!fs.existsSync(absPath)) return;
  const s0 = fs.readFileSync(absPath, 'utf8');
  const s1 = transform(s0);
  if (s1 !== s0) fs.writeFileSync(absPath, s1);
}

function patchBitcoinjsCrypto (s) {
  if (!s.includes("require('@noble/hashes/ripemd160')") && !s.includes('require("@noble/hashes/ripemd160")')) {
    return s;
  }
  return s
    .replace(
      /const ripemd160_1 = require\(['"]@noble\/hashes\/ripemd160['"]\);\r?\nconst sha1_1 = require\(['"]@noble\/hashes\/sha1['"]\);\r?\nconst sha256_1 = require\(['"]@noble\/hashes\/sha256['"]\);/,
      "const legacy_1 = require('@noble/hashes/legacy.js');\nconst sha256_1 = require('@noble/hashes/sha2.js');"
    )
    .replace(/\(0, ripemd160_1\.ripemd160\)/g, '(0, legacy_1.ripemd160)')
    .replace(/\(0, sha1_1\.sha1\)/g, '(0, legacy_1.sha1)');
}

function patchBs58checkSha256Path (s) {
  return s.replace(/@noble\/hashes\/sha256/g, '@noble/hashes/sha2.js');
}

const jobs = [
  ['node_modules/bitcoinjs-lib/src/crypto.js', patchBitcoinjsCrypto],
  ['node_modules/bs58check/index.js', patchBs58checkSha256Path],
  'node_modules/wif/node_modules/bs58check/src/cjs/index.cjs',
  'node_modules/wif/node_modules/bs58check/src/esm/index.js'
];

for (const job of jobs) {
  if (typeof job === 'string') {
    patchIfChanged(path.join(root, job), patchBs58checkSha256Path);
  } else {
    const [rel, fn] = job;
    patchIfChanged(path.join(root, rel), fn);
  }
}
