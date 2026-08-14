'use strict';

const assert = require('assert');
const {
  CLI_CONTRACTS,
  defineContract,
  resolveEnabledContracts,
  findCliContract
} = require('../functions/cliContracts');
const {
  createDocumentPurchaseSession,
  listRefundCandidates
} = require('../functions/documentMarket');

describe('functions/cliContracts', function () {
  it('catalog includes core + documents-market with refunds', function () {
    assert.ok(CLI_CONTRACTS.length >= 5);
    const core = findCliContract('core');
    assert.ok(core.required);
    assert.ok(core.commands.unlock);
    assert.ok(core.commands.lock);
    assert.ok(core.commands.contracts);
    assert.ok(!core.commands.apps);
    const market = findCliContract('documents-market');
    assert.ok(market.commands.refund);
    assert.ok(market.commands.refunds);
    const wallet = findCliContract('wallet');
    assert.ok(wallet.commands.wallet);
    assert.ok(!/identity lock/i.test(wallet.description));
    const execution = findCliContract('execution');
    assert.ok(execution.commands.create);
    assert.ok(execution.commands.deploy);
    const debug = findCliContract('debug');
    assert.strictEqual(debug.defaultEnabled, false);
  });

  it('resolveEnabledContracts defaults match catalog', function () {
    const resolved = resolveEnabledContracts({});
    assert.ok(resolved.find((c) => c.id === 'core').enabled);
    assert.ok(resolved.find((c) => c.id === 'documents-market').enabled);
    assert.strictEqual(resolved.find((c) => c.id === 'debug').enabled, false);
  });

  it('settings can disable non-required contracts', function () {
    const resolved = resolveEnabledContracts({
      cliContracts: { explorer: false },
      cliContractsDisabled: ['wallet']
    });
    assert.strictEqual(resolved.find((c) => c.id === 'explorer').enabled, false);
    assert.strictEqual(resolved.find((c) => c.id === 'wallet').enabled, false);
    assert.strictEqual(resolved.find((c) => c.id === 'core').enabled, true);
  });

  it('legacy applications settings still resolve', function () {
    const resolved = resolveEnabledContracts({
      applications: { explorer: false },
      applicationsDisabled: ['wallet']
    });
    assert.strictEqual(resolved.find((c) => c.id === 'explorer').enabled, false);
    assert.strictEqual(resolved.find((c) => c.id === 'wallet').enabled, false);
  });

  it('required core cannot be disabled via settings', function () {
    const resolved = resolveEnabledContracts({
      cliContracts: { core: false },
      cliContractsDisabled: ['core']
    });
    assert.strictEqual(resolved.find((c) => c.id === 'core').enabled, true);
  });

  it('defineContract freezes command map and sets @type', function () {
    const contract = defineContract({
      id: 't',
      title: 'T',
      interfaces: ['program'],
      commands: { x: '_x' }
    });
    assert.strictEqual(contract['@type'], 'FabricCliContract');
    assert.deepStrictEqual(contract.interfaces, ['cli.shell', 'program']);
    assert.throws(() => { contract.commands.y = '_y'; });
  });

  it('documents-market advertises multiple interfaces', function () {
    const market = findCliContract('documents-market');
    assert.ok(market.interfaces.includes('cli.shell'));
    assert.ok(market.interfaces.includes('document-exchange'));
    assert.ok(market.interfaces.includes('payment/escrow'));
  });
});

describe('listRefundCandidates', function () {
  it('lists mature / pending / failed buckets', function () {
    const sessions = new Map();
    sessions.set('a', createDocumentPurchaseSession({
      documentId: 'doc-a',
      seller: 's',
      contentHashHex: 'aa'.repeat(32),
      amountSats: 1000,
      paymentAddress: 'bcrt1mature',
      htlc: {
        paymentAddress: 'bcrt1mature',
        claimScriptHex: '51',
        refundScriptHex: '51',
        refundLocktimeHeight: 50
      }
    }));
    sessions.get('a').status = 'delivery_pending';

    sessions.set('b', createDocumentPurchaseSession({
      documentId: 'doc-b',
      seller: 's',
      contentHashHex: 'bb'.repeat(32),
      amountSats: 2000,
      paymentAddress: 'bcrt1pend',
      htlc: {
        paymentAddress: 'bcrt1pend',
        claimScriptHex: '51',
        refundScriptHex: '51',
        refundLocktimeHeight: 200
      }
    }));

    sessions.set('c', createDocumentPurchaseSession({
      documentId: 'doc-c',
      seller: 's',
      contentHashHex: 'cc'.repeat(32),
      amountSats: 500,
      paymentAddress: 'bcrt1fail',
      htlc: {
        paymentAddress: 'bcrt1fail',
        claimScriptHex: '51',
        refundScriptHex: '51',
        refundLocktimeHeight: 10
      }
    }));
    sessions.get('c').status = 'fraud';
    sessions.get('c').error = 'blob reject';

    const outstanding = listRefundCandidates(sessions, 100, { filter: 'outstanding' });
    assert.ok(outstanding.some((r) => r.bucket === 'mature' && r.settlementId === sessions.get('a').settlementId));
    assert.ok(outstanding.some((r) => r.bucket === 'pending'));
    assert.ok(outstanding.some((r) => r.bucket === 'failed'));

    const mature = listRefundCandidates(sessions, 100, { filter: 'mature' });
    assert.strictEqual(mature.length, 1);
    assert.strictEqual(mature[0].bucket, 'mature');

    const failed = listRefundCandidates(sessions, 100, { filter: 'failed' });
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(failed[0].error, 'blob reject');
  });
});
