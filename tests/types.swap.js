'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const Htlc = require('../types/htlc');
const Swap = require('../types/swap');

bitcoin.initEccLib(ecc);

function randomPriv () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

/** In-memory regtest chain: funding builds a tx paying the address; mining confirms. */
class MockChain {
  constructor () {
    this.height = 100;
    this.txs = new Map();
    this.broadcasts = [];
  }

  mine (n = 1) {
    this.height += n;
    for (const tx of this.txs.values()) tx.confirmations += n;
  }

  adapter () {
    return {
      getTipHeight: async () => this.height,
      fundAddress: async (address, amountSats) => {
        const tx = new bitcoin.Transaction();
        tx.version = 2;
        tx.addInput(crypto.randomBytes(32), 0, 0xffffffff);
        tx.addOutput(bitcoin.address.toOutputScript(address, bitcoin.networks.regtest), BigInt(amountSats));
        const txid = tx.getId();
        this.txs.set(txid, { txHex: tx.toHex(), confirmations: 0 });
        return { txid, txHex: tx.toHex() };
      },
      getTransaction: async (txid) => {
        const tx = this.txs.get(txid);
        return tx ? Object.assign({}, tx) : null;
      },
      broadcast: async (txHex) => {
        const tx = bitcoin.Transaction.fromHex(txHex);
        if (tx.locktime > this.height) throw new Error('non-final transaction');
        this.broadcasts.push(txHex);
        this.txs.set(tx.getId(), { txHex, confirmations: 0 });
        return tx.getId();
      },
      getNewAddress: async () => bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(ecc.pointFromScalar(randomPriv(), true)),
        network: bitcoin.networks.regtest
      }).address
    };
  }
}

/** Shared mock Lightning network: one invoice table, one adapter per node. */
class MockLightning {
  constructor (clock) {
    this.clock = clock;
    this.invoices = new Map();
    this.count = 0;
  }

  node (nodeId) {
    return {
      createInvoice: async ({ amountMsat, preimageHex, expirySeconds }) => {
        const preimage = preimageHex ? Buffer.from(preimageHex, 'hex') : crypto.randomBytes(32);
        const hash = crypto.createHash('sha256').update(preimage).digest('hex');
        const bolt11 = `lnbcrt${++this.count}mock`;
        this.invoices.set(bolt11, {
          payee: nodeId,
          hash,
          preimage: preimage.toString('hex'),
          amountMsat,
          createdAt: Math.floor(this.clock() / 1000),
          expiry: expirySeconds || 3600,
          paid: false
        });
        return { bolt11, paymentHash: hash };
      },
      decodeInvoice: async (bolt11) => {
        const inv = this.invoices.get(bolt11);
        if (!inv) throw new Error('unknown invoice');
        return { payment_hash: inv.hash, amount_msat: inv.amountMsat, created_at: inv.createdAt, expiry: inv.expiry, payee: inv.payee };
      },
      pay: async (bolt11) => {
        const inv = this.invoices.get(bolt11);
        if (!inv) throw new Error('unknown invoice');
        inv.paid = true;
        return { status: 'complete', paymentPreimage: inv.preimage };
      },
      isInvoicePaid: async (hash) => {
        for (const inv of this.invoices.values()) if (inv.hash === hash && inv.paid) return true;
        return false;
      }
    };
  }
}

function setup (side, orderOverrides = {}) {
  let clock = 1700000000000;
  const now = () => clock;
  const chain = new MockChain();
  const ln = new MockLightning(now);
  const makerKey = randomPriv();
  const takerKey = randomPriv();
  const makerHtlcKey = randomPriv();
  const takerHtlcKey = randomPriv();
  const makerNode = Swap.pubkeyFromPrivate(randomPriv());
  const takerNode = Swap.pubkeyFromPrivate(randomPriv());
  const order = Swap.signBody(Swap.toBody(Swap.BODY_TYPES.ORDER, Object.assign({
    side,
    premiumPpm: 2000,
    feeSats: 100,
    minSats: 10000,
    maxSats: 500000,
    prepaySats: 0,
    refundLockBlocks: 144,
    createdAt: clock,
    expiresAt: clock + 3600000,
    makerPubkey: Swap.pubkeyFromPrivate(makerKey),
    lightningNodeId: makerNode,
    network: 'regtest',
    nonce: Swap.randomNonce()
  }, orderOverrides)), makerKey);
  const maker = new Swap({
    order,
    role: 'maker',
    identityKey: makerKey,
    htlcKey: makerHtlcKey,
    adapters: { bitcoin: chain.adapter(), lightning: ln.node(makerNode) },
    now
  });
  const taker = new Swap({
    order,
    role: 'taker',
    identityKey: takerKey,
    htlcKey: takerHtlcKey,
    lightningNodeId: takerNode,
    adapters: { bitcoin: chain.adapter(), lightning: ln.node(takerNode) },
    now
  });
  return { chain, ln, order, maker, taker, makerKey, takerKey, makerHtlcKey, takerHtlcKey, advance: (ms) => { clock += ms; } };
}

async function negotiate (ctx, amountSats = 100000) {
  const take = await ctx.taker.createTake({ amountSats });
  const accept = await ctx.maker.acceptTake(JSON.parse(JSON.stringify(take)));
  await ctx.taker.applyAccept(JSON.parse(JSON.stringify(accept)));
  return { take, accept };
}

describe('types/swap', function () {
  it('assigns settlement roles from the order side', function () {
    const ask = setup('ask');
    assert.strictEqual(ask.maker.role, 'l1Giver');
    assert.strictEqual(ask.taker.role, 'l2Giver');
    const bid = setup('bid');
    assert.strictEqual(bid.maker.role, 'l2Giver');
    assert.strictEqual(bid.taker.role, 'l1Giver');
  });

  it('settles a take on an ask: maker funds L1, taker pays L2 and claims', async function () {
    const ctx = setup('ask');
    const states = [];
    ctx.maker.on('state', ({ to }) => states.push(to));
    await negotiate(ctx);
    assert.strictEqual(ctx.taker.quote.l2Msat, (100200 + 100) * 1000);

    const funded = await ctx.maker.fund();
    assert.strictEqual(ctx.maker.status, 'l1Funded');
    const pending = await ctx.taker.applyFunded(funded);
    assert.deepStrictEqual(pending, { ok: false, pending: true, confirmations: 0 });
    ctx.chain.mine(1);
    assert.strictEqual((await ctx.taker.applyFunded(funded)).ok, true);

    const preimageHex = await ctx.taker.payInvoice();
    assert.strictEqual(crypto.createHash('sha256').update(Buffer.from(preimageHex, 'hex')).digest('hex'), ctx.taker.terms.paymentHashHex);
    assert.strictEqual(await ctx.maker.checkPaid(), true);

    const claimTxid = await ctx.taker.claim();
    assert.strictEqual(ctx.taker.status, 'l1Claimed');
    const claimHex = ctx.chain.broadcasts[0];
    assert.strictEqual(bitcoin.Transaction.fromHex(claimHex).getId(), claimTxid);
    const found = Htlc.extractPreimage(claimHex, ctx.taker.terms.paymentHashHex);
    assert.strictEqual(found.preimageHex, preimageHex);
    assert.strictEqual(ctx.maker.observeClaim(claimHex), true);
    assert.deepStrictEqual(states, ['accepted', 'l1Funded', 'l2Paid', 'l1Claimed']);
  });

  it('settles a take on a bid: taker funds L1, maker pays L2 and claims', async function () {
    const ctx = setup('bid');
    const { take } = await negotiate(ctx, 50000);
    assert.ok(take.invoice && take.paymentHashHex, 'taker (L1 giver) sends the terms');
    assert.strictEqual(ctx.maker.quote.l2Msat, (50100 - 100) * 1000);
    const funded = await ctx.taker.fund();
    ctx.chain.mine(1);
    assert.strictEqual((await ctx.maker.applyFunded(funded)).ok, true);
    await ctx.maker.payInvoice();
    await ctx.maker.claim();
    assert.strictEqual(ctx.maker.status, 'l1Claimed');
    assert.strictEqual(await ctx.taker.checkPaid(), true);
    assert.strictEqual(ctx.taker.observeClaim(ctx.chain.broadcasts[0]), true);
  });

  it('requires the prepay before a maker funds', async function () {
    const ctx = setup('ask', { prepaySats: 1000 });
    const { accept } = await negotiate(ctx);
    assert.ok(accept.prepayInvoice);
    await assert.rejects(ctx.maker.fund(), /prepay not received/);
    await ctx.taker.prepay();
    assert.strictEqual(ctx.taker.status, 'prepaid');
    await ctx.maker.fund();
    assert.deepStrictEqual(ctx.maker.toJSON().history.map((h) => h.to), ['accepted', 'prepaid', 'l1Funded']);
  });

  it('refunds the L1 giver after the lock when the invoice is never paid', async function () {
    const ctx = setup('ask');
    await negotiate(ctx);
    await ctx.maker.fund();
    await assert.rejects(ctx.maker.refund(), /refund lock opens/);
    ctx.chain.mine(144);
    assert.strictEqual(await ctx.maker.checkPaid(), false);
    const txid = await ctx.maker.refund();
    assert.strictEqual(ctx.maker.status, 'refunded');
    const refundTx = bitcoin.Transaction.fromHex(ctx.chain.broadcasts[0]);
    assert.strictEqual(refundTx.getId(), txid);
    assert.strictEqual(refundTx.locktime, ctx.maker.terms.refundLockHeight);
  });

  it('refuses a funding notice for the wrong address or amount', async function () {
    const ctx = setup('ask');
    await negotiate(ctx);
    const funded = await ctx.maker.fund();
    const other = Swap.buildEscrow({
      networkName: 'regtest',
      l2GiverPubkeyHex: ctx.maker.htlcPubkey,
      l1GiverPubkeyHex: ctx.maker.htlcPubkey,
      paymentHashHex: ctx.maker.terms.paymentHashHex,
      refundLockHeight: ctx.maker.terms.refundLockHeight
    });
    const wrongAddress = Swap.signBody(Object.assign({}, funded, { paymentAddress: other.paymentAddress }), ctx.makerKey);
    await assert.rejects(ctx.taker.applyFunded(wrongAddress), /does not match the swap HTLC/);
    const wrongAmount = Swap.signBody(Object.assign({}, funded, { amountSats: funded.amountSats - 1 }), ctx.makerKey);
    await assert.rejects(ctx.taker.applyFunded(wrongAmount), /funded amount/);
    const forged = Object.assign({}, funded, { txid: 'ab'.repeat(32) });
    await assert.rejects(ctx.taker.applyFunded(forged), /bad signature/);
  });

  it('rejects a take that does not match the order and illegal transitions', async function () {
    const ctx = setup('ask');
    const take = await ctx.taker.createTake({ amountSats: 100000 });
    const tampered = Object.assign({}, take, { amountSats: 1 });
    await assert.rejects(ctx.maker.acceptTake(tampered), /invalid take/);
    await assert.rejects(ctx.taker.createTake({ amountSats: 100000 }), /expected state new/);
    await assert.rejects(ctx.taker.fund(), /expected state accepted/);
    assert.throws(() => new Swap({
      order: ctx.order,
      role: 'maker',
      identityKey: randomPriv(),
      htlcKey: randomPriv(),
      adapters: { bitcoin: {}, lightning: {} }
    }), /does not match the order/);
  });

  it('refuses an invoice that would outlive the refund lock', async function () {
    const ctx = setup('ask', { refundLockBlocks: 20 });
    ctx.maker.settings.secondsPerBlock = 60;
    await ctx.taker.createTake({ amountSats: 100000 });
    await assert.rejects(ctx.maker.acceptTake(ctx.taker.take), /refund lock too short/);
  });

  it('aborts only before funding and restores from JSON', async function () {
    const ctx = setup('ask');
    await negotiate(ctx);
    const saved = JSON.parse(JSON.stringify(ctx.maker.toJSON({ includeSecrets: true })));
    assert.ok(saved.preimageHex);
    assert.strictEqual(ctx.maker.toJSON().preimageHex, undefined);
    const restored = Swap.fromJSON(saved, {
      identityKey: ctx.makerKey,
      htlcKey: ctx.makerHtlcKey,
      adapters: ctx.maker.adapters
    });
    assert.strictEqual(restored.status, 'accepted');
    assert.strictEqual(restored.takeId, ctx.maker.takeId);
    await ctx.maker.fund();
    assert.throws(() => ctx.maker.abort(), /expected state/);
    ctx.taker.abort('changed my mind');
    assert.strictEqual(ctx.taker.status, 'aborted');
  });

  it('refuses to restore with keys the saved swap was not made with', async function () {
    const ctx = setup('ask');
    await negotiate(ctx);
    const maker = JSON.parse(JSON.stringify(ctx.maker.toJSON({ includeSecrets: true })));
    assert.throws(() => Swap.fromJSON(maker, {
      identityKey: ctx.makerKey,
      htlcKey: randomPriv(),
      adapters: ctx.maker.adapters
    }), /htlcKey does not match/);
    const taker = JSON.parse(JSON.stringify(ctx.taker.toJSON()));
    const takerSettings = { htlcKey: ctx.takerHtlcKey, adapters: ctx.taker.adapters };
    assert.throws(() => Swap.fromJSON(taker, Object.assign({ identityKey: randomPriv() }, takerSettings)), /identityKey does not match/);
    assert.throws(() => Swap.fromJSON(taker, Object.assign({}, takerSettings, { identityKey: ctx.takerKey, htlcKey: randomPriv() })), /htlcKey does not match/);
    assert.strictEqual(Swap.fromJSON(taker, Object.assign({ identityKey: ctx.takerKey }, takerSettings)).status, 'accepted');
  });

  it('settles an order at the shortest refund lock', async function () {
    assert.strictEqual(Swap.MIN_REFUND_LOCK_BLOCKS, 15);
    for (const side of ['ask', 'bid']) {
      const ctx = setup(side, { refundLockBlocks: Swap.MIN_REFUND_LOCK_BLOCKS, prepaySats: side === 'ask' ? 1000 : 0 });
      await negotiate(ctx);
      assert.ok(ctx.taker.terms.invoice);
    }
    assert.throws(() => Swap.toBody(Swap.BODY_TYPES.ORDER, Object.assign({}, setup('ask').order, { refundLockBlocks: 14, signature: undefined })), /refundLockBlocks/);
  });

  it('funds once: a send that returns moves the swap to l1Funded even when the notice fails', async function () {
    const ctx = setup('ask');
    await negotiate(ctx);
    const fundAddress = ctx.maker.adapters.bitcoin.fundAddress;
    let sends = 0;
    ctx.maker.adapters.bitcoin.fundAddress = async (address, amountSats) => {
      sends++;
      const sent = await fundAddress(address, amountSats);
      return { txid: sent.txid };
    };
    await assert.rejects(ctx.maker.fund(), /HTLC funded but no funding notice/);
    assert.strictEqual(ctx.maker.status, 'l1Funded');
    assert.strictEqual(ctx.maker.funded, null);
    assert.ok(ctx.maker.escrow);
    await assert.rejects(ctx.maker.fund(), /expected state/);
    assert.strictEqual(sends, 1);
    ctx.chain.mine(144);
    await ctx.maker.refund();
    assert.strictEqual(ctx.maker.status, 'refunded');
  });

  it('funds once: a concurrent fund or abort is refused while the send is in flight', async function () {
    const ctx = setup('ask');
    await negotiate(ctx);
    const fundAddress = ctx.maker.adapters.bitcoin.fundAddress;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let sends = 0;
    ctx.maker.adapters.bitcoin.fundAddress = async (address, amountSats) => {
      sends++;
      await gate;
      return fundAddress(address, amountSats);
    };
    const first = ctx.maker.fund();
    await assert.rejects(ctx.maker.fund(), /funding already started/);
    assert.throws(() => ctx.maker.abort(), /funding already started/);
    release();
    await first;
    assert.strictEqual(sends, 1);
    assert.strictEqual(ctx.maker.status, 'l1Funded');
  });

  it('funds again after a send that sent nothing', async function () {
    const ctx = setup('ask');
    await negotiate(ctx);
    const fundAddress = ctx.maker.adapters.bitcoin.fundAddress;
    ctx.maker.adapters.bitcoin.fundAddress = async () => { throw new Error('insufficient funds'); };
    await assert.rejects(ctx.maker.fund(), /insufficient funds/);
    assert.strictEqual(ctx.maker.status, 'accepted');
    ctx.maker.adapters.bitcoin.fundAddress = fundAddress;
    await ctx.maker.fund();
    assert.strictEqual(ctx.maker.status, 'l1Funded');
  });

  it('lightningAdapter maps onto services/lightning', async function () {
    const calls = [];
    const fake = {
      createInvoice: async (...args) => { calls.push(['createInvoice', args]); return { bolt11: 'b', paymentHash: 'h' }; },
      decodePay: async (b) => { calls.push(['decodePay', [b]]); return {}; },
      pay: async (b) => { calls.push(['pay', [b]]); return { paymentPreimage: 'p' }; },
      callRpc: async (method, params) => {
        calls.push([method, params]);
        if (method === 'decode') {
          if (params[0] === 'old') throw new Error('Unknown command');
          return { valid: true, payment_hash: 'h' };
        }
        return { invoices: [{ status: 'paid' }] };
      }
    };
    const adapter = Swap.lightningAdapter(fake);
    await adapter.createInvoice({ amountMsat: 5, label: 'l', description: 'd', preimageHex: 'aa', expirySeconds: 60 });
    assert.deepStrictEqual(calls[0], ['createInvoice', [5, 'l', 'd', { preimage: 'aa', expiry: 60 }]]);
    assert.strictEqual(await adapter.isInvoicePaid('ff'), true);
    assert.deepStrictEqual(calls[1], ['listinvoices', { payment_hash: 'ff' }]);
    assert.deepStrictEqual(await adapter.decodeInvoice('new'), { valid: true, payment_hash: 'h' });
    await adapter.decodeInvoice('old');
    assert.deepStrictEqual(calls.slice(-2), [['decode', ['old']], ['decodePay', ['old']]]);
  });

  it('bitcoinAdapter funds from a named wallet when given one', async function () {
    const calls = [];
    const fake = {
      _makeRPCRequest: async (method, params) => { calls.push(['node', method, params]); return method === 'getblockcount' ? 101 : {}; },
      _makeWalletRequest: async (method, params, wallet) => {
        calls.push([wallet, method, params]);
        return method === 'sendtoaddress' ? 'txid' : { hex: '00' };
      }
    };
    const adapter = Swap.bitcoinAdapter(fake, { wallet: 'miner' });
    assert.strictEqual(await adapter.getTipHeight(), 101);
    assert.deepStrictEqual(await adapter.fundAddress('bcrt1q', 12345), { txid: 'txid', txHex: '00' });
    assert.deepStrictEqual(calls.map((c) => c.slice(0, 2)), [['node', 'getblockcount'], ['miner', 'sendtoaddress'], ['miner', 'gettransaction']]);
    assert.deepStrictEqual(calls[1][2], ['bcrt1q', 0.00012345]);
  });

  it('bitcoinAdapter keeps the txid when the lookup after a send fails', async function () {
    const fake = {
      _makeRPCRequest: async (method) => {
        if (method === 'sendtoaddress') return 'txid';
        throw new Error('wallet locked');
      }
    };
    const adapter = Swap.bitcoinAdapter(fake);
    assert.deepStrictEqual(await adapter.fundAddress('bcrt1q', 12345), { txid: 'txid', txHex: null });
    const failing = Swap.bitcoinAdapter({ _makeRPCRequest: async () => { throw new Error('insufficient funds'); } });
    await assert.rejects(() => failing.fundAddress('bcrt1q', 12345), /insufficient funds/);
  });
});
