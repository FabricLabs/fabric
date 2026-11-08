'use strict';

const assert = require('assert');
const Book = require('../types/book');
const Actor = require('../types/actor');
const SignedBook = require('../types/signedBook');
const OrderBook = require('../types/orderBook');
const crypto = require('crypto');
const ecc = require('../types/ecc');
const Swap = require('../types/swap');
const LiquidityBook = require('../types/liquidityBook');
const path = require('path');
const { spawnSync } = require('child_process');
const bitcoin = require('bitcoinjs-lib');
const Coinjoin = require('../types/coinjoin');
const CoinjoinBook = require('../types/coinjoinBook');
const DocumentBook = require('../types/documentBook');
const Channel = require('../types/channel');
const ChannelBook = require('../types/channelBook');
const Market = require('../services/market');
const { signerFromPriv32 } = require('../types/htlc');

describe('types/book', function () {
  it('evicts the oldest row past capacity', function () {
    const book = new Book({ maxEntries: 2 });
    book._insert('a', { n: 1 });
    book._insert('b', { n: 2 });
    book._insert('c', { n: 3 });
    assert.strictEqual(book.size, 2);
    assert.strictEqual(book.has('a'), false);
    assert.deepStrictEqual(book._list().map((r) => r.n), [2, 3]);
  });

  it('a refreshed row moves to the newest position', function () {
    const book = new Book({ maxEntries: 2 });
    book._put('a', { n: 1 });
    book._put('b', { n: 2 });
    book._put('a', { n: 10 });
    book._put('c', { n: 3 });
    assert.deepStrictEqual([...book._entries.keys()], ['a', 'c']);
    assert.strictEqual(book._row('a').n, 10);
  });

  it('honors a subclass capacity', function () {
    class Small extends Book {
      get capacity () {
        return this.settings.maxThings;
      }
    }
    const book = new Small({ maxThings: 1 });
    book._insert('a', {});
    book._insert('b', {});
    assert.deepStrictEqual([...book._entries.keys()], ['b']);
  });

  it('never loops on a zero capacity', function () {
    const book = new Book({ maxEntries: 0 });
    book._insert('a', {});
    book._insert('b', {});
    assert.deepStrictEqual([...book._entries.keys()], ['b']);
  });

  it('forgets rows by predicate and lists with a filter', function () {
    const book = new Book();
    book._insert('a', { owner: 'x' });
    book._insert('b', { owner: 'y' });
    book._insert('c', { owner: 'x' });
    assert.deepStrictEqual(book._list((r) => r.owner === 'x').length, 2);
    assert.strictEqual(book._forget((r) => r.owner === 'x'), 2);
    assert.deepStrictEqual([...book._entries.keys()], ['b']);
    assert.strictEqual(book._delete('b'), true);
    assert.strictEqual(book._delete('b'), false);
    assert.strictEqual(book.size, 0);
  });

  it('uses the injected clock', function () {
    const book = new Book({ now: () => 42 });
    assert.strictEqual(book.now(), 42);
  });
});

// Stands in for a signing codec: the body's `sig` must be `ok`, its id is `nonce`.
const codec = {
  verifyBody (body) {
    if (body.sig !== 'ok') return { ok: false, id: null, body: null, reason: 'bad signature' };
    const out = Object.assign({}, body);
    delete out.sig;
    return { ok: true, id: body.nonce, body: out, reason: null };
  }
};

class QuoteBook extends OrderBook {
  constructor (settings = {}) {
    super(Object.assign({ maxQuotesPerMaker: 2 }, settings), {
      codec,
      entryType: 'Quote',
      cancelType: 'QuoteCancel',
      field: 'quote',
      idField: 'quoteId',
      noun: 'quote',
      perMakerSetting: 'maxQuotesPerMaker'
    });
  }

  _matches (quote, filter) {
    return filter.minPrice == null || quote.price >= filter.minPrice;
  }

  _compare (a, b) {
    return (a.quote.price - b.quote.price) || (a.seq - b.seq);
  }
}

function quote (nonce, overrides = {}) {
  return Object.assign({ type: 'Quote', nonce, makerPubkey: 'aa', network: 'regtest', expiresAt: 1000, price: 5, sig: 'ok' }, overrides);
}

describe('types/orderBook', function () {
  let clock;
  let book;

  beforeEach(function () {
    clock = 10;
    book = new QuoteBook({ now: () => clock });
  });

  it('is a SignedBook, a Book, and an Actor holding only its type name', function () {
    assert.ok(book instanceof SignedBook);
    assert.ok(book instanceof Book);
    assert.ok(book instanceof Actor);
    assert.deepStrictEqual(book.state, { type: book.constructor.name });
    assert.match(book.id, /^[0-9a-f]{64}$/);
  });

  it('ingests signed entries and lists them as { id, ...entry }', function () {
    assert.strictEqual(book.ingest(quote('q1')).ok, true);
    assert.strictEqual(book.ingest(quote('q1')).reason, 'duplicate quote');
    assert.deepStrictEqual(book.list(), [{ id: 'q1', type: 'Quote', nonce: 'q1', makerPubkey: 'aa', network: 'regtest', expiresAt: 1000, price: 5 }]);
  });

  it('filters by maker and the subclass predicate, in the subclass order', function () {
    book.ingest(quote('a', { price: 9 }));
    book.ingest(quote('b', { price: 3, makerPubkey: 'bb' }));
    book.ingest(quote('c', { price: 6, makerPubkey: 'cc' }));
    assert.deepStrictEqual(book.list().map((q) => q.id), ['b', 'c', 'a']);
    assert.deepStrictEqual(book.list({ minPrice: 5 }).map((q) => q.id), ['c', 'a']);
    assert.deepStrictEqual(book.list({ makerPubkey: 'BB' }).map((q) => q.id), ['b']);
  });

  it('drops a maker\'s oldest entry at its per-maker limit', function () {
    for (const n of ['a', 'b', 'c']) book.ingest(quote(n));
    book.ingest(quote('d', { makerPubkey: 'bb' }));
    assert.deepStrictEqual(book.list({ makerPubkey: 'aa' }).map((q) => q.id), ['b', 'c']);
    assert.deepStrictEqual([...book.makers()].sort(), ['aa', 'bb']);
  });

  it('lists and counts only live entries', function () {
    book.ingest(quote('a', { expiresAt: 20 }));
    book.ingest(quote('b', { makerPubkey: 'bb' }));
    clock = 30;
    assert.deepStrictEqual(book.list().map((q) => q.id), ['b']);
    assert.deepStrictEqual([...book.makers()], ['bb']);
  });
});

class WidgetBook extends SignedBook {
  constructor (settings = {}) {
    super(Object.assign({ maxWidgets: 100 }, settings), {
      codec,
      entryType: 'Widget',
      cancelType: 'WidgetCancel',
      field: 'widget',
      idField: 'widgetId',
      noun: 'widget',
      capacitySetting: 'maxWidgets'
    });
  }

  ingestWidget (body) {
    return this._ingestSigned(body);
  }
}

function widget (nonce, overrides = {}) {
  return Object.assign({ type: 'Widget', nonce, makerPubkey: 'aa', network: 'regtest', expiresAt: 1000, sig: 'ok' }, overrides);
}

function cancelOf (widgetId, makerPubkey = 'aa') {
  return { type: 'WidgetCancel', nonce: `c-${widgetId}-${makerPubkey}`, widgetId, makerPubkey, sig: 'ok' };
}

describe('types/signedBook', function () {
  let clock;
  let book;

  beforeEach(function () {
    clock = 10;
    book = new WidgetBook({ now: () => clock });
  });

  it('verifies, checks network and expiry, and refuses duplicates with the subclass noun', function () {
    assert.deepStrictEqual(book.ingestWidget({ type: 'Other' }), { ok: false, id: null, reason: 'not a Widget' });
    assert.strictEqual(book.ingestWidget(widget('w1', { sig: 'no' })).reason, 'bad signature');
    assert.strictEqual(book.ingestWidget(widget('w1', { network: 'signet' })).reason, 'wrong network');
    assert.strictEqual(book.ingestWidget(widget('w1', { expiresAt: 5 })).reason, 'widget expired');
    assert.strictEqual(book.ingestWidget(widget('w1')).ok, true);
    const dup = book.ingestWidget(widget('w1'));
    assert.strictEqual(dup.reason, 'duplicate widget');
    assert.strictEqual(dup.duplicate, true);
    assert.strictEqual(book.get('w1').nonce, 'w1');
    assert.strictEqual(book.get('w1').sig, undefined);
  });

  it('a cancel before the entry keeps that maker from adding it later', function () {
    assert.strictEqual(book.cancel(cancelOf('w1')).ok, true);
    assert.strictEqual(book.ingestWidget(widget('w1')).reason, 'widget cancelled');
    assert.strictEqual(book._cancelled.get('w1:aa'), 1000);
    assert.strictEqual(book._pendingCancels.size, 0);
  });

  it('another key cannot cancel a held entry', function () {
    book.ingestWidget(widget('w1'));
    assert.strictEqual(book.cancel(cancelOf('w1', 'bb')).reason, 'cancel is not from the maker');
    assert.strictEqual(book.cancel({ type: 'Nope' }).reason, 'not a WidgetCancel');
    assert.strictEqual(book.cancel(cancelOf('w1')).ok, true);
    assert.strictEqual(book.size, 0);
  });

  it('caps pending cancels per signer and remembered cancels overall', function () {
    const small = new WidgetBook({ now: () => clock, maxCancelled: 4, maxPendingCancelsPerMaker: 2 });
    for (let i = 0; i < 6; i++) small.cancel(cancelOf(`x${i}`, 'ff'));
    assert.ok(small._pendingCancels.get('ff').size <= 2);
    assert.ok(small._cancelled.size <= 4);
  });

  it('uses the subclass capacity setting', function () {
    const small = new WidgetBook({ now: () => clock, maxWidgets: 2 });
    for (const n of ['a', 'b', 'c']) small.ingestWidget(widget(n));
    assert.deepStrictEqual(small._liveRows().map((r) => r.id), ['b', 'c']);
  });

  it('prunes expired entries, forgets a maker, and runs the hooks', function () {
    const calls = [];
    book._afterPrune = () => calls.push('prune');
    book._afterForget = (k) => calls.push(`forget:${k}`);
    book.ingestWidget(widget('a', { expiresAt: 20 }));
    book.ingestWidget(widget('b', { makerPubkey: 'bb' }));
    clock = 30;
    assert.strictEqual(book.prune(), 1);
    assert.strictEqual(book.forgetMaker('BB'), 1);
    assert.strictEqual(book.size, 0);
    assert.deepStrictEqual(calls, ['prune', 'forget:bb']);
  });

  describe('codec', function () {
    const priv = Buffer.alloc(32, 7);
    const notes = SignedBook.codec({
      name: 'notes',
      version: 1,
      normalizers: new Map([['Note', (f) => {
        if (typeof f.text !== 'string') throw new Error('notes: text must be a string');
        const body = { type: 'Note', version: 1, authorPubkey: String(f.authorPubkey), text: f.text };
        if (f.signature) body.signature = f.signature;
        return body;
      }]]),
      signerField: { Note: 'authorPubkey' }
    });
    const author = notes.pubkeyFromPrivate(priv);

    it('signs and verifies a body, with a stable id', function () {
      const signed = notes.signBody({ type: 'Note', authorPubkey: author, text: 'hi' }, priv);
      const v = notes.verifyBody(signed);
      assert.strictEqual(v.ok, true);
      assert.strictEqual(v.id, notes.bodyId(signed));
      assert.strictEqual(v.id, SignedBook.bodyId(Object.assign({}, signed, { signature: 'other' })));
      assert.strictEqual(notes.verifyBody(Object.assign({}, signed, { text: 'bye' })).reason, 'bad signature');
      assert.strictEqual(notes.verifyBody(notes.toBody('Note', { authorPubkey: author, text: 'x' })).reason, 'unsigned body');
    });

    it('rejects unknown types, other versions, and malformed bodies', function () {
      assert.strictEqual(notes.fromBody({ type: 'toString' }), null);
      assert.strictEqual(notes.fromBody({ type: 'Note', version: 2, authorPubkey: author, text: 'x' }), null);
      assert.strictEqual(notes.fromBody({ type: 'Note', authorPubkey: author, text: 1 }), null);
      assert.strictEqual(notes.verifyBody(null).reason, 'malformed body');
      assert.throws(() => notes.toBody('Nope', {}), /^Error: notes: unknown body type Nope$/);
    });

    it('refuses a key that is not the author\'s, prefixing errors with the codec name', function () {
      assert.throws(() => notes.signBody({ type: 'Note', authorPubkey: author, text: 'x' }, Buffer.alloc(32, 8)), /^Error: notes: signing key does not match authorPubkey$/);
      assert.throws(() => notes.pubkeyFromPrivate('zz'), /^Error: notes: private key must be 64 hex characters$/);
      assert.throws(() => notes.pubkeyFromPrivate(Buffer.alloc(32)), /^Error: notes: invalid private key$/);
    });
  });
});

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

const NET = bitcoin.networks.regtest;

function cancelOrder (priv, order) {
  return Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId: Swap.bodyId(order), makerPubkey: order.makerPubkey, createdAt: 1 }, priv);
}

function cjMaker () {
  const key = Coinjoin.randomPrivateKey();
  return { key, pubkey: Coinjoin.pubkeyFromPrivate(key) };
}

function cjOffer (m, fields = {}) {
  return Coinjoin.signBody(Object.assign({
    type: Coinjoin.BODY_TYPES.OFFER,
    network: 'regtest',
    minSats: 100000,
    maxSats: 5000000,
    feeSats: 100,
    feePpm: 100,
    createdAt: 1000,
    expiresAt: 100000,
    makerPubkey: m.pubkey,
    nonce: Coinjoin.randomNonce()
  }, fields), m.key);
}

function party () {
  const priv = crypto.randomBytes(32);
  const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
  const address = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address;
  return { priv, pub, address };
}

function fundingTx (address, sats) {
  const tx = new bitcoin.Transaction();
  tx.addInput(crypto.randomBytes(32), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address, NET), BigInt(sats));
  return tx.toHex();
}

/** Two ChannelBooks wired by in-memory queues; `pump()` delivers until idle. */
function channelBooks (extra = {}) {
  const wires = new Map();
  const out = [];
  for (let i = 0; i < 2; i++) {
    const p = party();
    const book = new ChannelBook(Object.assign({ localPrivateKey: p.priv, network: 'regtest', confirmations: () => 6, tipHeight: () => 10, publish: (body) => wires.get(book).push(body) }, extra));
    wires.set(book, []);
    out.push({ p, book });
  }
  const pump = () => {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [i, { book }] of out.entries()) {
        const q = wires.get(book);
        while (q.length) {
          const body = q.shift();
          moved = true;
          for (const other of out) if (other.book !== book) other.book.ingest(body, { sellerId: `peer-${i}` });
        }
      }
    }
  };
  return { A: out[0], B: out[1], wires, pump };
}

function openChannel (A, B, capacity = 20000) {
  const funding = Channel.buildFunding({ network: 'regtest', localPubkey: A.p.pub, remotePubkey: B.p.pub, expireAfter: 5000 });
  return A.book.open({ remotePubkey: B.p.pub, fundedTxHex: fundingTx(funding.address, capacity), capacitySats: capacity, expireAfter: 5000, feeSats: 500, localAddress: A.p.address, remoteAddress: B.p.address });
}

describe('adversarial: Book family and Market', function () {
  describe('types/book', function () {
    it('an undefined or NaN capacity falls back to the default cap, not unbounded growth', function () {
      for (const maxEntries of [undefined, NaN]) {
        const book = new Book({ maxEntries });
        for (let i = 0; i <= Book.MAX_ENTRIES; i++) book._insert(`k${i}`, {});
        assert.strictEqual(book.size, Book.MAX_ENTRIES, `maxEntries ${maxEntries}`);
      }
    });
  });

  describe('types/signedBook (via LiquidityBook)', function () {
    let clock;
    let book;

    beforeEach(function () {
      clock = 5000;
      book = new LiquidityBook({ now: () => clock });
    });

    it('a body re-signed with fresh aux randomness is the same entry, not a second one', function () {
      const m = randomPriv();
      const order = makeOrder(m);
      const hash = crypto.createHash('sha256').update(Swap.signingString(order)).digest();
      const resigned = Object.assign({}, order, { signature: Buffer.from(ecc.signSchnorr(hash, m, crypto.randomBytes(32))).toString('hex') });
      assert.notStrictEqual(resigned.signature, order.signature);
      assert.strictEqual(book.ingest(order).ok, true);
      const again = book.ingest(resigned);
      assert.strictEqual(again.duplicate, true);
      assert.strictEqual(again.id, Swap.bodyId(order));
      assert.strictEqual(book.size, 1);
    });

    it('cosmetic variants (hex case, 0x, numeric strings) normalize to the held entry', function () {
      const m = randomPriv();
      const order = makeOrder(m);
      book.ingest(order);
      const variant = Object.assign({}, order, {
        makerPubkey: order.makerPubkey.toUpperCase(),
        nonce: order.nonce.toUpperCase(),
        signature: '0x' + order.signature.toUpperCase(),
        premiumPpm: String(order.premiumPpm),
        maxSats: ` ${order.maxSats} `,
        network: 'REGTEST'
      });
      assert.strictEqual(book.ingest(variant).duplicate, true);
      assert.strictEqual(book.size, 1);
    });

    it('a body carrying an own __proto__ key cannot pollute prototypes or add fields', function () {
      const m = randomPriv();
      const order = makeOrder(m);
      const json = JSON.stringify(order).replace(/^\{/, '{"__proto__":{"polluted":true,"premiumPpm":-500000},');
      const hostile = JSON.parse(json);
      const result = book.ingest(hostile);
      assert.strictEqual(({}).polluted, undefined);
      if (result.ok || result.duplicate) {
        const held = book.get(result.id);
        assert.strictEqual(held.premiumPpm, order.premiumPpm);
        assert.ok(!Object.prototype.hasOwnProperty.call(held, '__proto__'));
        assert.strictEqual(held.polluted, undefined);
      }
    });

    it('refuses bodies for another protocol version', function () {
      const m = randomPriv();
      const order = makeOrder(m);
      assert.strictEqual(book.ingest(Object.assign({}, order, { version: Swap.BODY_VERSION + 1 })).reason, 'malformed body');
      assert.strictEqual(book.ingest(Object.assign({}, order, { version: String(Swap.BODY_VERSION) })).ok, true);
    });

    it('an entry expiring exactly now is refused, and one expiring later drops out of every view at its expiry', function () {
      const m = randomPriv();
      assert.strictEqual(book.ingest(makeOrder(m, { expiresAt: clock })).reason, 'order expired');
      const order = makeOrder(m, { expiresAt: clock + 10 });
      assert.strictEqual(book.ingest(order).ok, true);
      assert.strictEqual(book.bestAsk().id, Swap.bodyId(order));
      clock += 10;
      assert.strictEqual(book.bestAsk(), null);
      assert.deepStrictEqual(book.depth('ask'), []);
      assert.strictEqual(book.index().askSats, 0);
      assert.strictEqual(book.fill('ask', 20000).filledSats, 0);
      assert.strictEqual(book.makers().size, 0);
    });

    it('a refused cancel from another key leaves the entry and the cancel table untouched', function () {
      const m = randomPriv();
      const order = makeOrder(m);
      book.ingest(order);
      const thief = randomPriv();
      const forged = Swap.signBody({ type: Swap.BODY_TYPES.CANCEL, orderId: Swap.bodyId(order), makerPubkey: Swap.pubkeyFromPrivate(thief), createdAt: 1 }, thief);
      assert.strictEqual(book.cancel(forged).reason, 'cancel is not from the maker');
      assert.strictEqual(book._cancelled.size, 0);
      assert.ok(book.get(Swap.bodyId(order)));
    });

    it('one key flooding self-cancelled orders cannot evict another maker\'s confirmed cancel', function () {
      const small = new LiquidityBook({ now: () => clock, maxCancelled: 4 });
      const m = randomPriv();
      const order = makeOrder(m);
      small.ingest(order);
      assert.strictEqual(small.cancel(cancelOrder(m, order)).ok, true);
      const attacker = randomPriv();
      for (let i = 0; i < 8; i++) {
        const own = makeOrder(attacker, { expiresAt: 10_000_000 });
        assert.strictEqual(small.ingest(own).ok, true);
        assert.strictEqual(small.cancel(cancelOrder(attacker, own)).ok, true);
      }
      assert.strictEqual(small.ingest(order).reason, 'order cancelled', 'the honest cancelled order must stay dead');
    });

    it('a maker tying another on cancels evicts its own when it adds one more', function () {
      const small = new LiquidityBook({ now: () => clock, maxCancelled: 2 });
      const a = randomPriv();
      const b = randomPriv();
      const first = makeOrder(a);
      const honest = makeOrder(b);
      const second = makeOrder(a);
      for (const [priv, order] of [[a, first], [b, honest], [a, second]]) {
        assert.strictEqual(small.ingest(order).ok, true);
        assert.strictEqual(small.cancel(cancelOrder(priv, order)).ok, true);
      }
      assert.strictEqual(small.ingest(honest).reason, 'order cancelled', 'B\'s cancel was evicted for A\'s');
      assert.strictEqual(small.ingest(second).reason, 'order cancelled');
    });
  });

  describe('types/liquidityBook', function () {
    let clock;
    let book;

    beforeEach(function () {
      clock = 5000;
      book = new LiquidityBook({ now: () => clock });
    });

    it('one maker filling the book cannot evict every other maker', function () {
      const small = new LiquidityBook({ now: () => clock, maxOrders: 5 });
      const honest = randomPriv();
      const kept = makeOrder(honest);
      small.ingest(kept);
      const spammer = randomPriv();
      for (let i = 0; i < 5; i++) small.ingest(makeOrder(spammer, { premiumPpm: 900 }));
      assert.ok(small.get(Swap.bodyId(kept)), 'a single key took the whole book');
    });

    it('fill refuses a non-numeric limitPpm instead of silently taking any price', function () {
      const m = randomPriv();
      book.ingest(makeOrder(m, { premiumPpm: 400000 }));
      for (const limitPpm of ['abc', NaN, {}]) {
        assert.throws(() => book.fill('ask', 20000, { limitPpm }), /limitPpm/, `limitPpm ${String(limitPpm)}`);
      }
    });

    it('fill honors limitPpm at the exact boundary on both sides', function () {
      const m = randomPriv();
      book.ingest(makeOrder(m, { side: 'ask', premiumPpm: 1500 }));
      book.ingest(makeOrder(m, { side: 'bid', premiumPpm: -1500 }));
      assert.strictEqual(book.fill('ask', 20000, { limitPpm: 1500 }).filledSats, 20000);
      assert.strictEqual(book.fill('ask', 20000, { limitPpm: 1499 }).filledSats, 0);
      assert.strictEqual(book.fill('bid', 20000, { limitPpm: -1500 }).filledSats, 20000);
      assert.strictEqual(book.fill('bid', 20000, { limitPpm: -1499 }).filledSats, 0);
    });

    it('fill matches excludeMakers case-insensitively and never takes an excluded maker', function () {
      const a = randomPriv();
      const b = randomPriv();
      const cheap = makeOrder(a, { premiumPpm: 10 });
      book.ingest(cheap);
      book.ingest(makeOrder(b, { premiumPpm: 20 }));
      const out = book.fill('ask', 20000, { excludeMakers: [cheap.makerPubkey.toUpperCase()] });
      assert.ok(out.fills.length > 0);
      assert.ok(out.fills.every((f) => f.order.makerPubkey !== cheap.makerPubkey));
    });

    it('fill rejects non-integer, zero, negative, and unsafe amounts', function () {
      for (const amount of [0, -1, NaN, 'abc', Infinity, Number.MAX_SAFE_INTEGER + 2]) {
        assert.throws(() => book.fill('ask', amount), /amountSats/, `amount ${String(amount)}`);
      }
      assert.throws(() => book.fill('both', 1000), /side/);
    });

    it('the summed L2 amount of a fill stays a safe integer', function () {
      const m = randomPriv();
      book.ingest(makeOrder(m, { premiumPpm: 0, minSats: 10000, maxSats: 5_000_000_000_000 }));
      book.ingest(makeOrder(m, { premiumPpm: 0, minSats: 10000, maxSats: 5_000_000_000_000 }));
      const out = book.fill('ask', 10_000_000_000_000);
      assert.ok(Number.isSafeInteger(out.l2Msat), `l2Msat ${out.l2Msat} is not a safe integer`);
    });

    it('aggregates equal premiums across makers and flags a self-crossed book', function () {
      const a = randomPriv();
      const b = randomPriv();
      book.ingest(makeOrder(a, { side: 'ask', premiumPpm: 100, maxSats: 30000 }));
      book.ingest(makeOrder(b, { side: 'ask', premiumPpm: 100, maxSats: 40000 }));
      book.ingest(makeOrder(a, { side: 'bid', premiumPpm: 100, maxSats: 50000 }));
      assert.deepStrictEqual(book.depth('ask'), [{ premiumPpm: 100, sats: 70000, orders: 2 }]);
      const index = book.index();
      assert.strictEqual(index.crossed, true);
      assert.strictEqual(index.spreadPpm, 0);
    });
  });

  describe('types/coinjoinBook', function () {
    let clock;
    let book;

    beforeEach(function () {
      clock = 5000;
      book = new CoinjoinBook({ now: () => clock });
    });

    function bond (txid, vout = 0) {
      return {
        txid,
        vout,
        locktime: 60000,
        bondXOnly: Coinjoin.pubkeyFromPrivate(Coinjoin.randomPrivateKey()).slice(2),
        certExpiresAt: 11000,
        certSig: crypto.randomBytes(64).toString('hex')
      };
    }

    it('one bond advertised by two makers counts for neither, even with a case-variant txid', async function () {
      const a = cjMaker();
      const b = cjMaker();
      const c = cjMaker();
      const txid = crypto.randomBytes(32).toString('hex');
      book.ingest(cjOffer(a, { fidelityBond: bond(txid, 0) }));
      book.ingest(cjOffer(b, { fidelityBond: bond(txid.toUpperCase(), '0') }));
      book.ingest(cjOffer(c, { fidelityBond: bond(crypto.randomBytes(32).toString('hex')) }));
      const result = await book.refreshBonds({ verify: async () => ({ ok: true, value: 1_000_000 }) });
      assert.strictEqual(result.shared, 2);
      assert.strictEqual(book.bondOf(a.pubkey).ok, false);
      assert.strictEqual(book.bondOf(b.pubkey).ok, false);
      assert.strictEqual(book.bondOf(c.pubkey).ok, true);
    });

    it('a verifier that throws for one maker does not stop the others', async function () {
      const a = cjMaker();
      const b = cjMaker();
      book.ingest(cjOffer(a, { fidelityBond: bond(crypto.randomBytes(32).toString('hex')) }));
      book.ingest(cjOffer(b, { fidelityBond: bond(crypto.randomBytes(32).toString('hex')) }));
      const result = await book.refreshBonds({
        verify: async (_bond, maker) => {
          if (maker === a.pubkey) throw new Error('rpc down');
          return { ok: true, value: 5000 };
        }
      });
      assert.strictEqual(result.valid, 1);
      assert.strictEqual(book.bondOf(a.pubkey).reason, 'rpc down');
      assert.strictEqual(book.bondOf(b.pubkey).value, 5000);
    });

    it('choose stays distinct and bounded under a broken random source', function () {
      const makers = [cjMaker(), cjMaker(), cjMaker()];
      for (const m of makers) book.ingest(cjOffer(m));
      for (const value of [1, 1.5, -1, NaN, Infinity]) {
        const picked = book.choose(200000, 10, { random: () => value });
        assert.strictEqual(picked.length, 3, `random ${value}`);
        assert.strictEqual(new Set(picked.map((o) => o.makerPubkey)).size, 3, `random ${value}`);
      }
    });

    it('choose never returns an offer whose range misses the amount or whose fee is over the cap', function () {
      const a = cjMaker();
      const b = cjMaker();
      book.ingest(cjOffer(a, { minSats: 100000, maxSats: 200000 }));
      book.ingest(cjOffer(b, { feeSats: 10_000 }));
      assert.deepStrictEqual(book.choose(200001, 5, { maxFeeSats: 5000 }).map((o) => o.makerPubkey), []);
      assert.deepStrictEqual(book.choose(200000, 5, { maxFeeSats: 5000 }).map((o) => o.makerPubkey), [a.pubkey]);
    });
  });

  describe('types/documentBook', function () {
    it('an Infinity price (1e999 on the wire) never outranks a real offer', function () {
      const book = new DocumentBook();
      const hostile = JSON.parse('{"id":"doc","rateSats":1e999,"sealed":true}');
      assert.strictEqual(hostile.rateSats, Infinity);
      book.ingestInventoryResponse({ origin: 'evil', items: [hostile] });
      book.ingestInventoryResponse({ origin: 'honest', items: [{ id: 'doc', rateSats: 0 }] });
      assert.strictEqual(book.pickBest('doc').sellerAddress, 'honest');
    });

    it('a negative price does not erase the price difference between honest offers', function () {
      const book = new DocumentBook();
      book.ingestInventoryResponse({ origin: 'cheap', latencyMs: 200, items: [{ id: 'doc', rateSats: 716, sealed: true }] });
      book.ingestInventoryResponse({ origin: 'dear', latencyMs: 20, items: [{ id: 'doc', rateSats: 2000, sealed: true }] });
      const before = book.rankOffers(book.listOffers({ documentId: 'doc' })).map((o) => o.sellerAddress);
      assert.deepStrictEqual(before, ['cheap', 'dear']);
      book.ingestInventoryResponse({ origin: 'evil', latencyMs: 200, items: [{ id: 'doc', rateSats: -1e15, sealed: true }] });
      const after = book.rankOffers(book.listOffers({ documentId: 'doc' })).map((o) => o.sellerAddress).filter((s) => s !== 'evil');
      assert.deepStrictEqual(after, ['cheap', 'dear']);
      assert.ok(book.listOffers({ documentId: 'doc' }).every((o) => o.rateSats >= 0), 'negative rateSats held');
    });
  });

  describe('services/market', function () {
    it('an advertised blobTotal of 1e9 cannot hang or exhaust planning', function () {
      this.timeout(20000);
      const script = `
        const DocumentBook = require(${JSON.stringify(path.join(__dirname, '../types/documentBook'))});
        const Market = require(${JSON.stringify(path.join(__dirname, '../services/market'))});
        const book = new DocumentBook();
        book.ingestInventoryResponse({ origin: 'evil', items: [{ id: 'doc', rateSats: 0, blobTotal: 1e9 }] });
        const market = new Market({ budgetSats: 0, tickMs: 0, book });
        market.planFor({ documentId: 'doc' });
        process.stdout.write('done');
      `;
      const run = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', script], { timeout: 5000, encoding: 'utf8' });
      assert.strictEqual(run.stdout, 'done', `planning did not finish (${run.signal || run.status}): ${String(run.stderr).split('\n').find((l) => /Error|heap/.test(l)) || ''}`);
    });

    it('an Infinity-priced offer cannot block a plan that a free offer covers', function () {
      const book = new DocumentBook();
      book.ingestInventoryResponse({ origin: 'evil', items: [JSON.parse('{"id":"doc","rateSats":1e999,"sealed":true}')] });
      book.ingestInventoryResponse({ origin: 'honest', items: [{ id: 'doc', rateSats: 0 }] });
      const market = new Market({ budgetSats: 10000, tickMs: 0, book });
      const planned = market.planFor({ documentId: 'doc', blobTotal: 1 });
      assert.ok(planned.ok, planned.error);
      assert.strictEqual(planned.plan.get(0).sellerAddress, 'honest');
      assert.strictEqual(planned.costSats, 0);
    });

    it('document ids named like Object.prototype members are ordinary ids', function () {
      const market = new Market({ budgetSats: 0, tickMs: 0 });
      for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
        assert.strictEqual(market.forget(id), false, `forget(${id}) before want`);
      }
      market.want('__proto__');
      assert.ok(market.listWants().some((w) => w.documentId === '__proto__'), 'want("__proto__") was lost');
      assert.strictEqual(market.forget('__proto__'), true);
    });

    it('refuses non-finite budgets', function () {
      const market = new Market({ budgetSats: 1000, tickMs: 0 });
      for (const value of [Infinity, '1e999']) {
        market.setBudget(value);
        assert.ok(Number.isSafeInteger(market.status().budgetSats), `setBudget(${value}) → ${market.status().budgetSats}`);
      }
      assert.ok(Number.isSafeInteger(new Market({ budgetSats: Infinity, tickMs: 0 }).status().budgetSats));
    });

    it('ignores malformed inventory bodies and hostile item shapes', function () {
      const book = new DocumentBook();
      const market = new Market({ budgetSats: 0, tickMs: 0, book });
      const bodies = [
        'not json',
        '{"items":"x"}',
        JSON.stringify({ items: [null, 5, 'x', [], { id: '' }, { id: '  ' }, { id: 'd', rateSats: 'NaN', blobs: 'nope', proof: {} }] }),
        Buffer.from('{"items":[{"id":"e","blobs":[null,7,{"index":"zz"}]}]}')
      ];
      for (const body of bodies) assert.doesNotThrow(() => market._onInventoryResponse({ message: { body }, origin: 'evil' }));
      market._onInventoryResponse(null);
      market._onInventoryResponse({ message: {} });
      const rows = book.listOffers();
      assert.ok(rows.every((r) => r.documentId && r.documentId.trim()));
      assert.ok(rows.every((r) => Number.isFinite(r.rateSats) && r.rateSats >= 0));
    });
  });

  describe('types/channelBook', function () {
    it('ignores bodies that are not channel traffic for a channel it holds', function () {
      const { B } = channelBooks();
      for (const body of [null, undefined, {}, { type: 5 }, { type: 'Offer' }, { type: 'ChannelHtlcAdd', channelId: 'nope' }, { type: 'ChannelOpen', channelId: 'x' }]) {
        assert.strictEqual(B.book.ingest(body), null);
      }
      const stranger = party();
      assert.strictEqual(B.book.ingest({ type: 'ChannelOpen', channelId: 'x', funding: { remotePubkey: stranger.pub, network: 'regtest' } }), null);
      assert.strictEqual(B.book.ingest({ type: 'ChannelOpen', channelId: 'x', funding: { remotePubkey: B.p.pub.toUpperCase(), network: 'signet' } }), null);
      assert.strictEqual(B.book.size, 0);
    });

    it('a tampered ChannelOpen is refused without parking a session; the genuine one then opens', function () {
      const { A, B, wires } = channelBooks();
      const { body } = openChannel(A, B);
      wires.get(A.book).length = 0;
      const tampered = Object.assign({}, body, { localSats: body.localSats * 10, remoteSats: 5000 });
      try { B.book.ingest(tampered, { sellerId: 'peer-0' }); } catch (_) { /* refusal by throw is fine */ }
      assert.strictEqual(B.book.size, 0);
      assert.strictEqual(B.book.sessionFor('peer-0'), null);
      B.book.ingest(body, { sellerId: 'peer-0' });
      assert.strictEqual(B.book.size, 1);
    });

    it('replaying the ChannelOpen of an open channel changes nothing', function () {
      const { A, B, pump } = channelBooks();
      const { body } = openChannel(A, B);
      pump();
      const sB = B.book.sessionFor('peer-0');
      assert.strictEqual(sB.status, 'open');
      const before = { balances: Object.assign({}, sB.balances), number: sB.number };
      try { B.book.ingest(body, { sellerId: 'peer-0' }); } catch (_) { /* refusal by throw is fine */ }
      assert.strictEqual(B.book.size, 1);
      assert.strictEqual(sB.status, 'open');
      assert.strictEqual(sB.number, before.number);
      assert.deepStrictEqual(sB.balances, before.balances);
    });

    it('extendCredit refuses bad refs, reused refs, bad amounts, and credit past the limit', function () {
      const { A, B, pump } = channelBooks({ creditLimitSats: 5000 });
      openChannel(A, B);
      pump();
      const credit = (ref, amountSats) => B.book.extendCredit({ counterparty: 'peer-0', ref, amountSats });
      for (const ref of ['', null, 'a\nb', 'x\u0000', 'z'.repeat(257)]) assert.strictEqual(credit(ref, 100).ok, false, `ref ${JSON.stringify(ref)}`);
      for (const amount of [0, -5, 1.5, NaN, 'abc', Infinity]) assert.strictEqual(credit('r-amount', amount).ok, false, `amount ${String(amount)}`);
      assert.strictEqual(credit('z'.repeat(256), 100).ok, true);
      assert.strictEqual(credit('r1', 4000).ok, true);
      assert.strictEqual(credit('r1', 1).error, 'credit ref already used');
      assert.match(credit('r2', 901).error, /credit limit/);
      assert.strictEqual(B.book.outstanding('peer-0'), 4100);
      assert.strictEqual(B.book.extendCredit({ counterparty: 'nobody', ref: 'r3', amountSats: 1 }).ok, false);
      assert.strictEqual(B.book.outstanding('nobody'), 0);
    });

    it('a corrupt snapshot imports what it can without throwing', function () {
      const book = new ChannelBook({ localPrivateKey: party().priv, network: 'regtest' });
      assert.doesNotThrow(() => book.import({ sessions: 'abc', peers: null, forwards: 7, announced: 7, pendingPropagation: {}, credits: 'x' }));
      assert.strictEqual(book.size, 0);
    });

    it('an imported overpaid credit does not make outstanding negative or raise the credit headroom', function () {
      const { A, B, pump } = channelBooks({ creditLimitSats: 1000 });
      openChannel(A, B);
      pump();
      const snapshot = JSON.parse(JSON.stringify(B.book.export()));
      const channelId = snapshot.sessions[0].channelId || B.book.list()[0].channelId;
      snapshot.credits = [{ channelId, ref: 'old', amountSats: 100, paidSats: 1_000_000, extendedAt: 1, settledAt: null }];
      const restored = new ChannelBook({ localPrivateKey: B.p.priv, network: 'regtest', tipHeight: () => 10, creditLimitSats: 1000 }).import(snapshot);
      assert.strictEqual(restored.size, 1);
      assert.ok(restored.outstanding(channelId) >= 0, `outstanding ${restored.outstanding(channelId)}`);
      assert.strictEqual(restored.extendCredit({ counterparty: channelId, ref: 'new', amountSats: 1001 }).ok, false);
    });
  });
});
