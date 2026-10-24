'use strict';

const assert = require('assert');
const SignedBook = require('../types/signedBook');

// Stands in for a signing codec: the body's `sig` must be `ok`, its id is `nonce`.
const codec = {
  verifyBody (body) {
    if (body.sig !== 'ok') return { ok: false, id: null, body: null, reason: 'bad signature' };
    const out = Object.assign({}, body);
    delete out.sig;
    return { ok: true, id: body.nonce, body: out, reason: null };
  }
};

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
