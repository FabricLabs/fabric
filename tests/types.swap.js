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

function orderFields (makerPriv, overrides = {}) {
  return Object.assign({
    type: Swap.BODY_TYPES.ORDER,
    side: 'ask',
    premiumPpm: 2500,
    feeSats: 100,
    minSats: 10000,
    maxSats: 1000000,
    prepaySats: 0,
    refundLockBlocks: 144,
    createdAt: 1000,
    expiresAt: 2000000000000,
    makerPubkey: Swap.pubkeyFromPrivate(makerPriv),
    lightningNodeId: Swap.pubkeyFromPrivate(randomPriv()),
    network: 'regtest',
    nonce: Swap.randomNonce()
  }, overrides);
}

describe('types/swap bodies', function () {
  describe('quote', function () {
    it('prices L2 at par plus premium, fee added on asks', function () {
      const q = Swap.quote({ side: 'ask', premiumPpm: 10000, feeSats: 50, amountSats: 100000 });
      assert.strictEqual(q.l1Sats, 100000);
      assert.strictEqual(q.l2Msat, (101000 + 50) * 1000);
      assert.strictEqual(q.feeMsat, 50000);
    });

    it('subtracts the fee on bids so it still reaches the maker', function () {
      const q = Swap.quote({ side: 'bid', premiumPpm: 10000, feeSats: 50, amountSats: 100000 });
      assert.strictEqual(q.l2Msat, (101000 - 50) * 1000);
      assert.strictEqual(q.feeMsat, -50000);
    });

    it('handles negative premiums and rounds to the nearest msat', function () {
      const q = Swap.quote({ side: 'ask', premiumPpm: -3, amountSats: 1 });
      assert.strictEqual(q.l2Msat, 1000);
      const q2 = Swap.quote({ side: 'ask', premiumPpm: -600, amountSats: 1 });
      assert.strictEqual(q2.l2Msat, 999);
      assert.strictEqual(q2.l2Sats, 1);
    });

    it('is exact for large amounts and refuses unsafe ones', function () {
      const q = Swap.quote({ side: 'ask', premiumPpm: 1, amountSats: 123456789 });
      // 123456789000 msat × 1.000001 = 123456912456.789
      assert.strictEqual(q.l2Msat, 123456912457);
      assert.throws(() => Swap.quote({ side: 'ask', premiumPpm: 0, amountSats: 2100000000000000 }), /too large/);
    });

    it('refuses a fee larger than the L2 amount and out-of-range premiums', function () {
      assert.throws(() => Swap.quote({ side: 'bid', premiumPpm: 0, feeSats: 2000, amountSats: 1000 }), /fee exceeds/);
      assert.throws(() => Swap.quote({ side: 'ask', premiumPpm: Swap.MAX_PREMIUM_PPM + 1, amountSats: 1000 }), /premiumPpm/);
      assert.throws(() => Swap.quote({ side: 'sideways', premiumPpm: 0, amountSats: 1000 }), /side/);
    });
  });

  describe('roles', function () {
    it('the L1 giver is the ask maker or the bid taker', function () {
      assert.strictEqual(Swap.roleFor({ side: 'ask', isMaker: true }), 'l1Giver');
      assert.strictEqual(Swap.roleFor({ side: 'ask', isMaker: false }), 'l2Giver');
      assert.strictEqual(Swap.roleFor({ side: 'bid', isMaker: true }), 'l2Giver');
      assert.strictEqual(Swap.roleFor({ side: 'bid', isMaker: false }), 'l1Giver');
    });

    it('roles names the preimage owner', function () {
      const ask = Swap.roles({ side: 'ask', maker: 'M', taker: 'T' });
      assert.deepStrictEqual(ask, { l1Giver: 'M', l2Giver: 'T', preimageOwner: 'M', makerIsL1Giver: true });
      const bid = Swap.roles({ side: 'bid', maker: 'M', taker: 'T' });
      assert.deepStrictEqual(bid, { l1Giver: 'T', l2Giver: 'M', preimageOwner: 'T', makerIsL1Giver: false });
    });
  });

  describe('bodies and signatures', function () {
    it('signs and verifies an order; id is stable across signing', function () {
      const priv = randomPriv();
      const unsigned = Swap.toBody(Swap.BODY_TYPES.ORDER, orderFields(priv));
      const signed = Swap.signBody(unsigned, priv);
      assert.strictEqual(Swap.bodyId(unsigned), Swap.bodyId(signed));
      const v = Swap.verifyBody(JSON.parse(JSON.stringify(signed)));
      assert.strictEqual(v.ok, true, v.reason);
      assert.strictEqual(v.id, Swap.bodyId(signed));
    });

    it('rejects tampering, unsigned bodies, and foreign keys', function () {
      const priv = randomPriv();
      const signed = Swap.signBody(Swap.toBody(Swap.BODY_TYPES.ORDER, orderFields(priv)), priv);
      const tampered = Object.assign({}, signed, { premiumPpm: signed.premiumPpm + 1 });
      assert.strictEqual(Swap.verifyBody(tampered).reason, 'bad signature');
      const unsigned = Object.assign({}, signed);
      delete unsigned.signature;
      assert.strictEqual(Swap.verifyBody(unsigned).reason, 'unsigned body');
      assert.throws(() => Swap.signBody(signed, randomPriv()), /does not match makerPubkey/);
    });

    it('fromBody returns null for other types, versions, and malformed fields', function () {
      const priv = randomPriv();
      assert.strictEqual(Swap.fromBody({ type: 'FraudProof' }), null);
      assert.strictEqual(Swap.fromBody({ type: 'toString' }), null);
      assert.strictEqual(Swap.fromBody({ type: '__proto__' }), null);
      assert.strictEqual(Swap.verifyBody({ type: 'constructor' }).reason, 'malformed body');
      assert.throws(() => Swap.toBody('hasOwnProperty', {}), /unknown body type/);
      assert.strictEqual(Swap.fromBody(Object.assign(orderFields(priv), { version: 2 })), null);
      assert.strictEqual(Swap.fromBody(orderFields(priv, { minSats: 10 })), null);
      assert.strictEqual(Swap.fromBody(orderFields(priv, { maxSats: 5000, minSats: 10000 })), null);
      assert.strictEqual(Swap.fromBody(orderFields(priv, { expiresAt: 500 })), null);
      assert.strictEqual(Swap.fromBody(orderFields(priv, { refundLockBlocks: 1 })), null);
      assert.strictEqual(Swap.fromBody(orderFields(priv, { instrument: 'BTC/USD' })), null);
      assert.ok(Swap.fromBody(orderFields(priv)));
    });

    it('round-trips every body type', function () {
      const maker = randomPriv();
      const taker = randomPriv();
      const order = Swap.signBody(Swap.toBody(Swap.BODY_TYPES.ORDER, orderFields(maker)), maker);
      const orderId = Swap.bodyId(order);
      const bodies = [
        Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId, makerPubkey: order.makerPubkey, createdAt: 5 }, maker),
        Swap.signBody({
          type: Swap.BODY_TYPES.TAKE,
          orderId,
          side: 'ask',
          premiumPpm: order.premiumPpm,
          amountSats: 20000,
          takerPubkey: Swap.pubkeyFromPrivate(taker),
          takerHtlcPubkey: Swap.pubkeyFromPrivate(randomPriv()),
          takerNodeId: Swap.pubkeyFromPrivate(randomPriv()),
          createdAt: 6,
          nonce: Swap.randomNonce()
        }, taker),
        Swap.signBody({
          type: Swap.BODY_TYPES.TAKE_ACCEPT,
          orderId,
          takeId: 'ab'.repeat(32),
          makerPubkey: order.makerPubkey,
          makerHtlcPubkey: Swap.pubkeyFromPrivate(randomPriv()),
          paymentHashHex: 'cd'.repeat(32),
          invoice: 'lnbcrt1mock',
          refundLockHeight: 300,
          prepayInvoice: 'lnbcrt1prepay',
          createdAt: 7
        }, maker),
        Swap.signBody({
          type: Swap.BODY_TYPES.FUNDED,
          takeId: 'ab'.repeat(32),
          l1GiverPubkey: order.makerPubkey,
          txid: 'ef'.repeat(32),
          vout: 0,
          paymentAddress: 'bcrt1pexample',
          amountSats: 20000,
          createdAt: 8
        }, maker)
      ];
      for (const body of bodies) {
        const v = Swap.verifyBody(JSON.parse(JSON.stringify(body)));
        assert.strictEqual(v.ok, true, `${body.type}: ${v.reason}`);
      }
      assert.strictEqual(bodies[2].prepayInvoice, 'lnbcrt1prepay');
    });
  });

  describe('takes', function () {
    function setup (side, takeOverrides = {}) {
      const maker = randomPriv();
      const taker = randomPriv();
      const order = Swap.signBody(Swap.toBody(Swap.BODY_TYPES.ORDER, orderFields(maker, { side, prepaySats: 500 })), maker);
      const take = Swap.toBody(Swap.BODY_TYPES.TAKE, Object.assign({
        orderId: Swap.bodyId(order),
        side,
        premiumPpm: order.premiumPpm,
        amountSats: 50000,
        takerPubkey: Swap.pubkeyFromPrivate(taker),
        takerHtlcPubkey: Swap.pubkeyFromPrivate(randomPriv()),
        takerNodeId: Swap.pubkeyFromPrivate(randomPriv()),
        createdAt: 10,
        nonce: Swap.randomNonce()
      }, takeOverrides));
      return { order, take };
    }

    it('accepts a matching take on an ask (maker gives L1)', function () {
      const { order, take } = setup('ask');
      assert.deepStrictEqual(Swap.validateTake(order, take, { now: 5000 }), { ok: true, reason: null });
    });

    it('requires payment terms on a bid take (taker gives L1)', function () {
      const { order, take } = setup('bid');
      assert.match(Swap.validateTake(order, take, { now: 5000 }).reason, /taker gives L1/);
      const withTerms = setup('bid', { paymentHashHex: 'aa'.repeat(32), invoice: 'lnbcrt1x', refundLockHeight: 400 });
      assert.strictEqual(Swap.validateTake(withTerms.order, withTerms.take, { now: 5000 }).ok, true);
    });

    it('rejects wrong premium, amount, side, expiry', function () {
      const { order, take } = setup('ask');
      assert.match(Swap.validateTake(order, Object.assign({}, take, { premiumPpm: 1 }), { now: 5000 }).reason, /premium/);
      assert.match(Swap.validateTake(order, Object.assign({}, take, { amountSats: 5 }), { now: 5000 }).reason, /amount/);
      assert.match(Swap.validateTake(order, Object.assign({}, take, { side: 'bid' }), { now: 5000 }).reason, /side/);
      assert.match(Swap.validateTake(order, take, { now: order.expiresAt }).reason, /expired/);
    });

    it('validateTakeAccept requires maker terms and a prepay invoice on asks', function () {
      const { order, take } = setup('ask');
      const base = {
        orderId: Swap.bodyId(order),
        takeId: Swap.bodyId(take),
        makerPubkey: order.makerPubkey,
        makerHtlcPubkey: Swap.pubkeyFromPrivate(randomPriv()),
        createdAt: 11
      };
      const noTerms = Swap.toBody(Swap.BODY_TYPES.TAKE_ACCEPT, base);
      assert.match(Swap.validateTakeAccept(order, take, noTerms).reason, /maker gives L1/);
      const terms = { paymentHashHex: 'bb'.repeat(32), invoice: 'lnbcrt1y', refundLockHeight: 500 };
      const noPrepay = Swap.toBody(Swap.BODY_TYPES.TAKE_ACCEPT, Object.assign({}, base, terms));
      assert.match(Swap.validateTakeAccept(order, take, noPrepay).reason, /prepay/);
      const full = Swap.toBody(Swap.BODY_TYPES.TAKE_ACCEPT, Object.assign({}, base, terms, { prepayInvoice: 'lnbcrt1p' }));
      assert.strictEqual(Swap.validateTakeAccept(order, take, full).ok, true);
      assert.deepStrictEqual(Swap.l1GiverTerms(order, take, full), Object.assign({}, terms, { prepayInvoice: 'lnbcrt1p' }));
    });
  });

  describe('escrow', function () {
    it('matches the inventory HTLC tree with claim = L2 giver, refund = L1 giver', function () {
      const l1 = randomPriv();
      const l2 = randomPriv();
      const preimage = crypto.randomBytes(32);
      const paymentHashHex = Htlc.sha256(preimage).toString('hex');
      const escrow = Swap.buildEscrow({
        networkName: 'regtest',
        l2GiverPubkeyHex: Swap.pubkeyFromPrivate(l2),
        l1GiverPubkeyHex: Swap.pubkeyFromPrivate(l1),
        paymentHashHex,
        refundLockHeight: 500,
        amountSats: 50000
      });
      const built = new Htlc({
        network: 'regtest',
        claimPubkey: Buffer.from(Swap.pubkeyFromPrivate(l2), 'hex'),
        refundPubkey: Buffer.from(Swap.pubkeyFromPrivate(l1), 'hex'),
        paymentHash: Buffer.from(paymentHashHex, 'hex'),
        refundLocktime: 500
      });
      assert.strictEqual(escrow.paymentAddress, built.address);
      assert.ok(escrow.bitcoinUri.includes('amount=0.00050000'));
    });

    it('validateEscrow refuses a mismatched address', function () {
      const opts = {
        networkName: 'regtest',
        l2GiverPubkeyHex: Swap.pubkeyFromPrivate(randomPriv()),
        l1GiverPubkeyHex: Swap.pubkeyFromPrivate(randomPriv()),
        paymentHashHex: '11'.repeat(32),
        refundLockHeight: 500
      };
      const good = Swap.validateEscrow(opts);
      assert.strictEqual(good.ok, true);
      assert.strictEqual(Swap.validateEscrow(Object.assign({}, opts, { paymentAddress: good.escrow.paymentAddress })).ok, true);
      const swapped = Swap.validateEscrow(Object.assign({}, opts, {
        l2GiverPubkeyHex: opts.l1GiverPubkeyHex,
        l1GiverPubkeyHex: opts.l2GiverPubkeyHex,
        paymentAddress: good.escrow.paymentAddress
      }));
      assert.strictEqual(swapped.ok, false);
    });
  });

  describe('validateInvoice', function () {
    const now = 1700000000;
    const base = () => ({
      decoded: { payment_hash: 'aa'.repeat(32), amount_msat: 101000000, created_at: now, expiry: 600, payee: '02'.padEnd(66, '1') },
      paymentHashHex: 'aa'.repeat(32),
      expectedMsat: 101000000,
      payee: '02'.padEnd(66, '1'),
      refundLockHeight: 244,
      tipHeight: 100,
      nowSeconds: now
    });

    it('accepts an invoice that expires well before the refund lock', function () {
      assert.strictEqual(Swap.validateInvoice(base()).ok, true);
    });

    it('accepts legacy "msat" amount strings', function () {
      const o = base();
      o.decoded.amount_msat = '101000000msat';
      assert.strictEqual(Swap.validateInvoice(o).ok, true);
    });

    it('rejects a wrong hash, amount, or payee', function () {
      const a = base(); a.decoded.payment_hash = 'bb'.repeat(32);
      assert.match(Swap.validateInvoice(a).reason, /hash/);
      const b = base(); b.decoded.amount_msat = 101000001;
      assert.match(Swap.validateInvoice(b).reason, /amount/);
      const c = base(); c.decoded.payee = '03'.padEnd(66, '2');
      assert.match(Swap.validateInvoice(c).reason, /payee/);
    });

    it('rejects an invoice that outlives the refund lock or a lock too close to claim', function () {
      const late = base(); late.decoded.expiry = 144 * 600;
      assert.match(Swap.validateInvoice(late).reason, /outlives/);
      const close = base(); close.tipHeight = 240;
      assert.match(Swap.validateInvoice(close).reason, /too close/);
      const expired = base(); expired.nowSeconds = now + 601;
      assert.match(Swap.validateInvoice(expired).reason, /expired/);
    });
  });
});
