'use strict';

const assert = require('assert');
const {
  BEACON_NETWORK_PATH,
  BEACON_CHAIN_PATH,
  SIDECHAIN_STATE_PATH,
  normalizeBitcoinNetwork,
  readNetworkBinding,
  writeNetworkBinding,
  assertBeaconNetworkCompatible,
  resetBeaconNetworkStores,
  ensureBeaconNetworkBinding,
  hasBeaconOrSidechainData
} = require('../functions/beaconNetworkGuard');

function memoryFs (seed = {}) {
  const data = Object.assign(Object.create(null), seed);
  return {
    _data: data,
    readFile (p) {
      return Object.prototype.hasOwnProperty.call(data, p) ? data[p] : null;
    },
    writeFile (p, v) {
      data[p] = typeof v === 'string' ? v : JSON.stringify(v);
    },
    async publish (p, v) {
      data[p] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  };
}

describe('beaconNetworkGuard', function () {
  it('normalizes bitcoin / testnet3 labels', function () {
    assert.strictEqual(normalizeBitcoinNetwork('Bitcoin'), 'mainnet');
    assert.strictEqual(normalizeBitcoinNetwork('testnet3'), 'testnet');
    assert.strictEqual(normalizeBitcoinNetwork('signet'), 'signet');
  });

  it('allows fresh stores and binds network', async function () {
    const fs = memoryFs();
    const ensured = await ensureBeaconNetworkBinding(fs, 'regtest');
    assert.strictEqual(ensured.ok, true);
    assert.strictEqual(ensured.binding.network, 'regtest');
    assert.ok(readNetworkBinding(fs));
    assert.strictEqual(readNetworkBinding(fs).network, 'regtest');
  });

  it('rejects mismatch without reset', async function () {
    const fs = memoryFs();
    await writeNetworkBinding(fs, 'regtest');
    fs.writeFile(BEACON_CHAIN_PATH, JSON.stringify({ messages: [{ id: '1' }] }));
    const check = assertBeaconNetworkCompatible(fs, 'signet');
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.code, 'NETWORK_MISMATCH');
    const blocked = await ensureBeaconNetworkBinding(fs, 'signet');
    assert.strictEqual(blocked.ok, false);
  });

  it('resets and rebinds when FABRIC_BEACON_RESET_NETWORK=1', async function () {
    const fs = memoryFs();
    await writeNetworkBinding(fs, 'regtest');
    fs.writeFile(BEACON_CHAIN_PATH, JSON.stringify({ messages: [{ id: 'old' }] }));
    const prev = process.env.FABRIC_BEACON_RESET_NETWORK;
    process.env.FABRIC_BEACON_RESET_NETWORK = '1';
    try {
      const ensured = await ensureBeaconNetworkBinding(fs, 'signet');
      assert.strictEqual(ensured.ok, true);
      assert.strictEqual(ensured.binding.network, 'signet');
      assert.ok(ensured.reset);
      assert.ok(ensured.reset.cleared.includes(BEACON_CHAIN_PATH));
      const chain = JSON.parse(fs.readFile(BEACON_CHAIN_PATH));
      assert.deepStrictEqual(chain.messages, []);
    } finally {
      if (prev == null) delete process.env.FABRIC_BEACON_RESET_NETWORK;
      else process.env.FABRIC_BEACON_RESET_NETWORK = prev;
    }
  });

  it('flags unbound legacy stores with data', function () {
    const fs = memoryFs();
    fs.writeFile(BEACON_CHAIN_PATH, JSON.stringify({ messages: [{ id: 'legacy' }] }));
    assert.strictEqual(hasBeaconOrSidechainData(fs), true);
    const check = assertBeaconNetworkCompatible(fs, 'mainnet');
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.code, 'NETWORK_UNBOUND');
  });

  it('does not treat empty sidechain content (clock 0) as used data', function () {
    const fs = memoryFs();
    fs.writeFile(SIDECHAIN_STATE_PATH, JSON.stringify({ content: {}, clock: 0 }));
    assert.strictEqual(hasBeaconOrSidechainData(fs), false);
  });

  it('resetBeaconNetworkStores clears listed paths', async function () {
    const fs = memoryFs();
    fs.writeFile(BEACON_CHAIN_PATH, JSON.stringify({ messages: [1] }));
    fs.writeFile(BEACON_NETWORK_PATH, '{"network":"regtest"}');
    const { cleared } = await resetBeaconNetworkStores(fs);
    assert.ok(cleared.length >= 1);
  });
});
