'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fp = require('../functions/fabricPaymentBech32');

describe('@fabric/core/functions/fabricPaymentBech32', function () {
  it('encodeFabricRoutedPaymentV0 round-trips decodeFabricRoutedPayment', function () {
    const hash32 = crypto.randomBytes(32);
    const enc = fp.encodeFabricRoutedPaymentV0({ hash32 });
    assert.ok(enc.toLowerCase().startsWith('fa1'), enc);
    const dec = fp.decodeFabricRoutedPayment(enc);
    assert.ok(dec);
    assert.strictEqual(dec.version, 0);
    assert.strictEqual(dec.routeType, 0);
    assert.ok(Buffer.isBuffer(dec.hash32));
    assert.deepStrictEqual(dec.hash32, hash32);
  });

  it('reject wrong hash length', function () {
    assert.throws(() => fp.encodeFabricRoutedPaymentV0({ hash32: Buffer.alloc(31) }), /32 bytes/);
  });

  it('encodeFabricRoutedPaymentV0 rejects invalid inputs', function () {
    assert.throws(() => fp.encodeFabricRoutedPaymentV0(), /hash32/);
    assert.throws(() => fp.encodeFabricRoutedPaymentV0({ hash32: 'not-bytes' }), /Buffer/);
    assert.throws(() => fp.encodeFabricRoutedPaymentV0({ hash32: Buffer.alloc(32), routeType: 1.5 }), /integer/);
    assert.throws(() => fp.encodeFabricRoutedPaymentV0({ hash32: Buffer.alloc(32), routeType: 300 }), /255/);
  });

  it('decodeFabricRoutedPayment returns null for lnbc or garbage', function () {
    assert.strictEqual(fp.decodeFabricRoutedPayment('lnbc1qqqqqqqqqqqq'), null);
    assert.strictEqual(fp.decodeFabricRoutedPayment('fa1broken'), null);
  });

  it('classifyPaymentEncodingString prefers fa over ln', function () {
    const h = crypto.randomBytes(32);
    const fa = fp.encodeFabricRoutedPaymentV0({ hash32: h });
    assert.strictEqual(fp.classifyPaymentEncodingString(fa), 'fabric_routed_payment');
    assert.strictEqual(fp.classifyPaymentEncodingString('lno1qqqq'), 'bolt12_offer');
    assert.strictEqual(fp.classifyPaymentEncodingString('lnr1qqqq'), 'bolt12_invoice_request');
  });

  it('classifyPaymentEncodingString empty and unknown', function () {
    assert.strictEqual(fp.classifyPaymentEncodingString(''), 'empty');
    assert.strictEqual(fp.classifyPaymentEncodingString('   '), 'empty');
    assert.strictEqual(fp.classifyPaymentEncodingString('xyz'), 'unknown');
    assert.strictEqual(fp.classifyPaymentEncodingString(null), 'empty');
  });

  it('isFabricRoutedPaymentString', function () {
    assert.strictEqual(fp.isFabricRoutedPaymentString('fa1qqqq'), true);
    assert.strictEqual(fp.isFabricRoutedPaymentString('FA1qqqq'), true);
    assert.strictEqual(fp.isFabricRoutedPaymentString('lno1qq'), false);
    assert.strictEqual(fp.isFabricRoutedPaymentString(''), false);
  });

  it('encodeFabricRoutedPaymentV0 accepts Uint8Array hash32', function () {
    const u8 = new Uint8Array(32);
    u8[0] = 9;
    const enc = fp.encodeFabricRoutedPaymentV0({ hash32: u8 });
    const dec = fp.decodeFabricRoutedPayment(enc);
    assert.ok(dec);
    assert.strictEqual(dec.hash32[0], 9);
  });

  it('encodeFabricRoutedPaymentV0 non-default routeType round-trips', function () {
    const hash32 = crypto.randomBytes(32);
    const enc = fp.encodeFabricRoutedPaymentV0({ hash32, routeType: 7 });
    const dec = fp.decodeFabricRoutedPayment(enc);
    assert.ok(dec);
    assert.strictEqual(dec.routeType, 7);
  });

  it('decodeFabricRoutedPayment rejects empty input', function () {
    assert.strictEqual(fp.decodeFabricRoutedPayment(''), null);
    assert.strictEqual(fp.decodeFabricRoutedPayment(null), null);
  });

  it('exports constants', function () {
    assert.strictEqual(fp.FABRIC_ROUTED_PAYMENT_HRP, 'fa');
    assert.strictEqual(fp.FABRIC_ROUTED_PAYMENT_PREFIX, 'fa1');
    assert.strictEqual(fp.FabricRouteType.DOCUMENT_CONTENT_HASH, 0);
  });
});
