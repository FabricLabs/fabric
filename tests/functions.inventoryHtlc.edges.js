'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { describe, it } = require('mocha');

const inventoryHtlc = require('../functions/inventoryHtlc');
const Key = require('../types/key');

describe('functions/inventoryHtlc edge cases', function () {
  function keys () {
    const seller = new Key();
    const buyer = new Key();
    return {
      sellerPub: Buffer.from(seller.pubkey, 'hex'),
      buyerPub: Buffer.from(buyer.pubkey, 'hex'),
      paymentHash32: crypto.randomBytes(32)
    };
  }

  it('rejects missing payment hash / pubkeys', function () {
    const { sellerPub, buyerPub, paymentHash32 } = keys();
    assert.throws(() => inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: sellerPub,
      buyerRefundPubkeyCompressed: buyerPub,
      paymentHash32: Buffer.alloc(31),
      refundLocktimeHeight: 100
    }), /./);
    assert.throws(() => inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: null,
      buyerRefundPubkeyCompressed: buyerPub,
      paymentHash32,
      refundLocktimeHeight: 100
    }), /./);
  });

  it('networkForFabricName maps known names and falls back safely', function () {
    assert.ok(inventoryHtlc.networkForFabricName('regtest'));
    assert.ok(inventoryHtlc.networkForFabricName('mainnet') || inventoryHtlc.networkForFabricName('bitcoin'));
    // Unknown names should not crash callers that coerce via builder.
    assert.doesNotThrow(() => inventoryHtlc.networkForFabricName('not-a-network'));
  });

  it('refundLocktimeMature is strict at boundary', function () {
    assert.strictEqual(inventoryHtlc.refundLocktimeMature(99, 100), false);
    assert.strictEqual(inventoryHtlc.refundLocktimeMature(100, 100), true);
    assert.strictEqual(inventoryHtlc.refundLocktimeMature(101, 100), true);
    assert.strictEqual(inventoryHtlc.refundLocktimeMature(NaN, 100), false);
    assert.strictEqual(inventoryHtlc.refundLocktimeMature(100, NaN), false);
  });

  it('randomPreimage32 is 32 distinct random bytes across calls', function () {
    const a = inventoryHtlc.randomPreimage32();
    const b = inventoryHtlc.randomPreimage32();
    assert.ok(Buffer.isBuffer(a) && a.length === 32);
    assert.ok(Buffer.isBuffer(b) && b.length === 32);
    assert.notStrictEqual(a.toString('hex'), b.toString('hex'));
  });

  it('buildHtlcFundingHints includes bip21-ish URI fields', function () {
    const { sellerPub, buyerPub, paymentHash32 } = keys();
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: sellerPub,
      buyerRefundPubkeyCompressed: buyerPub,
      paymentHash32,
      refundLocktimeHeight: 200
    });
    const hints = inventoryHtlc.buildHtlcFundingHints({
      paymentAddress: built.address,
      amountSats: 50_000,
      label: 'htlc-edge'
    });
    assert.strictEqual(hints.amountBtc, '0.00050000');
    assert.ok(String(hints.bitcoinUri).startsWith('bitcoin:'));
    assert.ok(String(hints.bitcoinUri).includes(built.address));
    assert.strictEqual(hints.label, 'htlc-edge');
  });

  it('hash256 of preimage is 32 bytes', function () {
    const pre = Buffer.alloc(32, 7);
    const h = inventoryHtlc.hash256(pre);
    assert.ok(Buffer.isBuffer(h));
    assert.strictEqual(h.length, 32);
  });
});
