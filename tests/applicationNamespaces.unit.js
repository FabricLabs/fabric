'use strict';

const assert = require('assert');
const constants = require('../constants');
const {
  OUTER,
  OUTER_OPCODES,
  CONTRACT_BODY_TYPES,
  ACTIVITY_TYPES,
  isApplicationOuterType,
  isKnownContractBodyType
} = require('../functions/applicationNamespaces');

describe('applicationNamespaces', function () {
  it('outer opcodes match constants', function () {
    assert.strictEqual(OUTER_OPCODES.P2P_CHAT_MESSAGE, constants.P2P_CHAT_MESSAGE);
    assert.strictEqual(OUTER_OPCODES.CONTRACT_PUBLISH, constants.P2P_CONTRACT_PUBLISH);
    assert.strictEqual(OUTER_OPCODES.CONTRACT_MESSAGE, constants.P2P_CONTRACT_MESSAGE);
    assert.strictEqual(OUTER_OPCODES.CONTRACT_PROPOSAL, constants.CONTRACT_PROPOSAL_TYPE);
  });

  it('recognizes application outer type names and aliases', function () {
    assert.strictEqual(isApplicationOuterType(OUTER.P2P_CHAT_MESSAGE), true);
    assert.strictEqual(isApplicationOuterType(OUTER.CONTRACT_PUBLISH), true);
    assert.strictEqual(isApplicationOuterType('P2P_CONTRACT_MESSAGE'), true);
    assert.strictEqual(isApplicationOuterType('GenericMessage'), false);
  });

  it('lists generic ARC contract body types only', function () {
    assert.ok(CONTRACT_BODY_TYPES.GroupChat);
    assert.ok(CONTRACT_BODY_TYPES.GroupChange);
    assert.ok(CONTRACT_BODY_TYPES.FederationContractInvite);
    assert.ok(CONTRACT_BODY_TYPES.GroupJournalRequest);
    assert.ok(CONTRACT_BODY_TYPES.GroupJournalBatch);
    assert.ok(CONTRACT_BODY_TYPES.GroupStateJournal);
    assert.ok(CONTRACT_BODY_TYPES.ContractCapabilityGrant);
    assert.ok(CONTRACT_BODY_TYPES.ContractWithdrawalRequest);
    assert.ok(CONTRACT_BODY_TYPES.ContractWithdrawalWitness);
    assert.ok(CONTRACT_BODY_TYPES.MessageReceived);
    assert.ok(CONTRACT_BODY_TYPES.MessageReceipt);
    assert.strictEqual(isKnownContractBodyType('GroupChat'), true);
    assert.strictEqual(isKnownContractBodyType('MessageReceipt'), true);
    // Product types live in app catalogs, not core
    assert.strictEqual(isKnownContractBodyType('GroupShare'), false);
    assert.strictEqual(isKnownContractBodyType('GroupActivityTree'), false);
    assert.strictEqual(isKnownContractBodyType('MissionBroadcast'), false);
    assert.strictEqual(isKnownContractBodyType('MissionCreated'), false);
    assert.strictEqual(isKnownContractBodyType('SCEventBatch'), false);
    assert.strictEqual(isKnownContractBodyType('GameStateSnapshot'), false);
    assert.strictEqual(isKnownContractBodyType('NotAType'), false);
  });

  it('catalogs shared activity types for Beacon (no product snapshots)', function () {
    assert.strictEqual(ACTIVITY_TYPES.FederationSignRequest, 'FederationSignRequest');
    assert.strictEqual(ACTIVITY_TYPES.FederationSignResponse, 'FederationSignResponse');
    assert.strictEqual(ACTIVITY_TYPES.GameStateSnapshot, undefined);
  });
});
