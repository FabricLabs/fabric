'use strict';

const assert = require('assert');
const crypto = require('crypto');
const coinjoin = require('../functions/coinjoin');
const fidelityBond = require('../functions/fidelityBond');
const CoinjoinBook = require('../types/coinjoinBook');

const NOW = 1700000000000;

function maker () {
  const key = coinjoin.randomPrivateKey();
  return { key, pubkey: coinjoin.pubkeyFromPrivate(key) };
}

function offer (m, fields = {}) {
  return coinjoin.signBody(Object.assign({
    type: coinjoin.BODY_TYPES.OFFER,
    network: 'regtest',
    minSats: 100000,
    maxSats: 5000000,
    feeSats: 100,
    feePpm: 100,
    createdAt: NOW,
    expiresAt: NOW + 60000,
    makerPubkey: m.pubkey,
    nonce: coinjoin.randomNonce()
  }, fields), m.key);
}

function cancel (m, offerId) {
  return coinjoin.signBody({ type: coinjoin.BODY_TYPES.CANCEL, offerId, makerPubkey: m.pubkey, createdAt: NOW }, m.key);
}

function bondFor (m, valueSats, utxos, opts = {}) {
  const bondKey = opts.bondKey || coinjoin.randomPrivateKey();
  const txid = opts.txid || crypto.randomBytes(32).toString('hex');
  const locktime = 60000;
  const out = fidelityBond.buildBondP2tr({ networkName: 'regtest', bondPubkey: coinjoin.pubkeyFromPrivate(bondKey), locktime });
  utxos.set(`${txid}:0`, { valueSats, scriptPubKeyHex: out.scriptPubKeyHex, confirmations: 10 });
  return fidelityBond.signBondCertificate({
    network: 'regtest', txid, vout: 0, locktime, makerPubkey: m.pubkey, certExpiresAt: 11000, bondPrivateKey: bondKey
  });
}

function verifier (utxos) {
  return new fidelityBond.BondVerifier({
    network: 'regtest',
    bitcoin: {
      async getTipHeight () { return 10000; },
      async getTxOut (txid, vout) { return utxos.get(`${txid}:${vout}`) || null; }
    }
  });
}

describe('types/coinjoinBook', function () {
  let clock;
  let book;

  beforeEach(function () {
    clock = NOW;
    book = new CoinjoinBook({ now: () => clock });
  });

  it('holds valid offers and refuses bad ones', function () {
    const m = maker();
    assert.strictEqual(book.ingestOffer(offer(m)).ok, true);
    assert.strictEqual(book.ingestOffer(offer(m, { network: 'signet' })).reason, 'wrong network');
    assert.strictEqual(book.ingestOffer(offer(m, { createdAt: NOW - 2, expiresAt: NOW - 1 })).reason, 'offer expired');
    const tampered = Object.assign({}, offer(m), { feeSats: 0 });
    assert.strictEqual(book.ingestOffer(tampered).reason, 'bad signature');
    const o = offer(m);
    book.ingestOffer(o);
    assert.strictEqual(book.ingestOffer(o).duplicate, true);
    assert.strictEqual(book.size, 2);
  });

  it('applies cancels only from the maker, including for offers not yet seen', function () {
    const m = maker();
    const other = maker();
    const o = offer(m);
    const id = coinjoin.bodyId(o);
    assert.strictEqual(book.cancel(cancel(other, id)).ok, true);
    assert.strictEqual(book.ingestOffer(o).ok, true, 'a stranger cannot block the offer');
    assert.strictEqual(book.cancel(cancel(other, id)).reason, 'cancel is not from the maker');
    assert.strictEqual(book.cancel(cancel(m, id)).ok, true);
    assert.strictEqual(book.size, 0);
    assert.strictEqual(book.ingestOffer(o).reason, 'offer cancelled');
  });

  it('caps offers per maker and prunes expired ones', function () {
    const small = new CoinjoinBook({ now: () => clock, maxOffersPerMaker: 2 });
    const m = maker();
    for (let i = 0; i < 3; i++) small.ingestOffer(offer(m));
    assert.strictEqual(small.size, 2);
    clock = NOW + 60000;
    assert.strictEqual(small.prune(), 2);
  });

  it('chooses distinct makers whose range covers the amount and whose fee fits', function () {
    const makers = [maker(), maker(), maker(), maker()];
    book.ingestOffer(offer(makers[0]));
    book.ingestOffer(offer(makers[0], { feeSats: 50 }));
    book.ingestOffer(offer(makers[1]));
    book.ingestOffer(offer(makers[2], { feeSats: 10000 }));
    book.ingestOffer(offer(makers[3], { maxSats: 200000 }));
    const chosen = book.choose(1000000, 5, { maxFeeSats: 1000 });
    const keys = chosen.map((o) => o.makerPubkey).sort();
    assert.deepStrictEqual(keys, [makers[0].pubkey, makers[1].pubkey].sort());
    const first = chosen.find((o) => o.makerPubkey === makers[0].pubkey);
    assert.strictEqual(first.cjfeeSats, 150, 'the maker\'s cheapest fitting offer');
    assert.strictEqual(book.choose(1000000, 5, { maxFeeSats: 1000, exclude: [makers[1].pubkey] }).length, 1);
  });

  it('weights the draw by bond value', async function () {
    const utxos = new Map();
    const bonded = maker();
    const plain = maker();
    book.ingestOffer(offer(bonded, { fidelityBond: bondFor(bonded, 100000000, utxos) }));
    book.ingestOffer(offer(plain));
    const report = await book.refreshBonds(verifier(utxos));
    assert.deepStrictEqual(report, { checked: 1, valid: 1, shared: 0 });
    assert.ok(book.bondOf(bonded.pubkey).value > 0);
    let bondedFirst = 0;
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 1000; i++) {
      if (book.choose(1000000, 1, { random })[0].makerPubkey === bonded.pubkey) bondedFirst++;
    }
    assert.ok(bondedFirst > 850 && bondedFirst < 950, `bonded maker drawn ${bondedFirst} / 1000 (expected ~909)`);
    assert.strictEqual(book.choose(1000000, 2, { requireBond: true }).length, 1);
  });

  it('gives a bond outpoint certified for two makers to neither', async function () {
    const utxos = new Map();
    const a = maker();
    const b = maker();
    const shared = { bondKey: coinjoin.randomPrivateKey(), txid: crypto.randomBytes(32).toString('hex') };
    book.ingestOffer(offer(a, { fidelityBond: bondFor(a, 100000000, utxos, shared) }));
    book.ingestOffer(offer(b, { fidelityBond: bondFor(b, 100000000, utxos, shared) }));
    const report = await book.refreshBonds(verifier(utxos));
    assert.strictEqual(report.shared, 2);
    assert.strictEqual(book.bondOf(a.pubkey).ok, false);
    assert.strictEqual(book.bondOf(b.pubkey).reason, 'bond advertised by another maker');
  });

  it('keeps a bond valid when another maker copies its descriptor', async function () {
    const utxos = new Map();
    const a = maker();
    const b = maker();
    const bond = bondFor(a, 100000000, utxos);
    book.ingestOffer(offer(a, { fidelityBond: bond }));
    book.ingestOffer(offer(b, { fidelityBond: bond }));
    const report = await book.refreshBonds(verifier(utxos));
    assert.strictEqual(report.shared, 0);
    assert.strictEqual(book.bondOf(a.pubkey).ok, true);
    assert.strictEqual(book.bondOf(b.pubkey).ok, false);
    assert.strictEqual(book.bondOf(b.pubkey).reason, 'bad certificate');
  });

  it('rejects a bond certified for another maker', async function () {
    const utxos = new Map();
    const a = maker();
    const thief = maker();
    book.ingestOffer(offer(thief, { fidelityBond: bondFor(a, 100000000, utxos) }));
    await book.refreshBonds(verifier(utxos));
    assert.strictEqual(book.bondOf(thief.pubkey).reason, 'bad certificate');
    assert.strictEqual(book.listOffers()[0].bondValue, 0);
  });

  it('summarizes the market', function () {
    book.ingestOffer(offer(maker()));
    book.ingestOffer(offer(maker(), { feeSats: 300 }));
    const index = book.index(1000000);
    assert.strictEqual(index.offers, 2);
    assert.strictEqual(index.makers, 2);
    assert.strictEqual(index.makersForAmount, 2);
    assert.strictEqual(index.cheapestFeeSats, 200);
  });
});
