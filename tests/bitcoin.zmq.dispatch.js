'use strict';

const assert = require('assert');
const bitcoinjs = require('bitcoinjs-lib');
const Bitcoin = require('../services/bitcoin');
const Message = require('../types/message');

// A minimal regtest-shaped transaction and an 80-byte header.
function sampleTx () {
  const tx = new bitcoinjs.Transaction();
  tx.addInput(Buffer.alloc(32, 7), 0);
  tx.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), BigInt(1000));
  return tx;
}

function service () {
  const svc = new Bitcoin({ network: 'regtest', mode: 'rpc', managed: false });
  const calls = [];
  svc._makeRPCRequest = async (method, params) => {
    calls.push(method);
    if (method === 'gettxoutsetinfo') return { height: 101, total_amount: 5050 };
    if (method === 'getblock') return { height: 101, tx: [] };
    if (method === 'getrawtransaction') return { txid: params[0], hex: sampleTx().toHex() };
    if (method === 'getbalances') return { mine: { trusted: 1 } };
    return null;
  };
  svc.broadcastWatchtower = async () => {};
  svc.commit = () => {};
  return { svc, calls };
}

describe('Bitcoin ZMQ dispatch', function () {
  const tipHex = 'ab'.repeat(32);

  for (const [label, frame] of [
    ['Message (services/zmq)', () => Message.fromLegacyBody('BitcoinBlockHash', { content: tipHex })],
    ['raw [topic, bytes]', () => ['hashblock', Buffer.from(tipHex, 'hex')]]
  ]) {
    it(`hashblock as ${label} emits one block with the tip`, async function () {
      const { svc, calls } = service();
      const blocks = [];
      svc.on('block', (b) => blocks.push(b));
      await svc._handleZMQMessage(frame());
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].tip, tipHex);
      assert.strictEqual(blocks[0].height, 101);
      assert.ok(calls.includes('getblock'));
    });
  }

  it('rawblock emits rawBlock with the header hash, not a second block', async function () {
    const { svc } = service();
    const header = Buffer.alloc(80, 3);
    const raw = Buffer.concat([header, Buffer.from([0])]);
    const blocks = [];
    const rawBlocks = [];
    svc.on('block', (b) => blocks.push(b));
    svc.on('rawBlock', (b) => rawBlocks.push(b));
    await svc._handleZMQMessage(Message.fromLegacyBody('BitcoinBlock', { content: raw.toString('hex') }));
    assert.strictEqual(blocks.length, 0);
    assert.strictEqual(rawBlocks.length, 1);
    const want = Buffer.from(bitcoinjs.crypto.hash256(header)).reverse().toString('hex');
    assert.strictEqual(rawBlocks[0].hash, want);
  });

  it('rawtx and hashtx for one transaction emit one transaction event', async function () {
    const { svc, calls } = service();
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['rawtx', Buffer.from(tx.toHex(), 'hex')]);
    await svc._handleZMQMessage(Message.fromLegacyBody('BitcoinTransactionHash', { content: tx.getId() }));
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].txid, tx.getId());
    assert.ok(!calls.includes('getrawtransaction'), 'hashtx after rawtx does not refetch');
  });

  it('hashtx first waits for its rawtx instead of fetching the transaction', async function () {
    const { svc, calls } = service();
    svc.settings.zmqHashTxGraceMs = 10;
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['hashtx', Buffer.from(tx.getId(), 'hex')]);
    await svc._handleZMQMessage(Message.fromLegacyBody('BitcoinTransaction', { content: tx.toHex() }));
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].source, 'BitcoinTransaction');
    assert.ok(!calls.includes('getrawtransaction'));
  });

  it('a hashtx whose rawtx never comes is fetched once after the grace', async function () {
    const { svc, calls } = service();
    svc.settings.zmqHashTxGraceMs = 10;
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['hashtx', Buffer.from(tx.getId(), 'hex')]);
    await svc._handleZMQMessage(['hashtx', Buffer.from(tx.getId(), 'hex')]);
    assert.strictEqual(events.length, 0, 'nothing fetched inside the grace');
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].source, 'BitcoinTransactionHash');
    assert.strictEqual(calls.filter((m) => m === 'getrawtransaction').length, 1);
  });

  it('without a rawtx subscription, hashtx fetches at once', async function () {
    const { svc, calls } = service();
    svc.zmq.settings.subscriptions = ['hashblock', 'hashtx'];
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['hashtx', Buffer.from(tx.getId(), 'hex')]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(calls.filter((m) => m === 'getrawtransaction').length, 1);
  });

  it('a burst of rawtx reads balances once, then once more after the window', async function () {
    const { svc, calls } = service();
    // Wider than the burst takes on a loaded machine, or the trailing read
    // would already be due before the first assertion.
    svc.settings.balanceRefreshMs = 400;
    for (let i = 0; i < 50; i++) {
      const tx = sampleTx();
      tx.addOutput(Buffer.from('0014' + '22'.repeat(20), 'hex'), BigInt(i + 1));
      svc._handleZMQMessage(['rawtx', Buffer.from(tx.toHex(), 'hex')]);
    }
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(calls.filter((m) => m === 'getbalances').length, 1, 'leading read only');
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(calls.filter((m) => m === 'getbalances').length, 2, 'one trailing read');
  });

  it('pauses transaction topics during initial block download and resumes after', async function () {
    const { svc, calls } = service();
    svc.settings.zmqIbdPollMs = 10;
    let ibd = true;
    const rpc = svc._makeRPCRequest;
    svc._makeRPCRequest = async (method, params) => {
      if (method === 'getblockchaininfo') return { initialblockdownload: ibd };
      return rpc(method, params);
    };
    const paused = new Set();
    svc.zmq.socket = { subscribe: (n) => paused.delete(n), unsubscribe: (n) => paused.add(n), close () {} };
    await svc._gateZMQTransactions();
    assert.deepStrictEqual(Array.from(paused).sort(), ['hashtx', 'rawtx']);
    assert.ok(!svc._zmqReceives('rawtx'));
    ibd = false;
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(paused.size, 0);
    assert.ok(svc._zmqReceives('rawtx'));
    assert.ok(calls.includes('getbalances'), 'balances read once caught up');
    assert.ok(calls.includes('getrawmempool'), 'mempool reconciled once caught up');
    // IBD keeps being checked, so a node that falls back into it pauses again.
    assert.notStrictEqual(svc._zmqIbdTimer, null, 'keeps checking after IBD');
    svc._queueHashTx('cd'.repeat(32), Date.now() + 1000);
    ibd = true;
    await new Promise((r) => setTimeout(r, 40));
    assert.deepStrictEqual(Array.from(paused).sort(), ['hashtx', 'rawtx'], 'paused again');
    assert.strictEqual(svc._zmqHashTxPending.size, 0, 'pausing drops queued hashtx fetches');
    await svc.stop();
  });

  it('checks IBD before subscribing, so no transaction topic is subscribed during IBD', async function () {
    const { svc } = service();
    svc.settings.zmqIbdPollMs = 1000;
    const rpc = svc._makeRPCRequest;
    svc._makeRPCRequest = async (method, params) => {
      if (method === 'getblockchaininfo') return { initialblockdownload: true };
      return rpc(method, params);
    };
    const subscribed = [];
    svc.zmq.connect = async function () {
      this.socket = { subscribe: (n) => subscribed.push(n), unsubscribe () {}, close () {} };
      return this;
    };
    await svc._startZMQ();
    assert.deepStrictEqual(subscribed, ['hashblock', 'rawblock']);
    await svc.stop();
  });

  it('an IBD check that answers after stop changes nothing', async function () {
    const { svc } = service();
    let answer = null;
    svc._makeRPCRequest = (method) => (method === 'getblockchaininfo'
      ? new Promise((resolve) => { answer = resolve; })
      : Promise.resolve(null));
    svc._zmqIbdStopped = false;
    svc._zmqIbdGeneration = 1;
    const pending = svc._gateZMQTransactions();
    await new Promise((r) => setImmediate(r));
    await svc.stop();
    answer({ initialblockdownload: true });
    await pending;
    assert.deepStrictEqual(svc.zmq.paused, [], 'no pause recorded');
    assert.strictEqual(svc._zmqIbdTimer, null, 'no new check scheduled');
    assert.strictEqual(svc.zmq.socket, null);
  });

  it('one drainer fetches queued hashtx, and queued plus in-flight stay within the cap', async function () {
    const { svc } = service();
    svc.settings.zmqHashTxGraceMs = 0;
    let concurrent = 0;
    let peak = 0;
    let release = null;
    const gate = new Promise((r) => { release = r; });
    svc._makeRPCRequest = async (method, params) => {
      if (method !== 'getrawtransaction') return null;
      concurrent++;
      peak = Math.max(peak, concurrent);
      await gate;
      concurrent--;
      return { txid: params[0], hex: sampleTx().toHex() };
    };
    const id = (i) => i.toString(16).padStart(64, '0');
    let accepted = 0;
    for (let i = 0; i < 5000; i++) if (svc._queueHashTx(id(i), 0)) accepted++;
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(svc._zmqHashTxInFlight !== null, true, 'one fetch in flight');
    assert.strictEqual(svc._zmqHashTxPending.size + 1, 4096, 'queued plus in flight at the cap');
    assert.strictEqual(accepted, 4096);
    assert.strictEqual(svc._queueHashTx(id(9999), 0), false, 'full queue refuses more');
    release();
    await svc.stop();
    assert.strictEqual(peak, 1, 'never more than one fetch at a time');
    assert.strictEqual(svc._zmqHashTxPending.size, 0);
  });

  it('reconciles the mempool into the queue after IBD, skipping what ZMQ delivered', async function () {
    const { svc } = service();
    const seen = 'aa'.repeat(32);
    const fresh = ['bb'.repeat(32), 'cc'.repeat(32)];
    svc._zmqTxMark(seen);
    const fetched = [];
    svc._makeRPCRequest = async (method, params) => {
      if (method === 'getrawmempool') return [seen, ...fresh, 'not-a-txid'];
      if (method === 'getrawtransaction') {
        fetched.push(params[0]);
        return { txid: params[0], hex: sampleTx().toHex() };
      }
      return null;
    };
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    assert.strictEqual(await svc._reconcileMempool(), 2);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(fetched, fresh);
    assert.strictEqual(events.length, 2);
  });

  it('a balance refresh stores the whole getbalances result', async function () {
    const { svc } = service();
    const result = { mine: { trusted: 1.5, untrusted_pending: 0.25, immature: 0 } };
    svc._makeRPCRequest = async (method) => (method === 'getbalances' ? result : null);
    await svc._refreshBalancesSoon();
    assert.deepStrictEqual(svc._state.balances, result);
    assert.strictEqual(svc.balance, 1.5);
  });

  it('a trailing balance refresh settles when the service stops', async function () {
    const { svc } = service();
    svc.settings.balanceRefreshMs = 60 * 1000;
    svc._balanceRefreshAt = Date.now();
    const pending = svc._refreshBalancesSoon();
    await svc.stop();
    const settled = await Promise.race([pending.then(() => true), new Promise((r) => setTimeout(() => r(false), 100))]);
    assert.strictEqual(settled, true);
  });

  it('services/zmq start leaves paused topics unsubscribed', async function () {
    const ZMQ = require('../services/zmq');
    const zmq = new ZMQ();
    const subscribed = [];
    zmq.connect = async function () {
      this.socket = { subscribe: (n) => subscribed.push(n), unsubscribe () {} };
      return this;
    };
    assert.deepStrictEqual(zmq.pause(['rawtx', 'nope']), ['rawtx']);
    await zmq.start();
    assert.deepStrictEqual(subscribed, ['hashblock', 'rawblock', 'hashtx']);
    assert.deepStrictEqual(zmq.resume(['rawtx']), ['rawtx']);
    assert.deepStrictEqual(subscribed, ['hashblock', 'rawblock', 'hashtx', 'rawtx']);
    assert.deepStrictEqual(zmq.paused, []);
  });

  it('RPC clients share a capped keep-alive agent', async function () {
    const http = require('http');
    let connections = 0;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { id } = JSON.parse(body);
        setTimeout(() => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id, result: 1 }));
        }, 2);
      });
    });
    server.on('connection', () => { connections++; });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const svc = new Bitcoin({ network: 'regtest', mode: 'rpc', managed: false, rpcMaxSockets: 4 });
    try {
      const client = svc._createRPCClientForCandidate({ host: '127.0.0.1', rpcport: server.address().port });
      const call = () => new Promise((resolve, reject) => client.request('getblockcount', [], (err, out) => (err ? reject(err) : resolve(out.result))));
      const results = await Promise.all(Array.from({ length: 100 }, call));
      assert.strictEqual(results.length, 100);
      assert.ok(connections <= 4, `${connections} connections for 100 calls`);
    } finally {
      svc._rpcAgent().destroy();
      await new Promise((r) => server.close(r));
    }
  });

  it('the socket cap holds across clients, and a stopped service gets a fresh agent', async function () {
    const http = require('http');
    let connections = 0;
    let open = 0;
    let peakOpen = 0;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { id } = JSON.parse(body);
        setTimeout(() => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id, result: 1 }));
        }, 2);
      });
    });
    server.on('connection', (socket) => {
      connections++;
      open++;
      peakOpen = Math.max(peakOpen, open);
      socket.on('close', () => { open--; });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const svc = new Bitcoin({ network: 'regtest', mode: 'rpc', managed: false, rpcMaxSockets: 3 });
    try {
      const candidate = { host: '127.0.0.1', rpcport: server.address().port };
      const clients = Array.from({ length: 4 }, () => svc._createRPCClientForCandidate(candidate));
      const calls = [];
      for (const client of clients) {
        for (let i = 0; i < 25; i++) calls.push(svc._requestWithRPCClient(client, 'getblockcount', []));
      }
      assert.strictEqual((await Promise.all(calls)).length, 100);
      assert.ok(peakOpen <= 3, `${peakOpen} sockets open at once across 4 clients`);

      const before = svc._rpcAgent();
      await svc.stop();
      assert.strictEqual(svc._rpcHttpAgent, null, 'stop drops the destroyed agent');
      // A client made before stop is moved onto the new agent on its next call.
      assert.strictEqual(await svc._requestWithRPCClient(clients[0], 'getblockcount', []), 1);
      assert.notStrictEqual(svc._rpcAgent(), before);
      assert.strictEqual(clients[0].options.agent, svc._rpcAgent());
      assert.ok(connections >= 1);
    } finally {
      if (svc._rpcHttpAgent) svc._rpcHttpAgent.destroy();
      await new Promise((r) => server.close(r));
    }
  });

  it('a failed hashtx fetch leaves rawtx to deliver the transaction', async function () {
    const { svc } = service();
    svc._makeRPCRequest = async (method) => {
      if (method === 'getrawtransaction') throw new Error('rpc down');
      return null;
    };
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['hashtx', Buffer.from(tx.getId(), 'hex')]);
    await svc._handleZMQMessage(['rawtx', Buffer.from(tx.toHex(), 'hex')]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].source, 'BitcoinTransaction');
  });

  it('with mempool watching off, hashtx does not suppress rawtx', async function () {
    const { svc } = service();
    svc.settings.walletWatchMempool = false;
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['hashtx', Buffer.from(tx.getId(), 'hex')]);
    await svc._handleZMQMessage(['rawtx', Buffer.from(tx.toHex(), 'hex')]);
    assert.strictEqual(events.length, 1);
  });

  it('a later admission of the same transaction notifies again after the pair window', async function () {
    const { svc } = service();
    svc.settings.zmqTxDedupeMs = 20;
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['rawtx', Buffer.from(tx.toHex(), 'hex')]);
    await svc._handleZMQMessage(['rawtx', Buffer.from(tx.toHex(), 'hex')]);
    assert.strictEqual(events.length, 1, 'same admission within the window');
    await new Promise((r) => setTimeout(r, 30));
    await svc._handleZMQMessage(['rawtx', Buffer.from(tx.toHex(), 'hex')]);
    assert.strictEqual(events.length, 2, 're-admission after the window');
  });

  it('services/zmq passes a block too big for a frame as raw bytes without throwing', function () {
    const ZMQ = require('../services/zmq');
    const zmq = new ZMQ();
    const out = [];
    zmq.on('message', (m) => out.push(m));
    zmq.on('warning', () => {});
    const big = Buffer.alloc(100 * 1024, 1);
    assert.doesNotThrow(() => zmq._handleSocketMessage(Buffer.from('rawblock'), big));
    assert.ok(Array.isArray(out[0]) && out[0][0] === 'rawblock' && out[0][1].length === big.length);
    zmq._handleSocketMessage(Buffer.from('hashblock'), Buffer.alloc(32, 2));
    assert.strictEqual(out[1].type, 'BITCOIN_BLOCK_HASH');
  });
});
