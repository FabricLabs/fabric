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

  it('hashtx first fetches the transaction once; the later rawtx is skipped', async function () {
    const { svc, calls } = service();
    const tx = sampleTx();
    const events = [];
    svc.on('transaction', (t) => events.push(t));
    await svc._handleZMQMessage(['hashtx', Buffer.from(tx.getId(), 'hex')]);
    await svc._handleZMQMessage(Message.fromLegacyBody('BitcoinTransaction', { content: tx.toHex() }));
    assert.strictEqual(events.length, 1);
    assert.strictEqual(calls.filter((m) => m === 'getrawtransaction').length, 1);
  });
});
