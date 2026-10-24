'use strict';

const assert = require('assert');
const crypto = require('crypto');
const ecc = require('../types/ecc');
const inventoryHtlc = require('../functions/inventoryHtlc');
const swap = require('../functions/liquiditySwap');

function randomPriv () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

function orderFields (makerPriv, overrides = {}) {
  return Object.assign({
    type: swap.BODY_TYPES.ORDER,
    side: 'ask',
    premiumPpm: 2500,
    feeSats: 100,
    minSats: 10000,
    maxSats: 1000000,
    prepaySats: 0,
    refundLockBlocks: 144,
    createdAt: 1000,
    expiresAt: 2000000000000,
    makerPubkey: swap.pubkeyFromPrivate(makerPriv),
    lightningNodeId: swap.pubkeyFromPrivate(randomPriv()),
    network: 'regtest',
    nonce: swap.randomNonce()
  }, overrides);
}

describe('functions/liquiditySwap', function () {
  describe('quote', function () {
    it('prices L2 at par plus premium, fee added on asks', function () {
      const q = swap.quote({ side: 'ask', premiumPpm: 10000, feeSats: 50, amountSats: 100000 });
      assert.strictEqual(q.l1Sats, 100000);
      assert.strictEqual(q.l2Msat, (101000 + 50) * 1000);
      assert.strictEqual(q.feeMsat, 50000);
    });

    it('subtracts the fee on bids so it still reaches the maker', function () {
      const q = swap.quote({ side: 'bid', premiumPpm: 10000, feeSats: 50, amountSats: 100000 });
      assert.strictEqual(q.l2Msat, (101000 - 50) * 1000);
      assert.strictEqual(q.feeMsat, -50000);
    });

    it('handles negative premiums and rounds to the nearest msat', function () {
      const q = swap.quote({ side: 'ask', premiumPpm: -3, amountSats: 1 });
      assert.strictEqual(q.l2Msat, 1000);
      const q2 = swap.quote({ side: 'ask', premiumPpm: -600, amountSats: 1 });
      assert.strictEqual(q2.l2Msat, 999);
      assert.strictEqual(q2.l2Sats, 1);
    });

    it('is exact for large amounts and refuses unsafe ones', function () {
      const q = swap.quote({ side: 'ask', premiumPpm: 1, amountSats: 123456789 });
      // 123456789000 msat × 1.000001 = 123456912456.789
      assert.strictEqual(q.l2Msat, 123456912457);
      assert.throws(() => swap.quote({ side: 'ask', premiumPpm: 0, amountSats: 2100000000000000 }), /too large/);
    });

    it('refuses a fee larger than the L2 amount and out-of-range premiums', function () {
      assert.throws(() => swap.quote({ side: 'bid', premiumPpm: 0, feeSats: 2000, amountSats: 1000 }), /fee exceeds/);
      assert.throws(() => swap.quote({ side: 'ask', premiumPpm: swap.MAX_PREMIUM_PPM + 1, amountSats: 1000 }), /premiumPpm/);
      assert.throws(() => swap.quote({ side: 'sideways', premiumPpm: 0, amountSats: 1000 }), /side/);
    });
  });

  describe('roles', function () {
    it('the L1 giver is the ask maker or the bid taker', function () {
      assert.strictEqual(swap.roleFor({ side: 'ask', isMaker: true }), 'l1Giver');
      assert.strictEqual(swap.roleFor({ side: 'ask', isMaker: false }), 'l2Giver');
      assert.strictEqual(swap.roleFor({ side: 'bid', isMaker: true }), 'l2Giver');
      assert.strictEqual(swap.roleFor({ side: 'bid', isMaker: false }), 'l1Giver');
    });

    it('swapRoles names the preimage owner', function () {
      const ask = swap.swapRoles({ side: 'ask', maker: 'M', taker: 'T' });
      assert.deepStrictEqual(ask, { l1Giver: 'M', l2Giver: 'T', preimageOwner: 'M', makerIsL1Giver: true });
      const bid = swap.swapRoles({ side: 'bid', maker: 'M', taker: 'T' });
      assert.deepStrictEqual(bid, { l1Giver: 'T', l2Giver: 'M', preimageOwner: 'T', makerIsL1Giver: false });
    });
  });

  describe('bodies and signatures', function () {
    it('signs and verifies an order; id is stable across signing', function () {
      const priv = randomPriv();
      const unsigned = swap.toBody(swap.BODY_TYPES.ORDER, orderFields(priv));
      const signed = swap.signBody(unsigned, priv);
      assert.strictEqual(swap.bodyId(unsigned), swap.bodyId(signed));
      const v = swap.verifyBody(JSON.parse(JSON.stringify(signed)));
      assert.strictEqual(v.ok, true, v.reason);
      assert.strictEqual(v.id, swap.bodyId(signed));
    });

    it('rejects tampering, unsigned bodies, and foreign keys', function () {
      const priv = randomPriv();
      const signed = swap.signBody(swap.toBody(swap.BODY_TYPES.ORDER, orderFields(priv)), priv);
      const tampered = Object.assign({}, signed, { premiumPpm: signed.premiumPpm + 1 });
      assert.strictEqual(swap.verifyBody(tampered).reason, 'bad signature');
      const unsigned = Object.assign({}, signed);
      delete unsigned.signature;
      assert.strictEqual(swap.verifyBody(unsigned).reason, 'unsigned body');
      assert.throws(() => swap.signBody(signed, randomPriv()), /does not match makerPubkey/);
    });

    it('fromBody returns null for other types, versions, and malformed fields', function () {
      const priv = randomPriv();
      assert.strictEqual(swap.fromBody({ type: 'FraudProof' }), null);
      assert.strictEqual(swap.fromBody(Object.assign(orderFields(priv), { version: 2 })), null);
      assert.strictEqual(swap.fromBody(orderFields(priv, { minSats: 10 })), null);
      assert.strictEqual(swap.fromBody(orderFields(priv, { maxSats: 5000, minSats: 10000 })), null);
      assert.strictEqual(swap.fromBody(orderFields(priv, { expiresAt: 500 })), null);
      assert.strictEqual(swap.fromBody(orderFields(priv, { refundLockBlocks: 1 })), null);
      assert.strictEqual(swap.fromBody(orderFields(priv, { instrument: 'BTC/USD' })), null);
      assert.ok(swap.fromBody(orderFields(priv)));
    });

    it('round-trips every body type', function () {
      const maker = randomPriv();
      const taker = randomPriv();
      const order = swap.signBody(swap.toBody(swap.BODY_TYPES.ORDER, orderFields(maker)), maker);
      const orderId = swap.bodyId(order);
      const bodies = [
        swap.signBody({ type: swap.BODY_TYPES.CANCEL, orderId, makerPubkey: order.makerPubkey, createdAt: 5 }, maker),
        swap.signBody({
          type: swap.BODY_TYPES.TAKE,
          orderId,
          side: 'ask',
          premiumPpm: order.premiumPpm,
          amountSats: 20000,
          takerPubkey: swap.pubkeyFromPrivate(taker),
          takerHtlcPubkey: swap.pubkeyFromPrivate(randomPriv()),
          takerNodeId: swap.pubkeyFromPrivate(randomPriv()),
          createdAt: 6,
          nonce: swap.randomNonce()
        }, taker),
        swap.signBody({
          type: swap.BODY_TYPES.TAKE_ACCEPT,
          orderId,
          takeId: 'ab'.repeat(32),
          makerPubkey: order.makerPubkey,
          makerHtlcPubkey: swap.pubkeyFromPrivate(randomPriv()),
          paymentHashHex: 'cd'.repeat(32),
          invoice: 'lnbcrt1mock',
          refundLockHeight: 300,
          prepayInvoice: 'lnbcrt1prepay',
          createdAt: 7
        }, maker),
        swap.signBody({
          type: swap.BODY_TYPES.FUNDED,
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
        const v = swap.verifyBody(JSON.parse(JSON.stringify(body)));
        assert.strictEqual(v.ok, true, `${body.type}: ${v.reason}`);
      }
      assert.strictEqual(bodies[2].prepayInvoice, 'lnbcrt1prepay');
    });
  });

  describe('takes', function () {
    function setup (side, takeOverrides = {}) {
      const maker = randomPriv();
      const taker = randomPriv();
      const order = swap.signBody(swap.toBody(swap.BODY_TYPES.ORDER, orderFields(maker, { side, prepaySats: 500 })), maker);
      const take = swap.toBody(swap.BODY_TYPES.TAKE, Object.assign({
        orderId: swap.bodyId(order),
        side,
        premiumPpm: order.premiumPpm,
        amountSats: 50000,
        takerPubkey: swap.pubkeyFromPrivate(taker),
        takerHtlcPubkey: swap.pubkeyFromPrivate(randomPriv()),
        takerNodeId: swap.pubkeyFromPrivate(randomPriv()),
        createdAt: 10,
        nonce: swap.randomNonce()
      }, takeOverrides));
      return { order, take };
    }

    it('accepts a matching take on an ask (maker gives L1)', function () {
      const { order, take } = setup('ask');
      assert.deepStrictEqual(swap.validateTake(order, take, { now: 5000 }), { ok: true, reason: null });
    });

    it('requires payment terms on a bid take (taker gives L1)', function () {
      const { order, take } = setup('bid');
      assert.match(swap.validateTake(order, take, { now: 5000 }).reason, /taker gives L1/);
      const withTerms = setup('bid', { paymentHashHex: 'aa'.repeat(32), invoice: 'lnbcrt1x', refundLockHeight: 400 });
      assert.strictEqual(swap.validateTake(withTerms.order, withTerms.take, { now: 5000 }).ok, true);
    });

    it('rejects wrong premium, amount, side, expiry', function () {
      const { order, take } = setup('ask');
      assert.match(swap.validateTake(order, Object.assign({}, take, { premiumPpm: 1 }), { now: 5000 }).reason, /premium/);
      assert.match(swap.validateTake(order, Object.assign({}, take, { amountSats: 5 }), { now: 5000 }).reason, /amount/);
      assert.match(swap.validateTake(order, Object.assign({}, take, { side: 'bid' }), { now: 5000 }).reason, /side/);
      assert.match(swap.validateTake(order, take, { now: order.expiresAt }).reason, /expired/);
    });

    it('validateTakeAccept requires maker terms and a prepay invoice on asks', function () {
      const { order, take } = setup('ask');
      const base = {
        orderId: swap.bodyId(order),
        takeId: swap.bodyId(take),
        makerPubkey: order.makerPubkey,
        makerHtlcPubkey: swap.pubkeyFromPrivate(randomPriv()),
        createdAt: 11
      };
      const noTerms = swap.toBody(swap.BODY_TYPES.TAKE_ACCEPT, base);
      assert.match(swap.validateTakeAccept(order, take, noTerms).reason, /maker gives L1/);
      const terms = { paymentHashHex: 'bb'.repeat(32), invoice: 'lnbcrt1y', refundLockHeight: 500 };
      const noPrepay = swap.toBody(swap.BODY_TYPES.TAKE_ACCEPT, Object.assign({}, base, terms));
      assert.match(swap.validateTakeAccept(order, take, noPrepay).reason, /prepay/);
      const full = swap.toBody(swap.BODY_TYPES.TAKE_ACCEPT, Object.assign({}, base, terms, { prepayInvoice: 'lnbcrt1p' }));
      assert.strictEqual(swap.validateTakeAccept(order, take, full).ok, true);
      assert.deepStrictEqual(swap.l1GiverTerms(order, take, full), Object.assign({}, terms, { prepayInvoice: 'lnbcrt1p' }));
    });
  });

  describe('escrow', function () {
    it('matches the inventory HTLC tree with claim = L2 giver, refund = L1 giver', function () {
      const l1 = randomPriv();
      const l2 = randomPriv();
      const preimage = crypto.randomBytes(32);
      const paymentHashHex = inventoryHtlc.hash256(preimage).toString('hex');
      const escrow = swap.buildSwapEscrow({
        networkName: 'regtest',
        l2GiverPubkeyHex: swap.pubkeyFromPrivate(l2),
        l1GiverPubkeyHex: swap.pubkeyFromPrivate(l1),
        paymentHashHex,
        refundLockHeight: 500,
        amountSats: 50000
      });
      const built = inventoryHtlc.buildInventoryHtlcP2tr({
        networkName: 'regtest',
        sellerPubkeyCompressed: Buffer.from(swap.pubkeyFromPrivate(l2), 'hex'),
        buyerRefundPubkeyCompressed: Buffer.from(swap.pubkeyFromPrivate(l1), 'hex'),
        paymentHash32: Buffer.from(paymentHashHex, 'hex'),
        refundLocktimeHeight: 500
      });
      assert.strictEqual(escrow.paymentAddress, built.address);
      assert.ok(escrow.bitcoinUri.includes('amount=0.00050000'));
    });

    it('validateSwapEscrow refuses a mismatched address', function () {
      const opts = {
        networkName: 'regtest',
        l2GiverPubkeyHex: swap.pubkeyFromPrivate(randomPriv()),
        l1GiverPubkeyHex: swap.pubkeyFromPrivate(randomPriv()),
        paymentHashHex: '11'.repeat(32),
        refundLockHeight: 500
      };
      const good = swap.validateSwapEscrow(opts);
      assert.strictEqual(good.ok, true);
      assert.strictEqual(swap.validateSwapEscrow(Object.assign({}, opts, { paymentAddress: good.escrow.paymentAddress })).ok, true);
      const swapped = swap.validateSwapEscrow(Object.assign({}, opts, {
        l2GiverPubkeyHex: opts.l1GiverPubkeyHex,
        l1GiverPubkeyHex: opts.l2GiverPubkeyHex,
        paymentAddress: good.escrow.paymentAddress
      }));
      assert.strictEqual(swapped.ok, false);
    });
  });

  describe('validateSwapInvoice', function () {
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
      assert.strictEqual(swap.validateSwapInvoice(base()).ok, true);
    });

    it('accepts legacy "msat" amount strings', function () {
      const o = base();
      o.decoded.amount_msat = '101000000msat';
      assert.strictEqual(swap.validateSwapInvoice(o).ok, true);
    });

    it('rejects a wrong hash, amount, or payee', function () {
      const a = base(); a.decoded.payment_hash = 'bb'.repeat(32);
      assert.match(swap.validateSwapInvoice(a).reason, /hash/);
      const b = base(); b.decoded.amount_msat = 101000001;
      assert.match(swap.validateSwapInvoice(b).reason, /amount/);
      const c = base(); c.decoded.payee = '03'.padEnd(66, '2');
      assert.match(swap.validateSwapInvoice(c).reason, /payee/);
    });

    it('rejects an invoice that outlives the refund lock or a lock too close to claim', function () {
      const late = base(); late.decoded.expiry = 144 * 600;
      assert.match(swap.validateSwapInvoice(late).reason, /outlives/);
      const close = base(); close.tipHeight = 240;
      assert.match(swap.validateSwapInvoice(close).reason, /too close/);
      const expired = base(); expired.nowSeconds = now + 601;
      assert.match(swap.validateSwapInvoice(expired).reason, /expired/);
    });
  });
});
