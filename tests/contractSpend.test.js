'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const Contract = require('../types/contract');
const {
  normalizeArcGenesis,
  resolveSpend,
  buildWithdrawalRequest,
  buildWithdrawalWitness,
  validateWithdrawalRequest,
  prepareWithdrawalFromRequest
} = require('../functions/contractSpend');
const {
  createMemoryStore,
  ingestMessageBuffer,
  tipFromDoc,
  loadDoc
} = require('../functions/contractMessageAccumulate');

describe('contractSpend / ARC resolveSpend', function () {
  it('normalizeArcGenesis maps proposedPolicy + messageTypes', function () {
    const a = new Key();
    const arc = normalizeArcGenesis({
      name: 'GoonCitizenGroup',
      messageTypes: ['GroupChat', 'GroupChange'],
      proposedPolicy: { validators: [a.pubkey], threshold: 1 },
      creator: a.pubkey,
      parentContractId: 'parent'.padEnd(64, '0'),
      softMode: 'reduced',
      depositMaturityBlocks: 144
    });
    assert.strictEqual(arc.name, 'GoonCitizenGroup');
    assert.deepStrictEqual(arc.primitives.messageTypes, ['GroupChat', 'GroupChange']);
    assert.strictEqual(arc.members.signers.length, 1);
    assert.strictEqual(arc.spendPolicy.validators.length, 1);
    assert.strictEqual(arc.spendPolicy.threshold, 1);
    assert.strictEqual(arc.spendPolicy.softMode, 'reduced');
    assert.strictEqual(arc.spendPolicy.csvBlocks, 144);
    assert.ok(!Object.prototype.hasOwnProperty.call(arc.spendPolicy, 'depositMaturityBlocks'));
    assert.strictEqual(arc.extension.parentContract, 'parent'.padEnd(64, '0'));
    assert.strictEqual(arc.extension.parentContractId, arc.extension.parentContract);
  });

  it('resolveSpend prefers tip.content.signers over members roster', function () {
    const a = new Key();
    const b = new Key();
    const {
      tipSpendKeys
    } = require('../functions/contractSpend');
    const tip = {
      content: {
        signers: [a.pubkey],
        members: [a.pubkey.slice(2), b.pubkey.slice(2)],
        threshold: 1
      }
    };
    assert.deepStrictEqual(tipSpendKeys(tip), [a.pubkey]);
    const spend = resolveSpend({
      genesis: {
        members: { signers: [a.pubkey], threshold: 1 },
        spendPolicy: {
          validators: [a.pubkey],
          threshold: 1,
          publisher: a.pubkey,
          csvBlocks: 144,
          softMode: 'publisher'
        }
      },
      tip,
      overrides: { network: 'regtest' }
    });
    assert.strictEqual(spend.validators.length, 1);
    assert.ok(spend.bitcoinAnchor === null || spend.bitcoinAnchor);
    assert.strictEqual(spend.softMode, 'publisher');
    assert.strictEqual(spend.spendAddress, spend.address);
    assert.strictEqual(spend.depositMaturityBlocks, spend.csvBlocks);
    assert.ok(spend.spendPolicy);
    assert.strictEqual(spend.spendPolicy.softMode, 'publisher');
  });

  it('resolveSpend is stable for tip members', function () {
    const a = new Key();
    const b = new Key();
    const genesis = {
      spendPolicy: { network: 'regtest', validators: [a.pubkey], threshold: 1, csvBlocks: 144 },
      members: { signers: [a.pubkey], threshold: 1 },
      bitcoinAnchor: { blockHash: 'ab'.repeat(32), height: 10 }
    };
    const tip = {
      contractId: 'c'.repeat(64),
      clock: 2,
      stateDigest: 'cd'.repeat(32),
      bitcoinBlockHash: 'ab'.repeat(32),
      bitcoinHeight: 10,
      content: { members: [a.pubkey.slice(2), b.pubkey.slice(2)], threshold: 2 }
    };
    const spend = resolveSpend({ genesis, tip });
    assert.ok(spend.address);
    assert.match(spend.address, /^bcrt1p/);
    assert.strictEqual(spend.threshold, 2);
    assert.strictEqual(spend.validators.length, 2);
    assert.strictEqual(spend.bitcoinBlockHash, 'ab'.repeat(32));

    const again = resolveSpend({ genesis, tip });
    assert.strictEqual(again.address, spend.address);
  });

  it('resolveSpend address matches federation vault ladder', function () {
    const a = new Key();
    const b = new Key();
    const vals = [a.pubkey, b.pubkey];
    const {
      buildFederationVaultFromPolicy
    } = require('../functions/contractTaproot');
    const vault = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      publisher: a.pubkey,
      csvBlocks: 144
    });
    const spend = resolveSpend({
      genesis: {
        members: { signers: vals, threshold: 2 },
        spendPolicy: {
          validators: vals,
          threshold: 2,
          publisher: a.pubkey,
          csvBlocks: 144,
          network: 'regtest'
        }
      },
      tip: { content: { members: vals.map((p) => p.slice(2)) } },
      overrides: { network: 'regtest' }
    });
    assert.strictEqual(spend.address, vault.address);
    assert.strictEqual(spend.scheme, 'taproot-authority-ladder-v1');
    assert.strictEqual(spend.csvBlocks, 144);
    assert.ok(spend.softTier);
  });

  it('resolveSpend fails closed without explicit network', function () {
    const a = new Key();
    const genesis = {
      members: { signers: [a.pubkey], threshold: 1 },
      spendPolicy: { validators: [a.pubkey], threshold: 1 }
    };
    assert.throws(() => resolveSpend({
      genesis,
      tip: { content: { members: [a.pubkey.slice(2)] } }
    }), /network required/i);
    const spend = resolveSpend({
      genesis,
      tip: { content: { members: [a.pubkey.slice(2)] } },
      overrides: { network: 'signet' }
    });
    assert.match(spend.address, /^tb1p/);
  });

  it('normalizeArcGenesis does not default spendPolicy.network to regtest', function () {
    const a = new Key();
    const arc = normalizeArcGenesis({
      proposedPolicy: { validators: [a.pubkey], threshold: 1 }
    });
    assert.strictEqual(arc.spendPolicy.network, undefined);
  });

  it('Contract#resolveSpend uses settings as genesis', function () {
    const k = new Key();
    const c = new Contract({
      validators: [k.pubkey],
      threshold: 1,
      network: 'regtest',
      csvBlocks: 144,
      bitcoinAnchor: { blockHash: '11'.repeat(32), height: 1 }
    });
    const spend = c.resolveSpend({
      tip: {
        content: { members: [k.pubkey.slice(2)] },
        stateDigest: '22'.repeat(32),
        bitcoinBlockHash: '11'.repeat(32)
      },
      overrides: { network: 'regtest' }
    });
    assert.ok(spend.address);
    assert.strictEqual(spend.address, c.toAddress('regtest'));
  });

  it('withdrawal request binds tip digest + block hash', function () {
    const tip = {
      contractId: 'c'.repeat(64),
      clock: 1,
      stateDigest: 'aa'.repeat(32),
      bitcoinBlockHash: 'bb'.repeat(32),
      bitcoinHeight: 42,
      content: { members: [] }
    };
    const req = buildWithdrawalRequest({
      tip,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 500
    });
    assert.strictEqual(req.type, 'ContractWithdrawalRequest');
    assert.ok(req.requestId);
    assert.strictEqual(req.stateDigest, tip.stateDigest);
    assert.strictEqual(req.bitcoinBlockHash, tip.bitcoinBlockHash);
    assert.strictEqual(validateWithdrawalRequest(req, tip).ok, true);
    assert.strictEqual(validateWithdrawalRequest(req, Object.assign({}, tip, {
      stateDigest: 'cc'.repeat(32)
    })).ok, false);

    const wit = buildWithdrawalWitness({
      request: req,
      signer: '02' + 'ab'.repeat(32),
      signature: 'cd'.repeat(32)
    });
    assert.strictEqual(wit.requestId, req.requestId);
    assert.strictEqual(wit.bitcoinBlockHash, tip.bitcoinBlockHash);
  });

  it('ingest rejects withdrawal with stale tip binding', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const contractId = 'e'.repeat(64);
    const blockHash = 'ff'.repeat(32);
    const genesis = {
      signers: [owner.pubkey],
      bitcoinAnchor: { blockHash, height: 7 },
      primitives: {
        messageTypes: ['GroupChange', 'ContractWithdrawalRequest', 'GroupChat']
      }
    };
    const setMembers = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChange',
      object: { action: 'members.set', members: [owner.pubkey] }
    })]).signWithKey(owner);
    const okSet = ingestMessageBuffer(store, contractId, setMembers.toBuffer(), {
      origin: 'local',
      genesis,
      bitcoinBlockHash: blockHash,
      bitcoinHeight: 7
    });
    assert.strictEqual(okSet.accepted, true);

    const tip = tipFromDoc(loadDoc(store, contractId));
    const stale = buildWithdrawalRequest({
      tip: Object.assign({}, tip, { stateDigest: '00'.repeat(32) }),
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 250
    });
    // Force stale digest onto a signed message
    const bad = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'ContractWithdrawalRequest',
      object: stale
    })]).signWithKey(owner);
    const rejected = ingestMessageBuffer(store, contractId, bad.toBuffer(), {
      origin: 'mesh',
      genesis,
      bitcoinBlockHash: blockHash
    });
    assert.strictEqual(rejected.accepted, false);
    assert.match(rejected.error, /stateDigest|stale/i);

    const goodReq = buildWithdrawalRequest({
      tip,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 250
    });
    const good = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'ContractWithdrawalRequest',
      object: goodReq
    })]).signWithKey(owner);
    const accepted = ingestMessageBuffer(store, contractId, good.toBuffer(), {
      origin: 'mesh',
      genesis,
      bitcoinBlockHash: blockHash
    });
    assert.strictEqual(accepted.accepted, true);
    assert.ok(accepted.tip.content.withdrawals.some((w) => w.requestId === goodReq.requestId));
  });

  it('prepareWithdrawalFromRequest refuses tip mismatch', function () {
    const a = new Key();
    const genesis = {
      spendPolicy: { network: 'regtest', validators: [a.pubkey], threshold: 1, csvBlocks: 144 },
      members: { signers: [a.pubkey], threshold: 1 }
    };
    const tip = {
      contractId: 'd'.repeat(64),
      stateDigest: '11'.repeat(32),
      bitcoinBlockHash: '22'.repeat(32),
      content: { members: [a.pubkey.slice(2)] }
    };
    const req = buildWithdrawalRequest({
      tip,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 100
    });
    assert.throws(() => prepareWithdrawalFromRequest({
      request: req,
      tip: Object.assign({}, tip, { bitcoinBlockHash: '33'.repeat(32) }),
      genesis,
      fundedTxHex: '02000000000100'
    }), /bitcoinBlockHash|match/i);
  });
});
