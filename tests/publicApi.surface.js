'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('mocha');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

/** Leaf paths frozen in PUBLIC_API.md (canonical 0.1 surface). */
const CANONICAL_REQUIRES = [
  '@fabric/core/types/key',
  '@fabric/core/types/message',
  '@fabric/core/types/peer',
  '@fabric/core/constants',
  '@fabric/core/functions/cliDocumentExchange',
  '@fabric/core/functions/inventoryHtlc',
  '@fabric/core/functions/documentSealedExchange',
  '@fabric/core/functions/publishedDocumentEnvelope',
  '@fabric/core/functions/documentPaymentHash',
  '@fabric/core/types/program',
  '@fabric/core/types/machine',
  '@fabric/core/functions/sidechainState',
  '@fabric/core/functions/fabricProgramManifest',
  '@fabric/core/functions/loadLocalSettings'
];

function resolvePackageExport (subpath) {
  // Map @fabric/core/<rest> → local file via package exports patterns.
  const rest = subpath.replace(/^@fabric\/core\/?/, '');
  if (!rest) return path.join(ROOT, 'types', 'fabric.js');
  if (rest === 'constants') return path.join(ROOT, 'constants.js');
  if (rest.startsWith('types/')) return path.join(ROOT, rest + '.js');
  if (rest.startsWith('functions/')) return path.join(ROOT, rest + '.js');
  if (rest.startsWith('services/')) return path.join(ROOT, rest + '.js');
  throw new Error(`unmapped export ${subpath}`);
}

describe('@fabric/core public API surface (0.1 RC)', function () {
  it('package.json declares files whitelist and scoped description', function () {
    assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, 'files whitelist required');
    assert.ok(pkg.files.includes('PUBLIC_API.md'));
    assert.ok(pkg.files.includes('settings/local.example.js'));
    assert.ok(pkg.files.some((f) => f.includes('types/')));
    assert.ok(pkg.files.some((f) => f.includes('functions/')));
    assert.ok(/experimental|RC|reference/i.test(pkg.description));
    assert.ok(/not a sandboxed|sandbox/i.test(pkg.description));
  });

  it('exports map exposes types for leaf modules', function () {
    assert.ok(pkg.exports['.'].types);
    assert.ok(pkg.exports['./types/*'].types);
    assert.ok(pkg.exports['./functions/*'].types);
    assert.ok(pkg.exports['./types/*'].require);
    assert.ok(pkg.exports['./functions/*'].require);
  });

  it('every canonical PUBLIC_API import resolves and loads', function () {
    for (const id of CANONICAL_REQUIRES) {
      const file = resolvePackageExport(id);
      assert.ok(fs.existsSync(file), `missing ${file} for ${id}`);
      const mod = require(file);
      assert.ok(mod != null, `${id} exported null/undefined`);
    }
  });

  it('leaf .d.ts stubs exist for typed canonical imports', function () {
    const stubs = [
      'types/fabric.d.ts',
      'types/peer.d.ts',
      'types/message.d.ts',
      'types/key.d.ts',
      'types/program.d.ts',
      'types/machine.d.ts',
      'functions/cliDocumentExchange.d.ts',
      'functions/inventoryHtlc.d.ts',
      'functions/documentSealedExchange.d.ts',
      'functions/sidechainState.d.ts',
      'functions/loadLocalSettings.d.ts'
    ];
    for (const rel of stubs) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
    }
  });

  it('PUBLIC_API.md documents scoped claim and canonical import table', function () {
    const md = fs.readFileSync(path.join(ROOT, 'PUBLIC_API.md'), 'utf8');
    assert.ok(md.includes('@fabric/core/types/peer'));
    assert.ok(md.includes('@fabric/core/functions/cliDocumentExchange'));
    assert.ok(/not.*sandbox/i.test(md) || /not a sandboxed/i.test(md));
    assert.ok(md.includes('CliDocumentExchange') || md.includes('document exchange'));
  });

  it('PROTOCOL.md points at MESSAGE_BODY.md (no stale checksum-only header as canonical)', function () {
    const md = fs.readFileSync(path.join(ROOT, 'PROTOCOL.md'), 'utf8');
    assert.ok(md.includes('MESSAGE_BODY.md'));
    assert.ok(md.includes('208'));
    assert.ok(!/checksum — 32 bytes \(sha256sum of payload\)/.test(md));
  });

  it('PRIVACY.md and AUDIT.md exist and cross-link SECURITY', function () {
    const privacy = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
    const audit = fs.readFileSync(path.join(ROOT, 'AUDIT.md'), 'utf8');
    assert.ok(privacy.includes('SECURITY.md'));
    assert.ok(audit.includes('PUBLIC_API.md'));
    assert.ok(/third-party|External security/i.test(audit));
  });

  it('CliDocumentExchange and inventoryHtlc export expected symbols', function () {
    const cli = require('../functions/cliDocumentExchange');
    assert.strictEqual(typeof cli.CliDocumentExchange, 'function');
    assert.ok(Array.isArray(cli.DOCUMENT_EXCHANGE_CLI_PACKS));
    const htlc = require('../functions/inventoryHtlc');
    assert.strictEqual(typeof htlc.buildInventoryHtlcP2tr, 'function');
    assert.strictEqual(typeof htlc.buildDocumentOfferEscrow, 'function');
  });
});
