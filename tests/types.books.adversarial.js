'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const bitcoin = require('bitcoinjs-lib');

const ecc = require('../types/ecc');
const Book = require('../types/book');
const Swap = require('../types/swap');
const LiquidityBook = require('../types/liquidityBook');
const Coinjoin = require('../types/coinjoin');
const CoinjoinBook = require('../types/coinjoinBook');
const DocumentBook = require('../types/documentBook');
const Channel = require('../types/channel');
const ChannelBook = require('../types/channelBook');
const Market = require('../services/market');
const { signerFromPriv32 } = require('../types/htlc');

const NET = bitcoin.networks.regtest;

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
