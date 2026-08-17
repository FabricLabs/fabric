'use strict';

/**
 * Deterministic generic application-contract chain for fixture-backed replay.
 *
 * Builds signed AMP frames (CONTRACT_PUBLISH + common CONTRACT_MESSAGE ops)
 * from fixed BIP39 test-vector mnemonics so hashes are stable across runs.
 * GroupChange coverage is every {@link GOVERNANCE_ACTIONS} value, including
 * reader-only member add and validator (`signers.set`) roster edits.
 */

const Actor = require('../../types/actor');
const Key = require('../../types/key');
const Message = require('../../types/message');
const { pubkeyXOnly } = require('../../functions/groupChatSeal');
const {
  GOVERNANCE_ACTIONS,
  signProposalVote
} = require('../../functions/groupChangeGovernance');
const {
  createMemoryStore,
  ingestContractPublishBuffer,
  ingestMessageBuffer,
  loadDoc,
  tipFromDoc
} = require('../../functions/contractMessageAccumulate');
const {
  createCollection,
  ingest,
  toJSON,
  fromJSON,
  replay
} = require('../../functions/fabricMessageCollection');

const CREATED_AT = '2026-08-16T00:00:00.000Z';

/** BIP39 test vectors + extra 32-byte seeds — not live secrets. */
const KEY_MATERIAL = Object.freeze({
  alice: { mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' },
  bob: { mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow' },
  carol: { mnemonic: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above' },
  dave: { seedHex: '11'.repeat(32) },
  eve: { seedHex: '22'.repeat(32) }
});

/** @deprecated use KEY_MATERIAL */
const MNEMONICS = Object.freeze({
  alice: KEY_MATERIAL.alice.mnemonic,
  bob: KEY_MATERIAL.bob.mnemonic,
  carol: KEY_MATERIAL.carol.mnemonic
});

const MESSAGE_TYPES = Object.freeze([
  'GroupChat',
  'GroupChange',
  'GroupChangeProposal',
  'GroupChangeVote',
  'FederationContractInvite',
  'FederationContractInviteResponse',
  'GroupJournalRequest',
  'GroupJournalBatch'
]);

function keyFromMaterial (spec) {
  if (spec && spec.mnemonic) return new Key({ mnemonic: spec.mnemonic });
  if (spec && spec.seedHex) return new Key({ seed: Buffer.from(String(spec.seedHex), 'hex') });
  throw new Error('keyFromMaterial: mnemonic or seedHex required');
}

function keysFromMaterial (material = KEY_MATERIAL) {
  const out = {};
  for (const name of Object.keys(material)) {
    out[name] = keyFromMaterial(material[name]);
  }
  return out;
}

function keysFromMnemonics (mnemonics = MNEMONICS) {
  const material = Object.assign({}, KEY_MATERIAL);
  if (mnemonics && mnemonics.alice) material.alice = { mnemonic: mnemonics.alice };
  if (mnemonics && mnemonics.bob) material.bob = { mnemonic: mnemonics.bob };
  if (mnemonics && mnemonics.carol) material.carol = { mnemonic: mnemonics.carol };
  return keysFromMaterial(material);
}

function pub (key) {
  return String(key.pubkey || '').toLowerCase();
}

function applicationDefinition (keys) {
  const alice = pub(keys.alice);
  const bob = pub(keys.bob);
  return {
    name: 'GenericApplication',
    version: 1,
    createdAt: CREATED_AT,
    creator: alice,
    groupId: 'app-generic-1',
    parties: [alice, bob],
    validators: [alice, bob],
    proposedPolicy: {
      validators: [alice, bob],
      threshold: 2
    },
    messageTypes: MESSAGE_TYPES.slice(),
    state: { label: 'fixture-generic-app' }
  };
}

function signPublish (key, definition) {
  return Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(key);
}

function signContractMessage (key, contractId, type, object) {
  return Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
    contract: contractId,
    type,
    object
  })]).signWithKey(key);
}

function changeActionOf (message) {
  if (!message || message.type !== 'CONTRACT_MESSAGE') return null;
  try {
    const body = JSON.parse(message.body || message.data || '{}');
    if (body.type !== 'GroupChange' && body.type !== 'GroupChangeProposal') return null;
    const obj = body.object && typeof body.object === 'object' ? body.object : {};
    return obj.action != null ? String(obj.action) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Ordered signed frames for the generic application story.
 * @param {object} [opts]
 * @param {object} [opts.mnemonics]
 * @param {object} [opts.material]
 * @returns {object}
 */
function buildGenericApplicationChain (opts = {}) {
  const mnemonics = opts.mnemonics || MNEMONICS;
  const material = opts.material || KEY_MATERIAL;
  const keys = keysFromMaterial(material);
  const definition = applicationDefinition(keys);
  const contractId = new Actor(definition).id;
  const alice = pub(keys.alice);
  const bob = pub(keys.bob);
  const carol = pub(keys.carol);
  const dave = pub(keys.dave);
  const eve = pub(keys.eve);

  const proposal = {
    id: 'gprop-fixture-1',
    contractId,
    groupId: definition.groupId,
    action: 'member.add',
    member: carol,
    role: 'signer',
    patch: null,
    proposedBy: pubkeyXOnly(alice) || alice,
    createdAt: CREATED_AT,
    threshold: 2
  };
  const vote = signProposalVote(keys.bob, proposal);

  const frames = [
    {
      label: 'publish',
      message: signPublish(keys.alice, definition)
    },
    {
      label: 'chat-alice',
      message: signContractMessage(keys.alice, contractId, 'GroupChat', {
        body: 'hello application',
        author: alice,
        ts: '2026-08-16T00:00:01.000Z'
      })
    },
    {
      label: 'change-seed-roster',
      message: signContractMessage(keys.alice, contractId, 'GroupChange', {
        action: 'members.set',
        members: [alice, bob]
      })
    },
    {
      label: 'change-member-add-dave',
      message: signContractMessage(keys.alice, contractId, 'GroupChange', {
        action: 'member.add',
        member: dave,
        role: 'signer'
      })
    },
    {
      label: 'change-member-add-eve-reader',
      message: signContractMessage(keys.alice, contractId, 'GroupChange', {
        action: 'member.add',
        member: eve,
        role: 'reader'
      })
    },
    {
      label: 'change-member-remove-dave',
      message: signContractMessage(keys.alice, contractId, 'GroupChange', {
        action: 'member.remove',
        member: dave
      })
    },
    {
      label: 'change-members-set',
      message: signContractMessage(keys.alice, contractId, 'GroupChange', {
        action: 'members.set',
        members: [alice, bob, carol, eve]
      })
    },
    {
      label: 'change-signers-set',
      message: signContractMessage(keys.alice, contractId, 'GroupChange', {
        action: 'signers.set',
        signers: [alice, bob]
      })
    },
    {
      label: 'change-update',
      message: signContractMessage(keys.alice, contractId, 'GroupChange', {
        action: 'update',
        patch: {
          pinnedChannels: ['group:app-generic-1'],
          threshold: 2
        }
      })
    },
    {
      label: 'proposal-add-carol',
      message: signContractMessage(keys.alice, contractId, 'GroupChangeProposal', proposal)
    },
    {
      label: 'vote-bob',
      message: signContractMessage(keys.bob, contractId, 'GroupChangeVote', {
        type: 'GroupChangeVote',
        proposalId: proposal.id,
        contractId,
        groupId: definition.groupId,
        voter: bob,
        signature: vote.signature,
        votedAt: '2026-08-16T00:00:02.000Z'
      })
    },
    {
      label: 'chat-bob',
      message: signContractMessage(keys.bob, contractId, 'GroupChat', {
        body: 'carol is in',
        author: bob,
        ts: '2026-08-16T00:00:03.000Z'
      })
    },
    {
      label: 'journal-request',
      message: signContractMessage(keys.alice, contractId, 'GroupJournalRequest', {
        fromClock: 1,
        contractId
      })
    }
  ];

  const collection = createCollection();
  for (const row of frames) {
    const result = ingest(collection, row.message, { origin: row.label });
    if (!result.accepted) {
      throw new Error(`ingest ${row.label}: ${result.error || 'rejected'}`);
    }
    row.hash = result.record.hash;
    row.type = result.record.type;
    row.appType = result.record.appType || null;
    row.hex = result.record.hex;
    row.action = changeActionOf(row.message);
  }

  const folded = foldFrames(frames.map((row) => row.message));
  if (folded.contractId !== contractId) {
    throw new Error(`fold contractId mismatch: ${folded.contractId} != ${contractId}`);
  }

  return {
    mnemonics,
    material,
    keys,
    definition,
    contractId,
    frames,
    collection,
    document: toJSON(collection),
    tip: snapshotTip(folded.tip),
    groupChangeActions: groupChangeActionsOf(frames)
  };
}

function groupChangeActionsOf (frames) {
  const seen = new Set();
  for (const row of frames || []) {
    if (row && row.appType === 'GroupChange' && row.action) seen.add(row.action);
  }
  return [...seen].sort();
}

function foldFrames (messages) {
  const store = createMemoryStore();
  let contractId = null;
  for (const message of messages) {
    const buf = message.toBuffer();
    if (message.type === 'CONTRACT_PUBLISH' || message.type === 'P2P_CONTRACT_PUBLISH') {
      const seeded = ingestContractPublishBuffer(store, buf);
      if (!seeded.accepted && !seeded.duplicate) {
        throw new Error(`publish fold: ${seeded.error || 'rejected'}`);
      }
      contractId = seeded.contractId;
      continue;
    }
    const result = ingestMessageBuffer(store, contractId, buf, { origin: 'mesh' });
    if (!result.accepted && !result.duplicate) {
      throw new Error(`message fold: ${result.error || 'rejected'}`);
    }
  }
  const doc = loadDoc(store, contractId);
  return {
    store,
    contractId,
    tip: tipFromDoc(doc),
    doc
  };
}

/**
 * Replay a FabricMessageCollection document into a fresh accumulate store.
 * @param {object} document
 * @returns {object}
 */
function replayCollectionDocument (document) {
  const restored = fromJSON(document);
  const store = createMemoryStore();
  let contractId = null;
  const result = replay(restored, (ctx) => {
    const buf = ctx.buffer;
    if (ctx.message.type === 'CONTRACT_PUBLISH' || ctx.message.type === 'P2P_CONTRACT_PUBLISH') {
      const seeded = ingestContractPublishBuffer(store, buf);
      if (!seeded.accepted && !seeded.duplicate) {
        throw new Error(`replay publish: ${seeded.error || 'rejected'}`);
      }
      contractId = seeded.contractId;
      return;
    }
    const ingested = ingestMessageBuffer(store, contractId, buf, { origin: 'replay' });
    if (!ingested.accepted && !ingested.duplicate) {
      throw new Error(`replay ${ctx.record && ctx.record.appType}: ${ingested.error || 'rejected'}`);
    }
  });
  const doc = contractId ? loadDoc(store, contractId) : null;
  return {
    applied: result.applied,
    skipped: result.skipped,
    errors: result.errors,
    contractId,
    tip: doc ? snapshotTip(tipFromDoc(doc)) : null
  };
}

function snapshotTip (tip) {
  if (!tip) return null;
  const content = tip.content && typeof tip.content === 'object' ? tip.content : {};
  return {
    contractId: tip.contractId,
    clock: tip.clock,
    stateDigest: tip.stateDigest,
    members: Array.isArray(content.members) ? content.members.slice() : [],
    signers: Array.isArray(content.signers) ? content.signers.slice() : [],
    threshold: content.threshold != null ? content.threshold : null,
    chatBodies: Array.isArray(content.messages)
      ? content.messages.map((m) => m && m.body)
      : [],
    proposalStatus: Array.isArray(content.proposals) && content.proposals[0]
      ? content.proposals[0].status
      : null
  };
}

function serializeFixture (chain) {
  return {
    type: 'FabricApplicationContractChainFixture',
    v: 1,
    createdAt: CREATED_AT,
    contractId: chain.contractId,
    keyMaterial: chain.material || KEY_MATERIAL,
    mnemonics: chain.mnemonics,
    definition: chain.definition,
    collection: chain.document,
    tip: chain.tip,
    groupChangeActions: chain.groupChangeActions,
    labels: chain.frames.map((row) => ({
      label: row.label,
      hash: row.hash,
      type: row.type,
      appType: row.appType,
      action: row.action || null
    }))
  };
}

module.exports = {
  CREATED_AT,
  KEY_MATERIAL,
  MNEMONICS,
  MESSAGE_TYPES,
  GOVERNANCE_ACTIONS,
  keysFromMnemonics,
  keysFromMaterial,
  applicationDefinition,
  buildGenericApplicationChain,
  foldFrames,
  replayCollectionDocument,
  snapshotTip,
  serializeFixture
};
