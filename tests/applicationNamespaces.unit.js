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

  it('lists shared contract body types', function () {
    assert.ok(CONTRACT_BODY_TYPES.GroupChat);
    assert.ok(CONTRACT_BODY_TYPES.FederationContractInvite);
    assert.ok(CONTRACT_BODY_TYPES.MissionBroadcast);
    assert.ok(CONTRACT_BODY_TYPES.GameStateSnapshot);
    assert.ok(CONTRACT_BODY_TYPES.GroupActivityTree);
    assert.ok(CONTRACT_BODY_TYPES.GroupJournalRequest);
    assert.ok(CONTRACT_BODY_TYPES.GroupJournalBatch);
    assert.ok(CONTRACT_BODY_TYPES.GroupStateJournal);
    assert.ok(CONTRACT_BODY_TYPES.ContractCapabilityGrant);
    assert.ok(CONTRACT_BODY_TYPES.ContractWithdrawalRequest);
    assert.ok(CONTRACT_BODY_TYPES.ContractWithdrawalWitness);
    assert.strictEqual(isKnownContractBodyType('GroupShare'), true);
    assert.strictEqual(isKnownContractBodyType('GroupJournalBatch'), true);
    assert.strictEqual(isKnownContractBodyType('GameStateSnapshot'), true);
    assert.strictEqual(isKnownContractBodyType('NotAType'), false);
  });

  it('catalogs shared activity types for Beacon / apps', function () {
    assert.strictEqual(ACTIVITY_TYPES.FederationSignRequest, 'FederationSignRequest');
    assert.strictEqual(ACTIVITY_TYPES.FederationSignResponse, 'FederationSignResponse');
    assert.strictEqual(ACTIVITY_TYPES.GameStateSnapshot, 'GameStateSnapshot');
  });
});
