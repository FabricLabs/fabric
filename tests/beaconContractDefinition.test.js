'use strict';

const assert = require('assert');
const Key = require('../types/key');
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
