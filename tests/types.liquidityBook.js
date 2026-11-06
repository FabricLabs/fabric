'use strict';

const assert = require('assert');
const crypto = require('crypto');
const ecc = require('../types/ecc');
const Swap = require('../types/swap');
const LiquidityBook = require('../types/liquidityBook');

function randomPriv () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

function makeOrder (priv, overrides = {}) {
  return Swap.signBody(Swap.toBody(Swap.BODY_TYPES.ORDER, Object.assign({
    side: 'ask',
    premiumPpm: 1000,
    feeSats: 0,
    minSats: 10000,
    maxSats: 100000,
    refundLockBlocks: 144,
    createdAt: 1000,
    expiresAt: 100000,
    makerPubkey: Swap.pubkeyFromPrivate(priv),
    lightningNodeId: Swap.pubkeyFromPrivate(randomPriv()),
    network: 'regtest',
    nonce: Swap.randomNonce()
  }, overrides)), priv);
}

describe('types/liquidityBook', function () {
  let clock;
  let book;

  beforeEach(function () {
    clock = 5000;
    book = new LiquidityBook({ now: () => clock });
  });

  it('orders bids by highest premium and asks by lowest, ties by arrival', function () {
    const a = randomPriv();
    const b = randomPriv();
    const ask1 = makeOrder(a, { premiumPpm: 3000 });
    const ask2 = makeOrder(b, { premiumPpm: 1000 });
    const ask3 = makeOrder(a, { premiumPpm: 1000 });
    const bid1 = makeOrder(b, { side: 'bid', premiumPpm: -2000 });
    const bid2 = makeOrder(a, { side: 'bid', premiumPpm: 500 });
    for (const o of [ask1, ask2, ask3, bid1, bid2]) assert.strictEqual(book.ingest(o).ok, true);
    assert.deepStrictEqual(book.list({ side: 'ask' }).map((o) => o.id), [ask2, ask3, ask1].map(Swap.bodyId));
    assert.strictEqual(book.bestBid().premiumPpm, 500);
    assert.strictEqual(book.bestAsk().id, Swap.bodyId(ask2));
    assert.deepStrictEqual(book.depth('ask'), [
      { premiumPpm: 1000, sats: 200000, orders: 2 },
      { premiumPpm: 3000, sats: 100000, orders: 1 }
    ]);
  });

  it('index reports mid, spread, depth, and crossing', function () {
    const m = randomPriv();
    assert.strictEqual(book.index().midPpm, null);
    book.ingest(makeOrder(m, { side: 'bid', premiumPpm: 1000, maxSats: 50000 }));
    book.ingest(makeOrder(m, { side: 'ask', premiumPpm: 3000 }));
    const idx = book.index();
    assert.strictEqual(idx.instrument, 'L1/L2');
    assert.strictEqual(idx.midPpm, 2000);
    assert.strictEqual(idx.spreadPpm, 2000);
    assert.strictEqual(idx.bidSats, 50000);
    assert.strictEqual(idx.askSats, 100000);
    assert.strictEqual(idx.crossed, false);
    book.ingest(makeOrder(m, { side: 'bid', premiumPpm: 3500 }));
    assert.strictEqual(book.index().crossed, true);
  });

  it('rejects bad signatures, wrong network, expired, and duplicate orders', function () {
    const m = randomPriv();
    const order = makeOrder(m);
    const tampered = Object.assign({}, order, { premiumPpm: 0 });
    assert.strictEqual(book.ingest(tampered).reason, 'bad signature');
    assert.strictEqual(book.ingest(makeOrder(m, { network: 'signet' })).reason, 'wrong network');
    assert.strictEqual(book.ingest(makeOrder(m, { expiresAt: 4000 })).reason, 'order expired');
    assert.strictEqual(book.ingest(order).ok, true);
    assert.strictEqual(book.ingest(order).duplicate, true);
    assert.strictEqual(book.ingest({ type: 'FraudProof' }).ok, false);
  });

  it('expires orders as the clock passes', function () {
    const m = randomPriv();
    book.ingest(makeOrder(m, { expiresAt: 6000 }));
    assert.strictEqual(book.list().length, 1);
    clock = 6000;
    assert.strictEqual(book.list().length, 0);
    assert.strictEqual(book.prune(), 1);
    assert.strictEqual(book.size, 0);
  });

  it('cancel needs the maker and keeps the order dead', function () {
    const m = randomPriv();
    const other = randomPriv();
    const order = makeOrder(m);
    const id = Swap.bodyId(order);
    book.ingest(order);
    const forged = Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId: id, makerPubkey: Swap.pubkeyFromPrivate(other), createdAt: 1 }, other);
    assert.strictEqual(book.cancel(forged).reason, 'cancel is not from the maker');
    const cancel = Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId: id, makerPubkey: order.makerPubkey, createdAt: 1 }, m);
    assert.strictEqual(book.cancel(cancel).ok, true);
    assert.strictEqual(book.get(id), null);
    assert.strictEqual(book.ingest(order).reason, 'order cancelled');
  });

  it('a cancel from another key never blocks an order that has not arrived', function () {
    const m = randomPriv();
    const other = randomPriv();
    const order = makeOrder(m);
    const id = Swap.bodyId(order);
    const forged = Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId: id, makerPubkey: Swap.pubkeyFromPrivate(other), createdAt: 1 }, other);
    assert.strictEqual(book.cancel(forged).ok, true);
    assert.strictEqual(book.ingest(order).ok, true);
    const early = new LiquidityBook({ now: () => clock });
    const own = Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId: id, makerPubkey: order.makerPubkey, createdAt: 1 }, m);
    assert.strictEqual(early.cancel(own).ok, true);
    assert.strictEqual(early.ingest(order).reason, 'order cancelled', 'the maker can cancel before its order arrives');
  });

  it('a cancel flood cannot evict the cancel of a held order', function () {
    const small = new LiquidityBook({ now: () => clock, maxCancelled: 4, maxPendingCancelsPerMaker: 2 });
    const m = randomPriv();
    const order = makeOrder(m);
    small.ingest(order);
    small.cancel(Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId: Swap.bodyId(order), makerPubkey: order.makerPubkey, createdAt: 1 }, m));
    const flooder = randomPriv();
    for (let i = 0; i < 10; i++) {
      const signer = i % 2 ? flooder : randomPriv();
      small.cancel(Swap.signBody({
        type: Swap.BODY_TYPES.CANCEL,
        orderId: crypto.randomBytes(32).toString('hex'),
        makerPubkey: Swap.pubkeyFromPrivate(signer),
        createdAt: 1
      }, signer));
    }
    assert.ok(small._cancelled.size <= 4);
    assert.ok((small._pendingCancels.get(Swap.pubkeyFromPrivate(flooder)) || new Set()).size <= 2);
    assert.strictEqual(small.ingest(order).reason, 'order cancelled');
  });

  it('fill walks price-time priority within order limits', function () {
    const a = randomPriv();
    const b = randomPriv();
    const cheap = makeOrder(a, { premiumPpm: 1000, maxSats: 30000, minSats: 10000 });
    const picky = makeOrder(b, { premiumPpm: 2000, minSats: 60000, maxSats: 100000 });
    const dear = makeOrder(b, { premiumPpm: 5000, feeSats: 10 });
    [cheap, picky, dear].forEach((o) => book.ingest(o));
    const r = book.fill('ask', 70000);
    assert.deepStrictEqual(r.fills.map((f) => [f.orderId, f.amountSats]), [
      [Swap.bodyId(cheap), 30000],
      [Swap.bodyId(dear), 40000]
    ]);
    assert.strictEqual(r.filledSats, 70000);
    assert.strictEqual(r.remainingSats, 0);
    assert.strictEqual(r.averagePpm, ((30000 * 1000) + (40000 * 5000)) / 70000);
    assert.strictEqual(r.l2Msat, r.fills[0].quote.l2Msat + r.fills[1].quote.l2Msat);
    assert.strictEqual(r.fills[1].quote.feeMsat, 10000);
  });

  it('fill honors limitPpm and excludeMakers, and reports what is left', function () {
    const a = randomPriv();
    const b = randomPriv();
    book.ingest(makeOrder(a, { side: 'bid', premiumPpm: 4000, maxSats: 20000 }));
    book.ingest(makeOrder(b, { side: 'bid', premiumPpm: 1000 }));
    const limited = book.fill('bid', 50000, { limitPpm: 2000 });
    assert.strictEqual(limited.filledSats, 20000);
    assert.strictEqual(limited.remainingSats, 30000);
    const excluded = book.fill('bid', 50000, { excludeMakers: [Swap.pubkeyFromPrivate(a)] });
    assert.strictEqual(excluded.fills.length, 1);
    assert.strictEqual(excluded.fills[0].order.premiumPpm, 1000);
    assert.throws(() => book.fill('mid', 1), /side/);
  });

  it('fill skips a bid whose fee leaves nothing to pay on L2', function () {
    const a = randomPriv();
    const b = randomPriv();
    const greedy = makeOrder(a, { side: 'bid', premiumPpm: 4000, feeSats: 50000 });
    const fair = makeOrder(b, { side: 'bid', premiumPpm: 1000 });
    book.ingest(greedy);
    book.ingest(fair);
    const r = book.fill('bid', 20000);
    assert.deepStrictEqual(r.fills.map((f) => f.orderId), [Swap.bodyId(fair)]);
    assert.strictEqual(r.filledSats, 20000);
  });

  it('when full, evicts the oldest order of the maker holding the most, and forgets makers', function () {
    const small = new LiquidityBook({ now: () => clock, maxOrders: 2 });
    const a = randomPriv();
    const b = randomPriv();
    const c = randomPriv();
    const first = makeOrder(a);
    small.ingest(first);
    const bFirst = makeOrder(b);
    small.ingest(bFirst);
    // one order each: the oldest goes
    small.ingest(makeOrder(c));
    assert.strictEqual(small.size, 2);
    assert.strictEqual(small.get(Swap.bodyId(first)), null);
    // c posting again pays with its own order, not b's
    const cSecond = makeOrder(c);
    small.ingest(cSecond);
    assert.strictEqual(small.size, 2);
    assert.ok(small.get(Swap.bodyId(bFirst)));
    assert.ok(small.get(Swap.bodyId(cSecond)));
    assert.strictEqual(small.forgetMaker(Swap.pubkeyFromPrivate(c)), 1);
    assert.strictEqual(small.forgetMaker(Swap.pubkeyFromPrivate(b)), 1);
    assert.strictEqual(small.size, 0);
  });
});
