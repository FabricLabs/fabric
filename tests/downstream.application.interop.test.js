'use strict';

/**
 * Application ARC / Federation wire shapes against `@fabric/core`.
 *
 * Covers Hub tracked CONTRACT_PUBLISH → Accept spend overlay, opaque queue,
 * Federation group genesis (`proposedPolicy` + top-level `messageTypes`),
 * GroupChangeProposal votes, and Peer `contract:message` `messageHex`
 * accumulate — without importing any application product repo.
 */

const assert = require('assert');
const Actor = require('../types/actor');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { pubkeyXOnly } = require('../functions/groupChatSeal');
const {
  signingStringForGroupChangeProposal,
  signProposalVote,
  verifyProposalVote
} = require('../functions/groupChangeGovernance');
const {
  createMemoryStore,
  ingestMessageBuffer,
  ingestContractPublishBuffer,
  normalizeGenesis,
  isSyncTrackedType,
  loadDoc
} = require('../functions/contractMessageAccumulate');
const {
  enqueueMessageBuffer,
  entryHexList,
  listQueuedMessages
} = require('../functions/contractMessageQueue');
const {
  createPending,
  markReceived,
  phaseFlags
} = require('../functions/contractMessageCommit');
const {
  normalizeArcGenesis,
  resolveSpend
} = require('../functions/contractSpend');

/** Representative Federation group messageTypes allow-list (application catalogs may extend). */
const FEDERATION_GROUP_MESSAGE_TYPES = Object.freeze([
  'GroupChat',
  'GroupChange',
  'GroupChangeProposal',
  'GroupChangeVote',
  'GroupShare',
  'GroupActivityTree',
  'FleetShare',
  'FederationContractInvite',
  'FederationContractInviteResponse',
  'GroupJournalRequest',
  'GroupJournalBatch',
  'GroupStateJournal',
  'ContractCapabilityGrant',
  'ContractWithdrawalRequest',
  'ContractWithdrawalWitness'
]);

function federationGroupDefinition (creatorKey, extra = {}) {
  const creator = String(creatorKey.pubkey).toLowerCase();
  return {
    name: 'FederationGroup',
    version: 6,
    parentContract: 'aa'.repeat(32),
    groupId: extra.groupId || 'grp-wing-1',
    creator,
    createdAt: extra.createdAt || '2026-08-13T00:00:00.000Z',
    proposedPolicy: {
      validators: extra.validators || [creator],
      threshold: extra.threshold != null ? extra.threshold : 1
    },
    meta: {
      name: extra.name || 'Wing',
      visibility: extra.visibility || 'public',
      slug: extra.slug || 'wing',
      parentId: null
    },
    messageTypes: FEDERATION_GROUP_MESSAGE_TYPES.slice(),
    state: { members: {}, chat: {}, changes: {}, shares: {}, meta: {} }
  };
}

function hubPlaynetDefinition (ownerKey) {
  const ownerPub = String(ownerKey.pubkey).toLowerCase();
  return {
    name: 'DemoGroup',
    version: 5,
    messageTypes: ['GroupChat', 'GroupChange', 'GroupChangeProposal'],
    parties: [ownerPub],
    validators: [ownerPub],
    proposedPolicy: { validators: [ownerPub], threshold: 1 },
    creator: ownerPub,
    state: { network: 'regtest' }
  };
}

function signContractMessage (key, contractId, type, object) {
  return Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
    contract: contractId,
    type,
    object
  })]).signWithKey(key);
}

/**
 * Canonical proposal signing string used by application vote helpers.
 * Kept inline so core CI does not import application repos.
 */
function applicationProposalSigningString (proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  return JSON.stringify({
    type: 'GroupChangeProposal',
    v: 1,
    id: String(p.id || ''),
    contractId: String(p.contractId || '').toLowerCase(),
    groupId: String(p.groupId || ''),
    action: String(p.action || ''),
    member: p.member != null ? String(p.member).toLowerCase() : null,
    role: p.role != null ? String(p.role) : null,
    patch: p.patch && typeof p.patch === 'object' ? p.patch : null,
    proposedBy: String(p.proposedBy || '').toLowerCase(),
    createdAt: String(p.createdAt || '')
  });
}

describe('application ARC interop (Hub + Federation groups)', function () {
  it('proposal signing string is byte-identical to application vote helpers', function () {
    const a = new Key();
    const recruit = new Key();
    const proposal = {
      id: 'gprop-wing',
      contractId: 'ab'.repeat(32),
      groupId: 'grp-wing-1',
      action: 'member.add',
      member: recruit.pubkey,
      role: 'signer',
      patch: null,
      proposedBy: String(a.pubkey).toLowerCase(),
      createdAt: '2026-08-13T00:00:00.000Z'
    };
    assert.strictEqual(
      signingStringForGroupChangeProposal(proposal),
      applicationProposalSigningString(proposal)
    );
    const signed = signProposalVote(a, proposal);
    assert.strictEqual(verifyProposalVote(proposal, a.pubkey, signed.signature), true);
  });

  it('normalizeGenesis reads proposedPolicy + top-level messageTypes', function () {
    const owner = new Key();
    const def = federationGroupDefinition(owner, { threshold: 2 });
    const genesis = normalizeGenesis(def);
    assert.ok(genesis.signers.includes(pubkeyXOnly(owner.pubkey)));
    assert.strictEqual(genesis.threshold, 2);
    assert.ok(genesis.primitives.messageTypes.includes('GroupChangeProposal'));
    assert.ok(genesis.primitives.messageTypes.includes('FederationContractInvite'));
  });

  it('FederationGroup CONTRACT_PUBLISH seeds accumulate so GroupChat needs no meta.genesis', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const def = federationGroupDefinition(owner);
    const pub = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer());
    assert.strictEqual(seeded.accepted, true, seeded.error);
    assert.ok(seeded.contractId);
    assert.ok(seeded.genesis.signers.includes(pubkeyXOnly(owner.pubkey)));

    const chat = ingestMessageBuffer(
      store,
      seeded.contractId,
      signContractMessage(owner, seeded.contractId, 'GroupChat', {
        body: 'o7',
        author: owner.pubkey,
        ts: '2026-08-13T00:00:01.000Z'
      }).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(chat.accepted, true, chat.error);
    assert.strictEqual(isSyncTrackedType('GroupChat', loadDoc(store, seeded.contractId)), true);
  });

  it('threshold-2 proposal stays pending until a BIP340 vote (application vote wire)', function () {
    const a = new Key();
    const b = new Key();
    const recruit = new Key();
    const store = createMemoryStore();
    const def = federationGroupDefinition(a, {
      validators: [a.pubkey, b.pubkey],
      threshold: 2
    });
    const seeded = ingestContractPublishBuffer(
      store,
      Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(a).toBuffer()
    );
    assert.strictEqual(seeded.accepted, true, seeded.error);
    const contractId = seeded.contractId;
    const proposal = {
      id: 'gprop-k2',
      contractId,
      groupId: def.groupId,
      action: 'member.add',
      member: recruit.pubkey,
      role: 'signer',
      patch: null,
      proposedBy: pubkeyXOnly(a.pubkey),
      createdAt: def.createdAt,
      threshold: 2
    };
    const proposed = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(a, contractId, 'GroupChangeProposal', proposal).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(proposed.accepted, true, proposed.error);
    assert.strictEqual(proposed.tip.content.proposals[0].status, 'pending');
    assert.ok(!proposed.tip.content.members.includes(pubkeyXOnly(recruit.pubkey)));

    const vote = signProposalVote(b, proposal);
    const adopted = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(b, contractId, 'GroupChangeVote', {
        type: 'GroupChangeVote',
        proposalId: proposal.id,
        contractId,
        groupId: def.groupId,
        voter: String(b.pubkey).toLowerCase(),
        signature: vote.signature,
        votedAt: '2026-08-13T00:00:02.000Z'
      }).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(adopted.accepted, true, adopted.error);
    assert.strictEqual(adopted.tip.content.proposals[0].status, 'adopted');
    assert.ok(adopted.tip.content.members.includes(pubkeyXOnly(recruit.pubkey)));
  });

  it('GroupChange update patch (pinnedChannels + threshold) is accepted from a signer', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const def = federationGroupDefinition(owner);
    const seeded = ingestContractPublishBuffer(
      store,
      Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(owner).toBuffer()
    );
    const change = ingestMessageBuffer(
      store,
      seeded.contractId,
      signContractMessage(owner, seeded.contractId, 'GroupChange', {
        action: 'update',
        patch: {
          pinnedChannels: ['discord:1', 'group:' + seeded.contractId],
          threshold: 1
        }
      }).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(change.accepted, true, change.error);
    assert.strictEqual(change.tip.content.threshold, 1);
  });

  it('outsider FederationContractInvite is rejected on a Federation group', function () {
    const owner = new Key();
    const outsider = new Key();
    const store = createMemoryStore();
    const def = federationGroupDefinition(owner);
    const seeded = ingestContractPublishBuffer(
      store,
      Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(owner).toBuffer()
    );
    const denied = ingestMessageBuffer(
      store,
      seeded.contractId,
      signContractMessage(outsider, seeded.contractId, 'FederationContractInvite', {
        inviteePubkey: outsider.pubkey,
        groupId: def.groupId
      }).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(denied.accepted, false);
  });

  it('Hub playnet DemoGroup publish → Accept overlay yields a spendAddress', function () {
    const owner = new Key();
    const definition = hubPlaynetDefinition(owner);
    const contractId = new Actor(definition).id;
    const arc = normalizeArcGenesis(definition);
    assert.ok(arc.members.signers.length);
    assert.deepStrictEqual(arc.primitives.messageTypes.slice(0, 3), [
      'GroupChat', 'GroupChange', 'GroupChangeProposal'
    ]);
    const tipHash = 'ab'.repeat(32);
    const spend = resolveSpend({
      genesis: arc,
      tip: {
        contractId,
        content: {
          signers: arc.members.signers.slice(),
          members: arc.members.signers.slice(),
          threshold: arc.members.threshold
        },
        stateDigest: 'cd'.repeat(32),
        bitcoinBlockHash: tipHash,
        bitcoinHeight: 101
      },
      contractId,
      overrides: { network: 'regtest' }
    });
    assert.ok(spend.spendAddress || spend.address);
    const genesis = normalizeGenesis(definition);
    assert.ok(genesis.signers.includes(pubkeyXOnly(owner.pubkey)));
    assert.ok(genesis.primitives.messageTypes.includes('GroupChangeProposal'));
  });

  it('Hub queue then participant fold (origin queue) matches mesh ingest', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const qStore = createMemoryStore();
    const def = hubPlaynetDefinition(owner);
    const seeded = ingestContractPublishBuffer(
      store,
      Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(owner).toBuffer()
    );
    const msg = signContractMessage(owner, seeded.contractId, 'GroupChat', {
      body: 'queued-from-hub',
      author: owner.pubkey,
      ts: '2026-08-13T00:00:03.000Z'
    });
    const enq = enqueueMessageBuffer(qStore, seeded.contractId, msg.toBuffer(), { origin: 'mesh' });
    assert.strictEqual(enq.accepted, true, enq.error);
    const hexes = entryHexList(listQueuedMessages(qStore, seeded.contractId));
    const folded = ingestMessageBuffer(store, seeded.contractId, hexes[0], { origin: 'queue' });
    assert.strictEqual(folded.accepted, true, folded.error);
    assert.strictEqual(folded.tip.clock, 1);
  });

  it('Peer contract:message messageHex folds into accumulate (app relay path)', function () {
    const peer = new Peer({ listen: false, peersDb: null, networking: false });
    const owner = new Key();
    const origin = '127.0.0.1:3041';
    peer.connections[origin] = { _writeFabric () {}, destroy () {} };
    peer.peers[origin] = { publicKey: owner.pubkey };

    const def = federationGroupDefinition(owner);
    const publish = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(owner);
    peer._handleFabricMessage(publish.toBuffer(), { name: origin }, null);
    const contractId = new Actor(def).id;
    assert.ok(peer._signerMayPatchContract(contractId, owner.pubkey));

    const events = [];
    peer.on('contract:message', (ev) => events.push(ev));
    const chat = signContractMessage(owner, contractId, 'GroupChat', {
      body: 'from-mesh',
      author: owner.pubkey,
      ts: '2026-08-13T00:00:04.000Z'
    });
    peer._handleFabricMessage(chat.toBuffer(), { name: origin }, null);
    assert.strictEqual(events.length, 1);
    assert.ok(events[0].wireMessage);
    assert.match(String(events[0].messageHex || ''), /^[0-9a-f]+$/i);
    assert.ok(events[0].genesis);
    assert.strictEqual(events[0].genesis.name, 'FederationGroup');

    const store = createMemoryStore();
    ingestContractPublishBuffer(store, publish.toBuffer());
    const result = ingestMessageBuffer(store, contractId, events[0].messageHex, { origin: 'mesh' });
    assert.strictEqual(result.accepted, true, result.error);

    const record = createPending({
      id: result.entry.hash,
      contractId,
      readers: [owner.pubkey]
    });
    markReceived(record, owner.pubkey);
    assert.strictEqual(phaseFlags(record, owner.pubkey).received, true);
  });

  it('attacker cannot front-run a FederationGroup publish (proposedPolicy authorities)', function () {
    const peer = new Peer({ listen: false, peersDb: null, networking: false });
    const owner = new Key();
    const attacker = new Key();
    const def = federationGroupDefinition(owner);
    const hijack = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(attacker);
    peer._handleFabricMessage(hijack.toBuffer(), { name: '127.0.0.1:18445' }, null);
    const contractId = new Actor(def).id;
    assert.strictEqual(peer._signerMayPatchContract(contractId, attacker.pubkey), false);
    assert.ok(!peer.contracts[contractId]);

    const legit = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]).signWithKey(owner);
    peer._handleFabricMessage(legit.toBuffer(), { name: '127.0.0.1:18444' }, null);
    assert.ok(peer.contracts[contractId]);
    assert.ok(peer._signerMayPatchContract(contractId, owner.pubkey));
    assert.strictEqual(peer._signerMayPatchContract(contractId, attacker.pubkey), false);
  });
});
