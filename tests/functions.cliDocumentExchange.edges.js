'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('mocha');

const { CliDocumentExchange } = require('../functions/cliDocumentExchange');

describe('functions/cliDocumentExchange path & publish edges', function () {
  it('rejects null-byte paths and oversized paths', function () {
    const exchange = new CliDocumentExchange({});
    assert.strictEqual(exchange.importFile('evil\0.txt').ok, false);
    assert.strictEqual(exchange.importFile('a'.repeat(4097)).ok, false);
    assert.strictEqual(exchange.importFile('   ').ok, false);
    assert.strictEqual(exchange.importFile(undefined).ok, false);
    assert.strictEqual(exchange.importFile(123).ok, false);
  });

  it('rejects directories (not a regular file)', function () {
    const exchange = new CliDocumentExchange({});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-doc-dir-'));
    try {
      const res = exchange.importFile(dir);
      assert.strictEqual(res.ok, false);
    } finally {
      fs.rmdirSync(dir);
    }
  });

  it('accepts absolute paths outside cwd when the file exists', function () {
    const tmp = path.join(os.tmpdir(), `fabric-abs-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'absolute-ok');
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        _state: { content: { documents: {}, documentRates: {} } },
        settings: {},
        _publishDocument () {}
      }),
      getFilesystem: () => null
    });
    try {
      const res = exchange.importFile(tmp);
      assert.ok(res.ok, res.error);
      assert.ok(res.data.documentId);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('trims surrounding whitespace on import paths', function () {
    const tmp = path.join(os.tmpdir(), `fabric-trim-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'trim-me');
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        _state: { content: { documents: {}, documentRates: {} } },
        settings: {},
        _publishDocument () {}
      }),
      getFilesystem: () => null
    });
    try {
      const res = exchange.importFile(`  ${tmp}  `);
      assert.ok(res.ok, res.error);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('publish rejects non-finite and negative rateSats; accepts finite fractions', function () {
    const published = [];
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        _state: { content: { documents: {}, documentRates: {} } },
        settings: {},
        _publishDocument (id, body, rate) { published.push(rate); }
      })
    });
    exchange.documents.docA = Buffer.from('x');
    for (const bad of [NaN, Infinity, -Infinity, -1, 'nope']) {
      assert.strictEqual(exchange.publish('docA', bad).ok, false, String(bad));
    }
    // Current policy: Number.isFinite only — fractional sats are accepted.
    assert.strictEqual(exchange.publish('docA', 1.5).ok, true);
    assert.deepStrictEqual(published, [1.5]);
  });

  it('publish propagates host getPeer errors (not swallowed)', function () {
    const exchange = new CliDocumentExchange({
      getPeer: () => { throw new Error('peer boom'); }
    });
    exchange.documents.docB = Buffer.from('y');
    assert.throws(() => exchange.publish('docB', 0), /peer boom/);
  });
});
