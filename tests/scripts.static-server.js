'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const { safeJoin, serveFile, handler } = require('../scripts/static-server');

class FakeResponse extends Writable {
  constructor () {
    super();
    this.headersSent = false;
    this.writeHeadCount = 0;
    this.destroyed = false;
  }

  writeHead () {
    this.writeHeadCount++;
    this.headersSent = true;
  }

  _write (chunk, encoding, callback) {
    callback();
  }

  destroy (err) {
    this.destroyed = true;
    return super.destroy(err);
  }
}

describe('scripts/static-server', function () {
  it('rejects malformed percent-encoding and path escape', function () {
    const root = path.resolve(os.tmpdir(), 'fabric-static-root');
    assert.strictEqual(safeJoin(root, '/%E0%A4%A'), null);
    assert.strictEqual(safeJoin(root, '/../etc/passwd'), null);
  });

  it('does not call writeHead after headers are sent', function (done) {
    const res = new FakeResponse();
    serveFile(res, path.join(os.tmpdir(), 'fabric-static-missing-' + Date.now()));
    setTimeout(() => {
      assert.ok(res.writeHeadCount >= 1);
      assert.strictEqual(res.writeHeadCount, 1);
      assert.strictEqual(res.destroyed, true);
      done();
    }, 80);
  });

  it('handler returns 403 for a malformed URI', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-h-'));
    const req = { url: '/%E0%A4%A' };
    const res = { statusCode: 0, writeHead (code) { this.statusCode = code; }, end () {} };
    handler(dir)(req, res);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(res.statusCode, 403);
  });
});
