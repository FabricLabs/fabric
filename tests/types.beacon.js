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
