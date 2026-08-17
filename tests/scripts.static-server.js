'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const http = require('http');
const { safeJoin, isRealpathInsideRoot, serveFile, handler } = require('../scripts/static-server');

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

  it('rejects a symlink whose real path is outside the document root', function (done) {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-out-'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-in-'));
    const secret = path.join(outside, 'secret.txt');
    const leak = path.join(root, 'leak.txt');
    fs.writeFileSync(secret, 'nope');
    fs.symlinkSync(secret, leak);
    assert.strictEqual(isRealpathInsideRoot(root, leak), false);
    const server = http.createServer(handler(root));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}/leak.txt`, (res) => {
        const code = res.statusCode;
        res.resume();
        server.close(() => {
          fs.rmSync(root, { recursive: true, force: true });
          fs.rmSync(outside, { recursive: true, force: true });
          try {
            assert.strictEqual(code, 403);
            done();
          } catch (err) {
            done(err);
          }
        });
      }).on('error', (err) => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
        done(err);
      });
    });
  });

  it('serves a symlink that stays inside the document root', function (done) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-ok-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<p>ok</p>');
    fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'alias.html'));
    assert.strictEqual(isRealpathInsideRoot(root, path.join(root, 'alias.html')), true);
    const server = http.createServer(handler(root));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}/alias.html`, (res) => {
        const code = res.statusCode;
        res.resume();
        server.close(() => {
          fs.rmSync(root, { recursive: true, force: true });
          try {
            assert.strictEqual(code, 200);
            done();
          } catch (err) {
            done(err);
          }
        });
      }).on('error', (err) => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
        done(err);
      });
    });
  });
});

const {
  isLockNodeModulesPath,
  resolveLockPackageDir
} = require('../scripts/report-credits');

describe('scripts/report-credits lockfile paths', function () {
  const root = path.resolve('/tmp/fabric-credits-root');

  it('accepts only node_modules lockfile keys', function () {
    assert.strictEqual(isLockNodeModulesPath('node_modules/foo'), true);
    assert.strictEqual(isLockNodeModulesPath('node_modules/foo/node_modules/bar'), true);
    assert.strictEqual(isLockNodeModulesPath(''), false);
    assert.strictEqual(isLockNodeModulesPath('../etc'), false);
    assert.strictEqual(isLockNodeModulesPath('node_modules/../secret'), false);
  });

  it('resolves packages inside node_modules only', function () {
    const inside = resolveLockPackageDir(root, 'node_modules/foo');
    assert.ok(inside.endsWith(path.join('node_modules', 'foo')));
    assert.strictEqual(resolveLockPackageDir(root, 'stores/hub'), null);
    assert.strictEqual(resolveLockPackageDir(root, 'node_modules/../../etc'), null);
  });
});
