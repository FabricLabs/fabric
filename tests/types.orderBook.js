'use strict';

const assert = require('assert');
const Actor = require('../types/actor');
const Book = require('../types/book');
const SignedBook = require('../types/signedBook');
const OrderBook = require('../types/orderBook');

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
