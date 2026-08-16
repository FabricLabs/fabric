'use strict';

const assert = require('assert');
const { encodeBitcoinUri, parseBitcoinUri } = require('../functions/bip21');
const inventoryHtlc = require('../functions/inventoryHtlc');

describe('@fabric/core/functions/bip21', function () {
  it('encodes amount and label like inventory HTLC funding hints', function () {
    const uri = encodeBitcoinUri({
      address: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amount: '0.00100000',
      label: 'Test doc'
    });
    assert.ok(uri.startsWith('bitcoin:bcrt1'));
    assert.ok(uri.includes('amount=0.00100000'));
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.address, 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr');
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('round-trips opaque BIP-321 extras (lightning, pj)', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      extras: { lightning: 'lnbc1qq', pj: 'https://example.test/pj' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.strictEqual(parsed.extras.pj, 'https://example.test/pj');
  });

  it('is used by buildHtlcFundingHints', function () {
    const h = inventoryHtlc.buildHtlcFundingHints({
      paymentAddress: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amountSats: 100000,
      label: 'Test doc'
    });
    const parsed = parseBitcoinUri(h.bitcoinUri);
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('parses official BIP-21 examples (address, amount, label, message)', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    const bare = parseBitcoinUri(`bitcoin:${addr}`);
    assert.strictEqual(bare.address, addr);
    assert.strictEqual(bare.amount, null);
    const paid = parseBitcoinUri(`bitcoin:${addr}?amount=20.3&label=Luke-Jr`);
    assert.strictEqual(paid.amount, '20.3');
    assert.strictEqual(paid.label, 'Luke-Jr');
    const msg = parseBitcoinUri(
      `bitcoin:${addr}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`
    );
    assert.strictEqual(msg.message, 'Donation for project xyz');
    const upper = parseBitcoinUri(`BITCOIN:${addr}`);
    assert.strictEqual(upper.address, addr);
    const slash = parseBitcoinUri(`bitcoin://${addr}?amount=1`);
    assert.strictEqual(slash.address, addr);
    assert.strictEqual(slash.amount, '1');
  });

  it('encodes message and address-only URIs; extras cannot override amount', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      amount: 1,
      extras: { amount: '9', lightning: 'lnbc1qq', unused: '' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.amount, '1.00000000');
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed.extras, 'unused'));
    assert.strictEqual(
      encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }),
      'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    );
    const withMsg = encodeBitcoinUri({
      address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
      message: 'Donation for project xyz'
    });
    assert.strictEqual(parseBitcoinUri(withMsg).message, 'Donation for project xyz');
  });

  it('rejects missing address and invalid amounts', function () {
    assert.throws(() => encodeBitcoinUri({}), /address/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: -1 }), /non-negative/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1q?bad' }), /\? or #/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: '1btc' }), /decimal BTC/);
    assert.throws(() => parseBitcoinUri('https://example.test'), /bitcoin:/);
    assert.throws(() => parseBitcoinUri('bitcoin:addr?amount=-1'), /amount is invalid/);
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?req-something=1'),
      /unsupported required BIP21 parameter/
    );
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?REQ-exp=1'),
      /unsupported required BIP21 parameter/
    );
  });
});
