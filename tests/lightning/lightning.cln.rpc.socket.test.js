'use strict';

/**
 * Exercises {@link Lightning#_makeRPCRequest} against a minimal JSON-RPC 2.0
 * server on a Unix domain socket (same wire shape as Core Lightning).
 */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const Lightning = require('../../services/lightning');

function createMockClnSocketServer (datadir, socketName, handler) {
  const socketPath = path.join(datadir, socketName);
  const server = net.createServer((client) => {
    let buf = '';
    client.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let req;
      try {
        req = JSON.parse(line);
      } catch (e) {
        client.write(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'parse error' }
        }) + '\n');
        return;
      }
      const reply = handler(req);
      client.write(JSON.stringify(reply) + '\n');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve(server));
  });
}

describe('@fabric/core/services/lightning CLN JSON-RPC socket', function () {
  let tmpDir;
  const socketName = 'lightning-rpc-mock.sock';

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-ln-rpc-'));
  });

  afterEach(function () {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('_makeRPCRequest resolves result from a line-delimited JSON-RPC response', async function () {
    const server = await createMockClnSocketServer(tmpDir, socketName, (req) => {
      assert.strictEqual(req.jsonrpc, '2.0');
      assert.strictEqual(req.method, 'getinfo');
      assert.deepStrictEqual(req.params, []);
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          id: '026e89b2b58b7f5f7b0b8c0d0e0f101112131415161718191a1b1c1d1e1f2021',
          alias: 'mock',
          color: '012345',
          blockheight: 42
        }
      };
    });

    const ln = new Lightning({
      datadir: tmpDir,
      socket: socketName,
      managed: false
    });

    const info = await ln._makeRPCRequest('getinfo', [], 5000);
    assert.strictEqual(info.alias, 'mock');
    assert.strictEqual(info.blockheight, 42);

    await new Promise((resolve) => server.close(resolve));
  });

  it('_makeRPCRequest rejects on JSON-RPC error object', async function () {
    const server = await createMockClnSocketServer(tmpDir, socketName, () => ({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -1, message: 'Lightning is locked' }
    }));

    const ln = new Lightning({
      datadir: tmpDir,
      socket: socketName,
      managed: false
    });

    await assert.rejects(
      () => ln._makeRPCRequest('stop', [], 3000),
      (err) => err.message === 'Lightning is locked'
    );

    await new Promise((resolve) => server.close(resolve));
  });

  it('_makeRPCRequest times out when the server never responds', async function () {
    const socketPath = path.join(tmpDir, socketName);
    // Drain incoming bytes so the client's write() does not block the event loop (no drain
    // can stall the loop long enough that the RPC timeout timer never fires on some OSes).
    const server = net.createServer((sock) => {
      sock.on('data', () => {});
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    const ln = new Lightning({
      datadir: tmpDir,
      socket: socketName,
      managed: false
    });

    await assert.rejects(
      () => ln._makeRPCRequest('getinfo', [], 80),
      /Lightning RPC timeout/
    );

    await new Promise((resolve) => server.close(resolve));
  });

  it('redactSensitiveCommandArg matches lightning.js implementation', function () {
    const redact = Lightning.redactSensitiveCommandArg;
    assert.strictEqual(
      redact('--bitcoin-rpcpassword=secret'),
      '--bitcoin-rpcpassword=[REDACTED]'
    );
    assert.strictEqual(
      redact('--bitcoin-rpcuser=alice'),
      '--bitcoin-rpcuser=[REDACTED]'
    );
    assert.strictEqual(redact('--addr=127.0.0.1:9735'), '--addr=127.0.0.1:9735');
  });
});
