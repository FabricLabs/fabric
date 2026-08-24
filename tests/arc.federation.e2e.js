'use strict';

/**
 * E2E: ARC establishment / execution / withdrawal across Fabric mesh and
 * Bitcoin L1, including nested Federation trees and multi-leaf Taproot spends.
 *
 * Always-on: mesh gossip + synthetic funded txs (no bitcoind).
 * L1 broadcast: set FABRIC_E2E_REGTEST=1 (managed bitcoind on PATH).
 *
 *   npm test -- --grep 'ARC / Federation'
 *   FABRIC_E2E_REGTEST=1 npm run test:e2e-arc-l1
 */

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');

const Bitcoin = require('../services/bitcoin');
const Key = require('../types/key');
const Machine = require('../types/machine');
const Program = require('../types/program');
const {
  assertMachineRunMatches
} = require('../functions/contractProgramBind');
const {
  createMemoryStore,
  ingestContractPublishBuffer,
  ingestMessageBuffer,
  tipFromDoc
} = require('../functions/contractMessageAccumulate');
const {
  resolveSpend,
  buildWithdrawalRequest,
  buildWithdrawalWitness,
  validateWithdrawalRequest,
  prepareWithdrawalFromRequest,
  bindProgramRunToTip
} = require('../functions/contractSpend');
const {
  buildFederationVaultFromPolicy,
  buildContractTaproot,
  synthesizeDefaultLadder,
  selectActiveTiers,
  prepareTierWithdrawalPsbt,
  prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt,
  toAddress
} = require('../functions/contractTaproot');
const {
  observePaymentToAddress,
  applyPaymentObservationToTip
} = require('../functions/contractPaymentObserve');
const {
  createRound,
  addSignature,
  roundMeetsThreshold,
  messageBufferForPayload
} = require('../functions/beaconFederationSigning');
const { NetworkHarness } = require('./simulator/lib/network');
const { waitUntil } = require('./helpers/peer');
const { isolatedManagedRegtestSettings } = require('./helpers/bitcoinRegtest');
const {
  createCollection,
  ingest
} = require('../functions/fabricMessageCollection');
const {
  e2eRegtestEnabled,
  signSpendPsbt,
  syntheticFundedTxHex,
  p2wpkhAddress,
  compressedPubkey,
  pubkeyXOnly,
  arcDefinition,
  contractIdOf,
  signPublish,
  signContractMessage,
  attachCollector,
  appHashes,
  keysNamed
} = require('./helpers/arcFederationE2e');

const BLOCK_HASH = 'ab'.repeat(32);
const CSV_BLOCKS = 3;

function foldPublish (store, message) {
  return ingestContractPublishBuffer(store, message.toBuffer());
}

function foldMessage (store, contractId, message) {
  return ingestMessageBuffer(store, contractId, message.toBuffer());
}

function buildFederationTree (opts = {}) {
  const csvBlocks = opts.csvBlocks != null ? opts.csvBlocks : CSV_BLOCKS;
  const blockHash = opts.blockHash || BLOCK_HASH;
  const height = opts.height != null ? opts.height : 1;
  const orgKeys = opts.orgKeys || keysNamed(5);
  const opsKeys = opts.opsKeys || [orgKeys[0], orgKeys[1], orgKeys[2]];
  const treasuryKeys = opts.treasuryKeys || [orgKeys[0], orgKeys[3], orgKeys[4], new Key()];
  const missionKeys = opts.missionKeys || [opsKeys[0], opsKeys[1]];

  const orgDef = arcDefinition({
    name: 'org-root',
    signers: orgKeys,
    publisher: orgKeys[0],
    threshold: 3,
    csvBlocks,
    blockHash,
    height,
    internalKeyMode: opts.internalKeyMode
  });
  const orgId = contractIdOf(orgDef);

  const opsDef = arcDefinition({
    name: 'ops-subgroup',
    signers: opsKeys,
    publisher: opsKeys[0],
    threshold: 2,
    csvBlocks,
    blockHash,
    height,
    parentContract: orgId
  });
  const opsId = contractIdOf(opsDef);

  const treasuryDef = arcDefinition({
    name: 'treasury-subgroup',
    signers: treasuryKeys,
    publisher: treasuryKeys[0],
    threshold: 3,
    csvBlocks,
    blockHash,
    height,
    parentContract: orgId
  });
  const treasuryId = contractIdOf(treasuryDef);

  const missionDef = arcDefinition({
    name: 'mission-leaf',
    signers: missionKeys,
    publisher: missionKeys[0],
    threshold: 2,
    csvBlocks,
    blockHash,
    height,
    parentContract: opsId
  });
  const missionId = contractIdOf(missionDef);

  const frames = [
    { label: 'org', message: signPublish(orgKeys[0], orgDef), contractId: orgId },
    { label: 'ops', message: signPublish(opsKeys[0], opsDef), contractId: opsId },
    { label: 'treasury', message: signPublish(treasuryKeys[0], treasuryDef), contractId: treasuryId },
    { label: 'mission', message: signPublish(missionKeys[0], missionDef), contractId: missionId }
  ];

  return {
    csvBlocks,
    keys: { org: orgKeys, ops: opsKeys, treasury: treasuryKeys, mission: missionKeys },
    defs: { org: orgDef, ops: opsDef, treasury: treasuryDef, mission: missionDef },
    ids: { org: orgId, ops: opsId, treasury: treasuryId, mission: missionId },
    frames
  };
}

function spendOf (definition, tip) {
  return resolveSpend({
    genesis: definition,
    tip: tip || {
      content: {
        signers: definition.members.signers,
        threshold: definition.members.threshold
      },
      bitcoinBlockHash: definition.bitcoinAnchor.blockHash,
      bitcoinHeight: definition.bitcoinAnchor.height,
      stateDigest: '11'.repeat(32),
      clock: 0
    },
    overrides: { network: definition.spendPolicy.network }
  });
}

describe('ARC / Federation network E2E', function () {
  this.timeout(45000);

  describe('establishment — nested Federation trees', function () {
    it('publishes a 4-node tree with distinct P2TR vaults and parentContract links', function () {
      const tree = buildFederationTree();
      const store = createMemoryStore();
      for (const frame of tree.frames) {
        const seeded = foldPublish(store, frame.message);
        assert.strictEqual(seeded.accepted, true, seeded.error);
        assert.strictEqual(seeded.contractId, frame.contractId);
      }

      assert.strictEqual(tree.defs.ops.parentContract, tree.ids.org);
      assert.strictEqual(tree.defs.treasury.parentContract, tree.ids.org);
      assert.strictEqual(tree.defs.mission.parentContract, tree.ids.ops);

      const orgSpend = spendOf(tree.defs.org);
      const opsSpend = spendOf(tree.defs.ops);
      const treasurySpend = spendOf(tree.defs.treasury);
      const missionSpend = spendOf(tree.defs.mission);

      for (const spend of [orgSpend, opsSpend, treasurySpend, missionSpend]) {
        assert.match(spend.address, /^bcrt1p/);
        assert.strictEqual(spend.scheme, 'taproot-authority-ladder-v1');
        assert.ok(spend.leaves.some((l) => l.id === 't0-authority'));
        assert.ok(spend.leaves.some((l) => l.id === 't1-soft'));
      }

      const addrs = [orgSpend.address, opsSpend.address, treasurySpend.address, missionSpend.address];
      assert.strictEqual(new Set(addrs).size, 4, 'each ARC in the tree has its own vault');

      const vault = buildFederationVaultFromPolicy({
        validatorPubkeysHex: tree.defs.org.spendPolicy.validators,
        threshold: 3,
        networkName: 'regtest',
        publisher: tree.defs.org.spendPolicy.publisher,
        csvBlocks: tree.csvBlocks
      });
      assert.strictEqual(orgSpend.address, vault.address);
    });

    it('rejects CONTRACT_PUBLISH from a non-validator (front-run)', function () {
      const attacker = new Key();
      const honest = keysNamed(3);
      const def = arcDefinition({
        name: 'front-run',
        signers: honest,
        threshold: 2,
        csvBlocks: CSV_BLOCKS
      });
      const store = createMemoryStore();
      const hijack = foldPublish(store, signPublish(attacker, def));
      assert.strictEqual(hijack.accepted, false);
      assert.match(String(hijack.error || ''), /not in genesis authorities/i);

      const ok = foldPublish(store, signPublish(honest[0], def));
      assert.strictEqual(ok.accepted, true, ok.error);
    });

    it('gossips the tree across a 3-peer star mesh', async function () {
      const tree = buildFederationTree();
      const expectedCol = createCollection();
      for (const frame of tree.frames) {
        ingest(expectedCol, frame.message.toBuffer(), { origin: 'local' });
      }
      const expected = appHashes(expectedCol);
      const ids = Object.values(tree.ids);
      const network = new NetworkHarness({
        peerCount: 3,
        topology: 'star',
        connectTimeoutMs: 20000
      });
      try {
        await network.start();
        const collectors = network.peers.map(attachCollector);
        const hub = network.peers[0];
        for (const frame of tree.frames) {
          const buf = frame.message.toBuffer();
          hub._handleFabricMessage(buf, { name: 'local-inject' });
        }

        await waitUntil(() => {
          const registered = network.peers.every((peer) =>
            ids.every((id) => peer.contracts && peer.contracts[id])
          );
          if (registered) return true;
          return collectors.every((col) => {
            const got = appHashes(col);
            return got.length === expected.length && got.every((h, i) => h === expected[i]);
          });
        }, 20000);

        for (const peer of network.peers) {
          for (const id of ids) {
            assert.ok(peer.contracts && peer.contracts[id], `peer registered ${id.slice(0, 8)}`);
          }
        }
      } finally {
        await network.stop();
      }
    });

    it('Beacon federation signing round seals a child tip commitment (k-of-n)', function () {
      const tree = buildFederationTree();
      const store = createMemoryStore();
      foldPublish(store, tree.frames[1].message);
      const tip = tipFromDoc(store.get('contractmessages', tree.ids.ops) || { id: tree.ids.ops });
      const epoch = {
        clock: 1,
        blockHash: BLOCK_HASH,
        height: 10,
        contractId: tree.ids.ops,
        stateDigest: tip.stateDigest || '11'.repeat(32)
      };
      const validators = tree.keys.ops.map((k) => k.pubkey);
      const round = createRound(epoch, { validators, threshold: 2 });
      const msg = messageBufferForPayload(epoch);
      assert.strictEqual(roundMeetsThreshold(round), false);
      assert.strictEqual(
        addSignature(round, validators[0], tree.keys.ops[0].signSchnorr(msg).toString('hex')).sealed,
        false
      );
      assert.strictEqual(
        addSignature(round, validators[1], tree.keys.ops[1].signSchnorr(msg).toString('hex')).sealed,
        true
      );
      assert.strictEqual(roundMeetsThreshold(round), true);
    });
  });

  describe('execution — tip fold, program bind, withdrawal witnesses', function () {
    it('folds GroupChange + tip-bound withdrawal request/witnesses at threshold', function () {
      const keys = keysNamed(3);
      const def = arcDefinition({
        name: 'ops-exec',
        signers: keys,
        threshold: 2,
        csvBlocks: CSV_BLOCKS
      });
      const contractId = contractIdOf(def);
      const store = createMemoryStore();
      assert.strictEqual(foldPublish(store, signPublish(keys[0], def)).accepted, true);

      const chat = foldMessage(store, contractId, signContractMessage(keys[0], contractId, 'GroupChat', {
        body: 'execute mission',
        author: compressedPubkey(keys[0])
      }));
      assert.strictEqual(chat.accepted, true, chat.error);

      const change = foldMessage(store, contractId, signContractMessage(keys[0], contractId, 'GroupChange', {
        action: 'signers.set',
        signers: keys.map(compressedPubkey)
      }));
      assert.strictEqual(change.accepted, true, change.error);

      const tip = change.tip;
      assert.ok(tip.stateDigest);
      assert.strictEqual(tip.bitcoinBlockHash, BLOCK_HASH);

      const dest = p2wpkhAddress(compressedPubkey(keys[2]));
      const spend = resolveSpend({ genesis: def, tip, overrides: { network: 'regtest' } });
      const req = buildWithdrawalRequest({
        tip: Object.assign({}, tip, { contractId }),
        genesis: def,
        destinationAddress: dest,
        feeSats: 1000,
        vaultAddress: spend.address,
        tierId: 't0-authority'
      });
      const reqFold = foldMessage(store, contractId, signContractMessage(
        keys[0], contractId, 'ContractWithdrawalRequest', req
      ));
      assert.strictEqual(reqFold.accepted, true, reqFold.error);

      const wit1 = buildWithdrawalWitness({
        request: req,
        signer: pubkeyXOnly(keys[0].pubkey),
        signerKey: keys[0]
      });
      const fold1 = foldMessage(store, contractId, signContractMessage(
        keys[0], contractId, 'ContractWithdrawalWitness', wit1
      ));
      assert.strictEqual(fold1.accepted, true, fold1.error);
      let row = fold1.tip.content.withdrawals.find((w) => w.requestId === req.requestId);
      assert.strictEqual(row.witnesses.length, 1);

      const wit2 = buildWithdrawalWitness({
        request: req,
        signer: pubkeyXOnly(keys[1].pubkey),
        signerKey: keys[1]
      });
      const fold2 = foldMessage(store, contractId, signContractMessage(
        keys[1], contractId, 'ContractWithdrawalWitness', wit2
      ));
      assert.strictEqual(fold2.accepted, true, fold2.error);
      row = fold2.tip.content.withdrawals.find((w) => w.requestId === req.requestId);
      assert.strictEqual(row.witnesses.length, 2);
    });

    it('rejects a withdrawal bound to a stale tip and a diverted requestId', function () {
      const keys = keysNamed(2);
      const def = arcDefinition({
        name: 'stale-withdraw',
        signers: keys,
        threshold: 1,
        csvBlocks: CSV_BLOCKS
      });
      const contractId = contractIdOf(def);
      const store = createMemoryStore();
      foldPublish(store, signPublish(keys[0], def));
      const first = foldMessage(store, contractId, signContractMessage(keys[0], contractId, 'GroupChat', {
        body: 'one',
        author: compressedPubkey(keys[0])
      }));
      const dest = p2wpkhAddress(compressedPubkey(keys[1]));
      const staleReq = buildWithdrawalRequest({
        tip: Object.assign({}, first.tip, { contractId }),
        genesis: def,
        destinationAddress: dest,
        feeSats: 500
      });
      foldMessage(store, contractId, signContractMessage(keys[0], contractId, 'GroupChat', {
        body: 'two',
        author: compressedPubkey(keys[0])
      }));
      const stale = foldMessage(store, contractId, signContractMessage(
        keys[0], contractId, 'ContractWithdrawalRequest', staleReq
      ));
      assert.strictEqual(stale.accepted, false);
      assert.match(String(stale.error || ''), /stale|stateDigest/i);

      const liveTip = stale.tip;
      const good = buildWithdrawalRequest({
        tip: Object.assign({}, liveTip, { contractId }),
        genesis: def,
        destinationAddress: dest,
        feeSats: 500
      });
      const diverted = Object.assign({}, good, {
        destinationAddress: p2wpkhAddress(compressedPubkey(keys[0])),
        requestId: good.requestId
      });
      assert.strictEqual(validateWithdrawalRequest(diverted, liveTip, { genesis: def }).ok, false);
    });

    it('program-bound withdrawal requires matching Machine run digests', async function () {
      const keys = keysNamed(1);
      const def = arcDefinition({
        name: 'program-arc',
        signers: keys,
        threshold: 1,
        csvBlocks: CSV_BLOCKS,
        interfaces: ['arc.core', 'fabric.program'],
        opcodes: ['OP_TRUE'],
        requireProgramRun: true
      });
      const prog = Program.from({ language: 'fabric-opcodes', steps: ['OP_TRUE'] });
      prog.compile();
      const machine = new Machine({ deterministic: true });
      machine.define('OP_TRUE', () => true);
      const run = await machine.runProgram(prog);
      assert.strictEqual(run.ok, true);
      const match = assertMachineRunMatches({ program: prog, run });
      assert.strictEqual(match.ok, true, match.error);

      const tip0 = {
        contractId: contractIdOf(def),
        clock: 1,
        stateDigest: '11'.repeat(32),
        bitcoinBlockHash: BLOCK_HASH,
        content: { signers: [compressedPubkey(keys[0])], threshold: 1 }
      };
      const tip1 = bindProgramRunToTip(tip0, {
        programHash: match.programHash,
        runCommitmentHex: match.runCommitmentHex
      });
      const dest = p2wpkhAddress(compressedPubkey(keys[0]));
      const ok = buildWithdrawalRequest({
        tip: tip1,
        genesis: def,
        destinationAddress: dest,
        feeSats: 800
      });
      assert.strictEqual(ok.runCommitmentHex, match.runCommitmentHex);

      assert.throws(() => buildWithdrawalRequest({
        tip: tip1,
        genesis: def,
        destinationAddress: dest,
        feeSats: 800,
        runCommitmentHex: 'ff'.repeat(32)
      }), /runCommitment|program/i);
    });
  });

  describe('withdrawal — synthetic L1 conditions (no bitcoind)', function () {
    it('signs and extracts a 2-of-3 t0-authority spend', function () {
      const keys = keysNamed(3);
      const def = arcDefinition({
        name: 'k-of-n',
        signers: keys,
        threshold: 2,
        csvBlocks: CSV_BLOCKS
      });
      const spend = spendOf(def);
      const dest = p2wpkhAddress(compressedPubkey(keys[2]));
      const tip = {
        contractId: contractIdOf(def),
        clock: 1,
        stateDigest: '22'.repeat(32),
        bitcoinBlockHash: BLOCK_HASH,
        bitcoinHeight: 1,
        content: { signers: keys.map(compressedPubkey), threshold: 2 }
      };
      const req = buildWithdrawalRequest({
        tip,
        genesis: def,
        destinationAddress: dest,
        feeSats: 1000,
        vaultAddress: spend.address,
        tierId: 't0-authority'
      });
      const prepared = prepareWithdrawalFromRequest({
        request: req,
        tip,
        genesis: def,
        spend,
        fundedTxHex: syntheticFundedTxHex(buildContractTaproot(spend.policy).output, 100000),
        ctx: { utxoAgeBlocks: 0 }
      });
      assert.ok(prepared.psbtBase64);
      const fin = signSpendPsbt(prepared.psbtBase64, [keys[0], keys[1]]);
      assert.ok(fin.txHex);
      assert.strictEqual(fin.witnessCount, 5);
      const tx = bitcoin.Transaction.fromHex(fin.txHex);
      assert.strictEqual(tx.ins.length, 1);
      assert.strictEqual(tx.outs.length, 1);
    });

    it('CSV t1-soft is inactive until utxoAgeBlocks, then publisher can spend', function () {
      const keys = keysNamed(3);
      const policy = synthesizeDefaultLadder({
        validators: keys.map(compressedPubkey),
        threshold: 2,
        publisher: compressedPubkey(keys[0]),
        network: 'regtest',
        csvBlocks: CSV_BLOCKS
      });
      const built = buildContractTaproot(policy);
      const dest = p2wpkhAddress(compressedPubkey(keys[2]));
      const fundedTxHex = syntheticFundedTxHex(built.output, 100000);

      assert.strictEqual(selectActiveTiers(policy, { utxoAgeBlocks: 0 }).some((t) => t.id === 't1-soft'), false);
      assert.throws(() => prepareTierWithdrawalPsbt({
        policy,
        fundedTxHex,
        vaultAddress: built.address,
        destinationAddress: dest,
        feeSats: 1000,
        tierId: 't1-soft',
        ctx: { utxoAgeBlocks: 0 }
      }), /not active|t1-soft/i);

      assert.ok(selectActiveTiers(policy, { utxoAgeBlocks: CSV_BLOCKS }).some((t) => t.id === 't1-soft'));
      const prepared = prepareTierWithdrawalPsbt({
        policy,
        fundedTxHex,
        vaultAddress: built.address,
        destinationAddress: dest,
        feeSats: 1000,
        tierId: 't1-soft',
        ctx: { utxoAgeBlocks: CSV_BLOCKS }
      });
      const fin = signSpendPsbt(prepared.psbtBase64, [keys[0]]);
      assert.ok(fin.txHex);
      const tx = bitcoin.Transaction.fromHex(fin.txHex);
      assert.ok(tx.ins[0].sequence >= CSV_BLOCKS);
    });

    it('rejects a fee that would leave a dust output', function () {
      const keys = keysNamed(1);
      const def = arcDefinition({
        name: 'dust',
        signers: keys,
        threshold: 1,
        csvBlocks: CSV_BLOCKS
      });
      const spend = spendOf(def);
      const dest = p2wpkhAddress(compressedPubkey(keys[0]));
      const tip = {
        contractId: contractIdOf(def),
        clock: 0,
        stateDigest: '33'.repeat(32),
        bitcoinBlockHash: BLOCK_HASH,
        content: { signers: [compressedPubkey(keys[0])], threshold: 1 }
      };
      const req = buildWithdrawalRequest({
        tip,
        genesis: def,
        destinationAddress: dest,
        feeSats: 99999,
        vaultAddress: spend.address
      });
      assert.throws(() => prepareWithdrawalFromRequest({
        request: req,
        tip,
        genesis: def,
        spend,
        fundedTxHex: syntheticFundedTxHex(buildContractTaproot(spend.policy).output, 100000)
      }), /dust/i);
    });

    it('NUMS vs MuSig2 internal keys are distinct script-path-spendable addresses', function () {
      const keys = keysNamed(2);
      const vals = keys.map(compressedPubkey);
      const nums = toAddress(synthesizeDefaultLadder({
        validators: vals,
        threshold: 2,
        publisher: vals[0],
        network: 'regtest',
        csvBlocks: CSV_BLOCKS,
        internalKeyMode: 'nums'
      }));
      const musig = toAddress(synthesizeDefaultLadder({
        validators: vals,
        threshold: 2,
        publisher: vals[0],
        network: 'regtest',
        csvBlocks: CSV_BLOCKS,
        internalKeyMode: 'musig2'
      }));
      assert.notStrictEqual(nums, musig);

      for (const mode of ['nums', 'musig2']) {
        const def = arcDefinition({
          name: `mode-${mode}`,
          signers: keys,
          threshold: 2,
          csvBlocks: CSV_BLOCKS,
          internalKeyMode: mode
        });
        const spend = spendOf(def);
        const dest = p2wpkhAddress(compressedPubkey(keys[1]));
        const tip = {
          contractId: contractIdOf(def),
          clock: 0,
          stateDigest: '44'.repeat(32),
          bitcoinBlockHash: BLOCK_HASH,
          content: { signers: vals, threshold: 2 }
        };
        const req = buildWithdrawalRequest({
          tip,
          genesis: def,
          destinationAddress: dest,
          feeSats: 1000,
          vaultAddress: spend.address
        });
        const prepared = prepareWithdrawalFromRequest({
          request: req,
          tip,
          genesis: def,
          spend,
          fundedTxHex: syntheticFundedTxHex(buildContractTaproot(spend.policy).output, 80000)
        });
        const fin = signSpendPsbt(prepared.psbtBase64, keys);
        assert.ok(fin.txHex, mode);
      }
    });

    it('hashlock leaf on a composed federation tree spends without validator sigs', function () {
      const keys = keysNamed(3);
      const preimage = crypto.randomBytes(32);
      const commitmentHex = crypto.createHash('sha256').update(preimage).digest('hex');
      const policy = synthesizeDefaultLadder({
        validators: keys.map(compressedPubkey),
        threshold: 2,
        publisher: compressedPubkey(keys[0]),
        network: 'regtest',
        csvBlocks: CSV_BLOCKS,
        hashlock: { commitmentHex, id: 'hashlock-run' }
      });
      const built = buildContractTaproot(policy);
      assert.ok(built.leaves.some((l) => l.kind === 'hashlock'));
      const dest = p2wpkhAddress(compressedPubkey(keys[2]));
      const prepared = prepareHashlockWithdrawalPsbt({
        policy,
        fundedTxHex: syntheticFundedTxHex(built.output, 100000),
        vaultAddress: built.address,
        destinationAddress: dest,
        feeSats: 1000,
        preimage32: preimage
      });
      const fin = finalizeHashlockPsbt({
        psbtBase64: prepared.psbtBase64,
        preimage32: preimage,
        witnessShape: 'preimage'
      });
      assert.strictEqual(bitcoin.Transaction.fromHex(fin.txHex).ins[0].witness.length, 3);
    });

    it('resolveSpend fails closed without an explicit network', function () {
      const keys = keysNamed(1);
      assert.throws(() => resolveSpend({
        genesis: {
          members: { signers: [compressedPubkey(keys[0])], threshold: 1 },
          spendPolicy: {
            validators: [compressedPubkey(keys[0])],
            threshold: 1,
            publisher: compressedPubkey(keys[0]),
            csvBlocks: CSV_BLOCKS
          }
        },
        tip: { content: { signers: [compressedPubkey(keys[0])] } }
      }), /network/i);
    });
  });
});

describe('ARC / Federation L1 regtest withdrawals', function () {
  if (!e2eRegtestEnabled()) {
    console.log('[SKIP] Set FABRIC_E2E_REGTEST=1 to run ARC Federation L1 withdrawal tests');
    return;
  }

  this.timeout(180000);

  let bitcoinSvc;
  let miner;

  async function rpc (method, params = []) {
    return bitcoinSvc._makeRPCRequest(method, params);
  }

  async function fundAddress (address, btc = 0.01) {
    const txid = await rpc('sendtoaddress', [address, btc]);
    return txid;
  }

  async function confirm (n = 1) {
    await rpc('generatetoaddress', [n, miner]);
  }

  async function rawTx (txid) {
    return rpc('getrawtransaction', [txid]);
  }

  async function bestBlock () {
    const hash = await rpc('getbestblockhash', []);
    const header = await rpc('getblockheader', [hash]);
    return { hash, height: header.height };
  }

  before(async function () {
    this.timeout(180000);
    const defaults = await isolatedManagedRegtestSettings();
    bitcoinSvc = new Bitcoin(defaults);
    bitcoinSvc.on('error', (msg) => {
      console.warn(String(msg));
    });
    await bitcoinSvc.start();
    await bitcoinSvc._loadWallet('arc-fed-e2e');
    miner = await rpc('getnewaddress', []);
    await rpc('generatetoaddress', [101, miner]);
  });

  after(async function () {
    if (bitcoinSvc) {
      try { await bitcoinSvc.stop(); } catch (e) {
        console.warn('ARC L1 cleanup:', e && e.message);
      }
    }
  });

  it('funds an org vault and folds the L1 payment into the ARC tip', async function () {
    const tree = buildFederationTree({ csvBlocks: CSV_BLOCKS });
    const spend = spendOf(tree.defs.org);
    const txid = await fundAddress(spend.address, 0.01);
    await confirm(1);
    const hex = await rawTx(txid);
    const obs = observePaymentToAddress({
      tx: hex,
      address: spend.address,
      network: 'regtest',
      amountSats: 1000000
    });
    assert.strictEqual(obs.ok, true, obs.error);
    assert.ok(obs.matchedSats >= 1000000);

    const tip0 = {
      contractId: tree.ids.org,
      clock: 0,
      content: {},
      bitcoinBlockHash: BLOCK_HASH
    };
    const tip1 = applyPaymentObservationToTip(tip0, obs);
    assert.strictEqual(tip1.content.balances[spend.address].sats, obs.matchedSats);
  });

  it('broadcasts a 2-of-3 t0-authority withdrawal and pays a wallet address', async function () {
    const keys = keysNamed(3);
    const tipInfo = await bestBlock();
    const def = arcDefinition({
      name: 'l1-t0',
      signers: keys,
      threshold: 2,
      csvBlocks: CSV_BLOCKS,
      blockHash: tipInfo.hash,
      height: tipInfo.height
    });
    const spend = spendOf(def);
    const fundTxid = await fundAddress(spend.address, 0.01);
    await confirm(1);
    const fundedHex = await rawTx(fundTxid);
    const dest = await rpc('getnewaddress', []);
    const tip = {
      contractId: contractIdOf(def),
      clock: 1,
      stateDigest: 'aa'.repeat(32),
      bitcoinBlockHash: (await bestBlock()).hash,
      bitcoinHeight: (await bestBlock()).height,
      content: { signers: keys.map(compressedPubkey), threshold: 2 }
    };
    const req = buildWithdrawalRequest({
      tip,
      genesis: def,
      destinationAddress: dest,
      feeSats: 1000,
      vaultAddress: spend.address,
      tierId: 't0-authority'
    });
    const prepared = prepareWithdrawalFromRequest({
      request: req,
      tip,
      genesis: def,
      spend,
      fundedTxHex: fundedHex,
      ctx: { utxoAgeBlocks: 1, tipHeight: tip.bitcoinHeight }
    });
    const fin = signSpendPsbt(prepared.psbtBase64, [keys[0], keys[1]]);
    const spendTxid = await rpc('sendrawtransaction', [fin.txHex]);
    assert.ok(spendTxid);
    await confirm(1);
    const received = await rpc('getreceivedbyaddress', [dest]);
    assert.ok(received > 0.009, `expected withdrawal on L1, got ${received}`);

    const decoded = bitcoin.Transaction.fromHex(fundedHex);
    const vout = decoded.outs.findIndex((o) => {
      const addr = bitcoin.address.fromOutputScript(Buffer.from(o.script), bitcoin.networks.regtest);
      return addr === spend.address;
    });
    const leftover = await rpc('gettxout', [fundTxid, vout]);
    assert.strictEqual(leftover, null);
  });

  it('spends an unconfirmed (0-conf) vault funding from the mempool', async function () {
    const keys = keysNamed(1);
    const def = arcDefinition({
      name: 'l1-0conf',
      signers: keys,
      threshold: 1,
      csvBlocks: CSV_BLOCKS,
      blockHash: (await bestBlock()).hash,
      height: (await bestBlock()).height
    });
    const spend = spendOf(def);
    const fundTxid = await fundAddress(spend.address, 0.01);
    const fundedHex = await rawTx(fundTxid);
    const dest = await rpc('getnewaddress', []);
    const tip = {
      contractId: contractIdOf(def),
      clock: 0,
      stateDigest: 'bb'.repeat(32),
      bitcoinBlockHash: (await bestBlock()).hash,
      bitcoinHeight: (await bestBlock()).height,
      content: { signers: [compressedPubkey(keys[0])], threshold: 1 }
    };
    const req = buildWithdrawalRequest({
      tip,
      genesis: def,
      destinationAddress: dest,
      feeSats: 1000,
      vaultAddress: spend.address
    });
    const prepared = prepareWithdrawalFromRequest({
      request: req,
      tip,
      genesis: def,
      spend,
      fundedTxHex: fundedHex
    });
    const fin = signSpendPsbt(prepared.psbtBase64, [keys[0]]);
    const spendTxid = await rpc('sendrawtransaction', [fin.txHex]);
    assert.ok(spendTxid);
    await confirm(1);
    const received = await rpc('getreceivedbyaddress', [dest]);
    assert.ok(received > 0);
  });

  it('bitcoind rejects a CSV-immature t1-soft spend (non-BIP68-final)', async function () {
    const keys = keysNamed(2);
    const def = arcDefinition({
      name: 'l1-csv-immature',
      signers: keys,
      threshold: 2,
      csvBlocks: CSV_BLOCKS,
      blockHash: (await bestBlock()).hash,
      height: (await bestBlock()).height
    });
    const spend = spendOf(def);
    const fundTxid = await fundAddress(spend.address, 0.01);
    await confirm(1);
    const fundedHex = await rawTx(fundTxid);
    const dest = await rpc('getnewaddress', []);

    assert.throws(() => prepareTierWithdrawalPsbt({
      policy: spend.policy,
      fundedTxHex: fundedHex,
      vaultAddress: spend.address,
      destinationAddress: dest,
      feeSats: 1000,
      tierId: 't1-soft',
      ctx: { utxoAgeBlocks: 0 }
    }), /not active/i);

    const prepared = prepareTierWithdrawalPsbt({
      policy: spend.policy,
      fundedTxHex: fundedHex,
      vaultAddress: spend.address,
      destinationAddress: dest,
      feeSats: 1000,
      tierId: 't1-soft',
      ctx: { utxoAgeBlocks: CSV_BLOCKS }
    });
    const fin = signSpendPsbt(prepared.psbtBase64, [keys[0]]);
    let rejected = false;
    try {
      await rpc('sendrawtransaction', [fin.txHex]);
    } catch (err) {
      rejected = true;
      assert.match(String(err.message || err), /BIP68|non-BIP68|locktime|final/i);
    }
    assert.ok(rejected, 'immature CSV spend must fail on L1');
  });

  it('after CSV maturity the publisher t1-soft path withdraws on L1', async function () {
    const keys = keysNamed(2);
    const def = arcDefinition({
      name: 'l1-csv-mature',
      signers: keys,
      threshold: 2,
      csvBlocks: CSV_BLOCKS,
      blockHash: (await bestBlock()).hash,
      height: (await bestBlock()).height
    });
    const spend = spendOf(def);
    const fundTxid = await fundAddress(spend.address, 0.01);
    await confirm(1);
    await confirm(CSV_BLOCKS);
    const fundedHex = await rawTx(fundTxid);
    const dest = await rpc('getnewaddress', []);
    const prepared = prepareTierWithdrawalPsbt({
      policy: spend.policy,
      fundedTxHex: fundedHex,
      vaultAddress: spend.address,
      destinationAddress: dest,
      feeSats: 1000,
      tierId: 't1-soft',
      ctx: { utxoAgeBlocks: CSV_BLOCKS, tipHeight: (await bestBlock()).height }
    });
    const fin = signSpendPsbt(prepared.psbtBase64, [keys[0]]);
    const spendTxid = await rpc('sendrawtransaction', [fin.txHex]);
    assert.ok(spendTxid);
    await confirm(1);
    const received = await rpc('getreceivedbyaddress', [dest]);
    assert.ok(received > 0);
  });

  it('double-spend of the same vault outpoint is rejected by the mempool', async function () {
    const keys = keysNamed(1);
    const def = arcDefinition({
      name: 'l1-ds',
      signers: keys,
      threshold: 1,
      csvBlocks: CSV_BLOCKS,
      blockHash: (await bestBlock()).hash,
      height: (await bestBlock()).height
    });
    const spend = spendOf(def);
    const fundTxid = await fundAddress(spend.address, 0.01);
    await confirm(1);
    const fundedHex = await rawTx(fundTxid);
    const destA = await rpc('getnewaddress', []);
    const destB = await rpc('getnewaddress', []);
    const tipBase = {
      contractId: contractIdOf(def),
      clock: 0,
      stateDigest: 'cc'.repeat(32),
      bitcoinBlockHash: (await bestBlock()).hash,
      bitcoinHeight: (await bestBlock()).height,
      content: { signers: [compressedPubkey(keys[0])], threshold: 1 }
    };
    const prep = (dest) => {
      const req = buildWithdrawalRequest({
        tip: tipBase,
        genesis: def,
        destinationAddress: dest,
        feeSats: 1000,
        vaultAddress: spend.address
      });
      return prepareWithdrawalFromRequest({
        request: req,
        tip: tipBase,
        genesis: def,
        spend,
        fundedTxHex: fundedHex
      });
    };
    const a = signSpendPsbt(prep(destA).psbtBase64, [keys[0]]);
    const b = signSpendPsbt(prep(destB).psbtBase64, [keys[0]]);
    await rpc('sendrawtransaction', [a.txHex]);
    let rejected = false;
    try {
      await rpc('sendrawtransaction', [b.txHex]);
    } catch (err) {
      rejected = true;
      assert.match(String(err.message || err), /already|conflict|missing|inputs-missing|txn-mempool-conflict|insufficient fee|rejecting replacement/i);
    }
    assert.ok(rejected, 'second spend of the same vault coin must fail');
    await confirm(1);
  });

  it('nested child vault withdraws without spending the parent org UTXO', async function () {
    const tree = buildFederationTree({
      csvBlocks: CSV_BLOCKS,
      blockHash: (await bestBlock()).hash,
      height: (await bestBlock()).height
    });
    const parentSpend = spendOf(tree.defs.org);
    const childSpend = spendOf(tree.defs.mission);
    assert.notStrictEqual(parentSpend.address, childSpend.address);

    const parentFund = await fundAddress(parentSpend.address, 0.02);
    const childFund = await fundAddress(childSpend.address, 0.01);
    await confirm(1);
    const parentHex = await rawTx(parentFund);
    const childHex = await rawTx(childFund);

    const dest = await rpc('getnewaddress', []);
    const tip = {
      contractId: tree.ids.mission,
      clock: 0,
      stateDigest: 'dd'.repeat(32),
      bitcoinBlockHash: (await bestBlock()).hash,
      bitcoinHeight: (await bestBlock()).height,
      content: {
        signers: tree.keys.mission.map(compressedPubkey),
        threshold: 2
      }
    };
    const req = buildWithdrawalRequest({
      tip,
      genesis: tree.defs.mission,
      destinationAddress: dest,
      feeSats: 1000,
      vaultAddress: childSpend.address
    });
    const prepared = prepareWithdrawalFromRequest({
      request: req,
      tip,
      genesis: tree.defs.mission,
      spend: childSpend,
      fundedTxHex: childHex
    });
    const fin = signSpendPsbt(prepared.psbtBase64, tree.keys.mission);
    await rpc('sendrawtransaction', [fin.txHex]);
    await confirm(1);

    const parentTx = bitcoin.Transaction.fromHex(parentHex);
    const parentVout = parentTx.outs.findIndex((o) => {
      const addr = bitcoin.address.fromOutputScript(Buffer.from(o.script), bitcoin.networks.regtest);
      return addr === parentSpend.address;
    });
    assert.ok(parentVout >= 0, 'parent funding vout');
    const parentUtxo = await rpc('gettxout', [parentFund, parentVout]);
    assert.ok(parentUtxo, 'parent org vault must remain funded');
    const parentValue = parentUtxo.value != null ? parentUtxo.value : parentUtxo.amount;
    assert.ok(parentValue > 0, `parent vault value, got ${JSON.stringify(parentUtxo)}`);
  });

  it('hashlock leaf on a funded composed tree redeems on L1', async function () {
    const keys = keysNamed(2);
    const preimage = crypto.randomBytes(32);
    const commitmentHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const policy = synthesizeDefaultLadder({
      validators: keys.map(compressedPubkey),
      threshold: 2,
      publisher: compressedPubkey(keys[0]),
      network: 'regtest',
      csvBlocks: CSV_BLOCKS,
      hashlock: { commitmentHex, id: 'hashlock-l1' }
    });
    const built = buildContractTaproot(policy);
    const fundTxid = await fundAddress(built.address, 0.01);
    await confirm(1);
    const fundedHex = await rawTx(fundTxid);
    const dest = await rpc('getnewaddress', []);
    const prepared = prepareHashlockWithdrawalPsbt({
      policy,
      fundedTxHex: fundedHex,
      vaultAddress: built.address,
      destinationAddress: dest,
      feeSats: 1000,
      preimage32: preimage
    });
    const fin = finalizeHashlockPsbt({
      psbtBase64: prepared.psbtBase64,
      preimage32: preimage,
      witnessShape: 'preimage'
    });
    const spendTxid = await rpc('sendrawtransaction', [fin.txHex]);
    assert.ok(spendTxid);
    await confirm(1);
    const received = await rpc('getreceivedbyaddress', [dest]);
    assert.ok(received > 0);
  });

  it('reorg of the funding confirmation drops the vault UTXO', async function () {
    const keys = keysNamed(1);
    const def = arcDefinition({
      name: 'l1-reorg',
      signers: keys,
      threshold: 1,
      csvBlocks: CSV_BLOCKS,
      blockHash: (await bestBlock()).hash,
      height: (await bestBlock()).height
    });
    const spend = spendOf(def);
    const fundTxid = await fundAddress(spend.address, 0.01);
    const fundBlock = (await rpc('generatetoaddress', [1, miner]))[0];
    const fundedHex = await rawTx(fundTxid);
    const obs = observePaymentToAddress({
      tx: fundedHex,
      address: spend.address,
      network: 'regtest'
    });
    assert.strictEqual(obs.ok, true);

    const decoded = bitcoin.Transaction.fromHex(fundedHex);
    const vout = decoded.outs.findIndex((o) => {
      const addr = bitcoin.address.fromOutputScript(Buffer.from(o.script), bitcoin.networks.regtest);
      return addr === spend.address;
    });
    assert.ok(await rpc('gettxout', [fundTxid, vout]));

    await rpc('invalidateblock', [fundBlock]);
    const after = await rpc('gettxout', [fundTxid, vout]);
    assert.ok(after == null || after.confirmations === 0);
  });
});
