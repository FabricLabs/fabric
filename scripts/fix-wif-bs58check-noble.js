'use strict';

/**
 * wif@5 bundles bs58check@4, which still imports @noble/hashes/sha256 (removed in @noble/hashes@2).
 * npm overrides cannot always flatten nested bs58check; fix entrypoints after install.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = [
  'node_modules/wif/node_modules/bs58check/src/cjs/index.cjs',
  'node_modules/wif/node_modules/bs58check/src/esm/index.js'
];

for (const rel of targets) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  const s0 = fs.readFileSync(p, 'utf8');
  const s1 = s0.replace(/@noble\/hashes\/sha256/g, '@noble/hashes/sha2.js');
  if (s1 !== s0) fs.writeFileSync(p, s1);
}
