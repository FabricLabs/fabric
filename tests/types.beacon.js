'use strict';

const assert = require('assert');
const Beacon = require('../types/beacon');
const Key = require('../types/key');
const sidechainState = require('../functions/sidechainState');

function stubBitcoin (opts = {}) {
  let height = opts.height != null ? opts.height : 0;
  let tip = opts.tip || ('ab'.repeat(32));
  return {
    async getUnusedAddress () {
      return 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    },
    async _makeRPCRequest (method) {
      if (method === 'generatetoaddress') {
        height += 1;
        tip = Buffer.alloc(32, height % 255).toString('hex');
        return [tip];
      }
      if (method === 'getblockcount') return height;
      if (method === 'getbalances') {
        return { mine: { trusted: height * 50 } };
      }
      if (method === 'getbestblockhash') return tip;
      throw new Error(`unexpected rpc ${method}`);
    }
  };
}

function memoryFs () {
  const store = Object.create(null);
  return {
    readFile (path) {
      return store[path] != null ? store[path] : null;
    },
    async publish (path, value) {
      store[path] = typeof value === 'string' ? value : JSON.stringify(value);
      return true;
    },
    _store: store
  };
}

describe('@fabric/core/types/beacon', function () {
  it('createEpoch seals sidechain digest into BEACON_EPOCH', async function () {
    const key = new Key({ network: 'regtest' });
    const fs = memoryFs();
    let state = sidechainState.createInitialState();
    const applied = sidechainState.applyPatchesToState(state, [
      { op: 'add', path: '/registry', value: { documents: { 'sim/a': { rateSats: 1 } } } }
    ]);
    assert.ok(applied.ok);
    state = applied.state;
    await sidechainState.persistState(fs, state);

    const beacon = new Beacon({
      regtest: true,
      mineOnStart: false,
      interval: 0
    });
    beacon.attach({
      bitcoin: stubBitcoin(),
      fs,
      key,
      getSidechainSnapshotForEpoch () {
        const st = sidechainState.loadState(fs);
        return { clock: st.clock, stateDigest: sidechainState.stateDigest(st) };
      }
    });

    const payload = await beacon.createEpoch();
    assert.ok(payload && payload.sidechain);
    assert.strictEqual(payload.sidechain.stateDigest, sidechainState.stateDigest(state));
    assert.strictEqual(payload.sidechain.clock, state.clock);
    assert.ok(payload.height >= 1);
    assert.strictEqual(beacon.getEpochChainSummary().length, 1);
  });

  it('persists beacon/CHAIN via filesystem publish', async function () {
    const key = new Key({ network: 'regtest' });
    const fs = memoryFs();
    const beacon = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    beacon.attach({ bitcoin: stubBitcoin(), fs, key });
    await beacon.createEpoch();
    const raw = fs.readFile(Beacon.BEACON_CHAIN_PATH);
    assert.ok(raw);
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed.messages) && parsed.messages.length === 1);
  });

  it('finalizes an already-ready federation round instead of rejecting round not open', async function () {
    const beaconFederationSigning = require('../functions/beaconFederationSigning');
    const beacon = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    beacon.fs = memoryFs();
    const k1 = new Key({ private: '3333333333333333333333333333333333333333333333333333333333333333' });
    const payload = { clock: 3, height: 3, blockHash: 'cc'.repeat(32) };
    const round = beaconFederationSigning.createRound(payload, {
      validators: [k1.pubkey],
      threshold: 1
    });
    const msg = beaconFederationSigning.messageBufferForPayload(payload);
    const added = beaconFederationSigning.addSignature(
      round, k1.pubkey, k1.signSchnorr(msg).toString('hex')
    );
    assert.strictEqual(added.sealed, true);
    const digest = round.commitmentDigest;
    beacon._pendingEpochRounds.set(digest, round);
    const result = await beacon.submitFederationEpochSignature(digest, k1.pubkey, '00');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.sealed, true);
    assert.strictEqual(beacon._epochChain.tip.payload.clock, 3);
    assert.strictEqual(beacon._pendingEpochRounds.has(digest), false);
  });

  it('rejects a recovered ready round whose witness fails the threshold', async function () {
    const beaconFederationSigning = require('../functions/beaconFederationSigning');
    const beacon = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    beacon.fs = memoryFs();
    const payload = { clock: 5, height: 5, blockHash: 'ee'.repeat(32) };
    const digest = beaconFederationSigning.epochCommitmentDigestHex(payload);
    beacon._pendingEpochRounds.set(digest, {
      commitmentDigest: digest,
      payload,
      validators: ['aa'.repeat(32)],
      threshold: 1,
      witness: { version: 1, signatures: { ['aa'.repeat(32)]: '00' } },
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const result = await beacon.submitFederationEpochSignature(digest, 'aa'.repeat(32), '00');
    assert.strictEqual(result.status, 'error');
    assert.match(String(result.message), /threshold/i);
    assert.strictEqual(beacon._epochChain.height, 0);
  });

  it('rejects a recovered ready round that emptied validators against configured federation keys', async function () {
    const beaconFederationSigning = require('../functions/beaconFederationSigning');
    const k1 = new Key({ private: '5555555555555555555555555555555555555555555555555555555555555555' });
    const beacon = new Beacon({
      regtest: true,
      mineOnStart: false,
      interval: 0,
      federationValidators: [k1.pubkey],
      federationThreshold: 1
    });
    beacon.fs = memoryFs();
    const payload = { clock: 7, height: 7, blockHash: '11'.repeat(32) };
    const digest = beaconFederationSigning.epochCommitmentDigestHex(payload);
    beacon._pendingEpochRounds.set(digest, {
      commitmentDigest: digest,
      payload,
      validators: [],
      threshold: 1,
      witness: { version: 1, signatures: {} },
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const result = await beacon.submitFederationEpochSignature(digest, k1.pubkey, '00');
    assert.strictEqual(result.status, 'error');
    assert.match(String(result.message), /threshold/i);
    assert.strictEqual(beacon._epochChain.height, 0);
  });

  it('retains a ready round when epoch-chain persist fails', async function () {
    const beaconFederationSigning = require('../functions/beaconFederationSigning');
    const beacon = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    const fs = memoryFs();
    fs.publish = async function () { throw new Error('disk full'); };
    beacon.fs = fs;
    const k1 = new Key({ private: '4444444444444444444444444444444444444444444444444444444444444444' });
    const payload = { clock: 6, height: 6, blockHash: 'ff'.repeat(32) };
    const round = beaconFederationSigning.createRound(payload, {
      validators: [k1.pubkey],
      threshold: 1
    });
    const msg = beaconFederationSigning.messageBufferForPayload(payload);
    beaconFederationSigning.addSignature(round, k1.pubkey, k1.signSchnorr(msg).toString('hex'));
    beacon._pendingEpochRounds.set(round.commitmentDigest, round);
    const result = await beacon.submitFederationEpochSignature(
      round.commitmentDigest, k1.pubkey, '00'
    );
    assert.strictEqual(result.status, 'error');
    assert.match(String(result.message), /persist/i);
    assert.strictEqual(result.pending, true);
    assert.ok(beacon._pendingEpochRounds.has(round.commitmentDigest));
  });

  it('does not double-append when the ready round is already on the epoch chain', async function () {
    const beaconFederationSigning = require('../functions/beaconFederationSigning');
    const Chain = require('../types/chain');
    const beacon = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    beacon.fs = memoryFs();
    const payload = { clock: 4, height: 4, blockHash: 'dd'.repeat(32) };
    const digest = beaconFederationSigning.epochCommitmentDigestHex(payload);
    const round = {
      commitmentDigest: digest,
      payload,
      validators: ['aa'],
      threshold: 1,
      witness: { version: 1, signatures: { aa: '00' } },
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    beacon._epochChain = Chain.fromBeaconMessages([
      { type: 'BEACON_EPOCH', payload, federationWitness: round.witness }
    ]);
    beacon._pendingEpochRounds.set(digest, round);
    const result = await beacon.submitFederationEpochSignature(digest, 'aa', '00');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.sealed, true);
    assert.strictEqual(beacon._epochChain.height, 1);
    assert.strictEqual(beacon._pendingEpochRounds.has(digest), false);
  });

  it('retains an already-sealed round when epoch-chain persist fails', async function () {
    const beaconFederationSigning = require('../functions/beaconFederationSigning');
    const Chain = require('../types/chain');
    const beacon = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    const fs = memoryFs();
    fs.publish = async function () { throw new Error('disk full'); };
    beacon.fs = fs;
    const payload = { clock: 7, height: 7, blockHash: 'aa'.repeat(32) };
    const digest = beaconFederationSigning.epochCommitmentDigestHex(payload);
    const round = {
      commitmentDigest: digest,
      payload,
      validators: ['aa'],
      threshold: 1,
      witness: { version: 1, signatures: { aa: '00' } },
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    beacon._epochChain = Chain.fromBeaconMessages([
      { type: 'BEACON_EPOCH', payload, federationWitness: round.witness }
    ]);
    beacon._pendingEpochRounds.set(digest, round);
    const result = await beacon.submitFederationEpochSignature(digest, 'aa', '00');
    assert.strictEqual(result.status, 'error');
    assert.match(String(result.message), /persist/i);
    assert.strictEqual(result.pending, true);
    assert.ok(beacon._pendingEpochRounds.has(digest));
  });
});

const {
  BEACON_CONTRACT_NAME,
  BEACON_MESSAGE_TYPES,
  beaconContractDefinition,
  beaconContractId,
  beaconRedeploySteps,
  normalizeValidatorPubkeys
} = require('../functions/beaconContractDefinition');
const { normalizeArcGenesis, resolveSpend } = require('../functions/contractSpend');
const { buildFederationVaultFromPolicy, DEFAULT_CSV_BLOCKS } = require('../functions/contractTaproot');

describe('beaconContractDefinition', function () {
  it('builds network-agnostic ARC genesis with stable Actor id', function () {
    const a = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const b = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const def1 = beaconContractDefinition({
      validators: [b.pubkey, a.pubkey],
      threshold: 1,
      publisher: a.pubkey
    });
    const def2 = beaconContractDefinition({
      validators: [a.pubkey, b.pubkey],
      threshold: 1,
      publisher: a.pubkey
    });
    assert.strictEqual(def1.name, BEACON_CONTRACT_NAME);
    assert.ok(!Object.prototype.hasOwnProperty.call(def1.spendPolicy, 'network'));
    assert.ok(!Object.prototype.hasOwnProperty.call(def1, 'bitcoinAnchor'));
    assert.deepStrictEqual(def1.primitives.messageTypes, BEACON_MESSAGE_TYPES.slice());
    assert.strictEqual(beaconContractId(def1), beaconContractId(def2));
    assert.strictEqual(def1.spendPolicy.csvBlocks, DEFAULT_CSV_BLOCKS);
  });

  it('normalizeValidatorPubkeys sorts and dedupes', function () {
    const a = new Key({ private: '3333333333333333333333333333333333333333333333333333333333333333' });
    const list = normalizeValidatorPubkeys([a.pubkey, a.pubkey, String(a.pubkey).toUpperCase()]);
    assert.strictEqual(list.length, 1);
  });

  it('normalizeValidatorPubkeys drops invalid x-only points', function () {
    const a = new Key({ private: '6666666666666666666666666666666666666666666666666666666666666666' });
    const invalidXOnly = '00'.repeat(32); // not a lift-able curve x
    const list = normalizeValidatorPubkeys([invalidXOnly, a.pubkey, 'not-a-key']);
    assert.deepStrictEqual(list, [String(a.pubkey).toLowerCase()]);
  });

  it('spendAddress matches federation vault on each network overlay', function () {
    const a = new Key({ private: '4444444444444444444444444444444444444444444444444444444444444444' });
    const b = new Key({ private: '5555555555555555555555555555555555555555555555555555555555555555' });
    const def = beaconContractDefinition({
      validators: [a.pubkey, b.pubkey],
      threshold: 2,
      publisher: a.pubkey,
      csvBlocks: 144
    });
    const arc = normalizeArcGenesis(def);
    for (const network of ['regtest', 'signet', 'mainnet']) {
      const spend = resolveSpend({
        genesis: arc,
        tip: {
          content: { members: arc.members.signers.map((p) => String(p).replace(/^0[23]/i, '')) },
          stateDigest: 'aa'.repeat(32),
          bitcoinBlockHash: 'bb'.repeat(32)
        },
        overrides: { network }
      });
      const vault = buildFederationVaultFromPolicy({
        validatorPubkeysHex: arc.spendPolicy.validators,
        threshold: 2,
        networkName: network,
        publisher: a.pubkey,
        csvBlocks: 144
      });
      assert.strictEqual(spend.address, vault.address, network);
    }
  });

  it('exposes redeploy steps', function () {
    const steps = beaconRedeploySteps();
    assert.ok(Array.isArray(steps));
    assert.ok(steps.length >= 4);
    assert.ok(steps.some((s) => /FABRIC_BEACON_RESET_NETWORK/.test(s)));
  });
});

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

function memoryFsBeaconGuard (seed = {}) {
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
    const fs = memoryFsBeaconGuard();
    const ensured = await ensureBeaconNetworkBinding(fs, 'regtest');
    assert.strictEqual(ensured.ok, true);
    assert.strictEqual(ensured.binding.network, 'regtest');
    assert.ok(readNetworkBinding(fs));
    assert.strictEqual(readNetworkBinding(fs).network, 'regtest');
  });

  it('rejects mismatch without reset', async function () {
    const fs = memoryFsBeaconGuard();
    await writeNetworkBinding(fs, 'regtest');
    fs.writeFile(BEACON_CHAIN_PATH, JSON.stringify({ messages: [{ id: '1' }] }));
    const check = assertBeaconNetworkCompatible(fs, 'signet');
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.code, 'NETWORK_MISMATCH');
    const blocked = await ensureBeaconNetworkBinding(fs, 'signet');
    assert.strictEqual(blocked.ok, false);
  });

  it('resets and rebinds when FABRIC_BEACON_RESET_NETWORK=1', async function () {
    const fs = memoryFsBeaconGuard();
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
    const fs = memoryFsBeaconGuard();
    fs.writeFile(BEACON_CHAIN_PATH, JSON.stringify({ messages: [{ id: 'legacy' }] }));
    assert.strictEqual(hasBeaconOrSidechainData(fs), true);
    const check = assertBeaconNetworkCompatible(fs, 'mainnet');
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.code, 'NETWORK_UNBOUND');
  });

  it('does not treat empty sidechain content (clock 0) as used data', function () {
    const fs = memoryFsBeaconGuard();
    fs.writeFile(SIDECHAIN_STATE_PATH, JSON.stringify({ content: {}, clock: 0 }));
    assert.strictEqual(hasBeaconOrSidechainData(fs), false);
  });

  it('resetBeaconNetworkStores clears listed paths', async function () {
    const fs = memoryFsBeaconGuard();
    fs.writeFile(BEACON_CHAIN_PATH, JSON.stringify({ messages: [1] }));
    fs.writeFile(BEACON_NETWORK_PATH, '{"network":"regtest"}');
    const { cleared } = await resetBeaconNetworkStores(fs);
    assert.ok(cleared.length >= 1);
  });
});
