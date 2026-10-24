'use strict';

const assert = require('assert');
const crypto = require('crypto');
const ecc = require('../types/ecc');
const swap = require('../functions/liquiditySwap');
const LiquidityBook = require('../types/liquidityBook');

function randomPriv () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

function makeOrder (priv, overrides = {}) {
  return swap.signBody(swap.toBody(swap.BODY_TYPES.ORDER, Object.assign({
    side: 'ask',
    premiumPpm: 1000,
    feeSats: 0,
    minSats: 10000,
    maxSats: 100000,
    refundLockBlocks: 144,
    createdAt: 1000,
    expiresAt: 100000,
    makerPubkey: swap.pubkeyFromPrivate(priv),
    lightningNodeId: swap.pubkeyFromPrivate(randomPriv()),
    network: 'regtest',
    nonce: swap.randomNonce()
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
    for (const o of [ask1, ask2, ask3, bid1, bid2]) assert.strictEqual(book.ingestOrder(o).ok, true);
    assert.deepStrictEqual(book.listOrders({ side: 'ask' }).map((o) => o.id), [ask2, ask3, ask1].map(swap.bodyId));
    assert.strictEqual(book.bestBid().premiumPpm, 500);
    assert.strictEqual(book.bestAsk().id, swap.bodyId(ask2));
    assert.deepStrictEqual(book.depth('ask'), [
      { premiumPpm: 1000, sats: 200000, orders: 2 },
      { premiumPpm: 3000, sats: 100000, orders: 1 }
    ]);
  });

  it('index reports mid, spread, depth, and crossing', function () {
    const m = randomPriv();
    assert.strictEqual(book.index().midPpm, null);
    book.ingestOrder(makeOrder(m, { side: 'bid', premiumPpm: 1000, maxSats: 50000 }));
    book.ingestOrder(makeOrder(m, { side: 'ask', premiumPpm: 3000 }));
    const idx = book.index();
    assert.strictEqual(idx.instrument, 'L1/L2');
    assert.strictEqual(idx.midPpm, 2000);
    assert.strictEqual(idx.spreadPpm, 2000);
    assert.strictEqual(idx.bidSats, 50000);
    assert.strictEqual(idx.askSats, 100000);
    assert.strictEqual(idx.crossed, false);
    book.ingestOrder(makeOrder(m, { side: 'bid', premiumPpm: 3500 }));
    assert.strictEqual(book.index().crossed, true);
  });

  it('rejects bad signatures, wrong network, expired, and duplicate orders', function () {
    const m = randomPriv();
    const order = makeOrder(m);
    const tampered = Object.assign({}, order, { premiumPpm: 0 });
    assert.strictEqual(book.ingestOrder(tampered).reason, 'bad signature');
    assert.strictEqual(book.ingestOrder(makeOrder(m, { network: 'signet' })).reason, 'wrong network');
    assert.strictEqual(book.ingestOrder(makeOrder(m, { expiresAt: 4000 })).reason, 'order expired');
    assert.strictEqual(book.ingestOrder(order).ok, true);
    assert.strictEqual(book.ingestOrder(order).duplicate, true);
    assert.strictEqual(book.ingestOrder({ type: 'FraudProof' }).ok, false);
  });

  it('expires orders as the clock passes', function () {
    const m = randomPriv();
    book.ingestOrder(makeOrder(m, { expiresAt: 6000 }));
    assert.strictEqual(book.listOrders().length, 1);
    clock = 6000;
    assert.strictEqual(book.listOrders().length, 0);
    assert.strictEqual(book.prune(), 1);
    assert.strictEqual(book.size, 0);
  });

  it('cancel needs the maker and keeps the order dead', function () {
    const m = randomPriv();
    const other = randomPriv();
    const order = makeOrder(m);
    const id = swap.bodyId(order);
    book.ingestOrder(order);
    const forged = swap.signBody({ type: swap.BODY_TYPES.CANCEL, orderId: id, makerPubkey: swap.pubkeyFromPrivate(other), createdAt: 1 }, other);
    assert.strictEqual(book.cancel(forged).reason, 'cancel is not from the maker');
    const cancel = swap.signBody({ type: swap.BODY_TYPES.CANCEL, orderId: id, makerPubkey: order.makerPubkey, createdAt: 1 }, m);
    assert.strictEqual(book.cancel(cancel).ok, true);
    assert.strictEqual(book.get(id), null);
    assert.strictEqual(book.ingestOrder(order).reason, 'order cancelled');
  });

  it('fill walks price-time priority within order limits', function () {
    const a = randomPriv();
    const b = randomPriv();
    const cheap = makeOrder(a, { premiumPpm: 1000, maxSats: 30000, minSats: 10000 });
    const picky = makeOrder(b, { premiumPpm: 2000, minSats: 60000, maxSats: 100000 });
    const dear = makeOrder(b, { premiumPpm: 5000, feeSats: 10 });
    [cheap, picky, dear].forEach((o) => book.ingestOrder(o));
    const r = book.fill('ask', 70000);
    assert.deepStrictEqual(r.fills.map((f) => [f.orderId, f.amountSats]), [
      [swap.bodyId(cheap), 30000],
      [swap.bodyId(dear), 40000]
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
    book.ingestOrder(makeOrder(a, { side: 'bid', premiumPpm: 4000, maxSats: 20000 }));
    book.ingestOrder(makeOrder(b, { side: 'bid', premiumPpm: 1000 }));
    const limited = book.fill('bid', 50000, { limitPpm: 2000 });
    assert.strictEqual(limited.filledSats, 20000);
    assert.strictEqual(limited.remainingSats, 30000);
    const excluded = book.fill('bid', 50000, { excludeMakers: [swap.pubkeyFromPrivate(a)] });
    assert.strictEqual(excluded.fills.length, 1);
    assert.strictEqual(excluded.fills[0].order.premiumPpm, 1000);
    assert.throws(() => book.fill('mid', 1), /side/);
  });

  it('evicts the oldest order when full and forgets makers', function () {
    const small = new LiquidityBook({ now: () => clock, maxOrders: 2 });
    const a = randomPriv();
    const b = randomPriv();
    const first = makeOrder(a);
    small.ingestOrder(first);
    small.ingestOrder(makeOrder(b));
    small.ingestOrder(makeOrder(b));
    assert.strictEqual(small.size, 2);
    assert.strictEqual(small.get(swap.bodyId(first)), null);
    assert.strictEqual(small.forgetMaker(swap.pubkeyFromPrivate(b)), 2);
    assert.strictEqual(small.size, 0);
  });
});
