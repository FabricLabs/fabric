'use strict';

const { FabricShell } = require('../types/service');

const assert = require('assert');

describe('@fabric/core/types/service (FabricShell)', function () {
  describe('FabricShell', function () {
    // Full suite load can push start/stop over 5s; keep CI stable.
    this.timeout(30000);

    it('is available from @fabric/core', function () {
      assert.equal(FabricShell instanceof Function, true);
    });

    it('should expose a constructor', function () {
      assert.equal(typeof FabricShell, 'function');
    });

    it('has a normal lifecycle', async function () {
      const app = new FabricShell();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('allow a Resource to be defined', async function () {
      const app = new FabricShell();
      await app.define('Example', {
        components: {
          list: 'fabric-example-list',
          view: 'fabric-example-view'
        }
      });

      assert.ok(app.resources.Example);
      assert.strictEqual(app.resources.Example.components.list, 'fabric-example-list');

      await app.start();
      await app.stop();
    });

    it('should create an application smoothly', async function () {
      const app = new FabricShell();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('defer warns and consume()s an empty resource map onto the attached element', async function () {
      const app = new FabricShell();
      const element = {};
      const warnings = [];
      app.on('warning', (line) => warnings.push(String(line)));
      app.attach(element);

      await app.start();
      const returned = await app.defer({ id: 'test-oracle' });
      await app.stop();

      assert.strictEqual(returned, app);
      assert.ok(warnings.some((line) => line.includes('deferring authority')));
      assert.deepStrictEqual(element.resources, {});
    });

    it('render writes attached element markup', function () {
      const app = new FabricShell();
      const element = {
        attrs: {},
        setAttribute: function (k, v) { this.attrs[k] = v; },
        innerHTML: ''
      };
      app.attach(element);
      const out = app.render();
      assert.strictEqual(typeof out, 'string');
      assert.ok(out.includes('fabric-application'));
      assert.ok(typeof element.attrs.integrity === 'string');
      assert.ok(element.innerHTML.includes('fabric-state-json'));
    });

    it('use currently throws when superclass has no use()', function () {
      const app = new FabricShell();
      assert.throws(() => app.use('demo', { enabled: true }), /use is not a function/);
    });

    it('registerCommand binds method to shell instance', function () {
      const app = new FabricShell();
      app._registerCommand('echoSelf', function () {
        return this.id;
      });
      assert.strictEqual(typeof app.commands.echoSelf, 'function');
      assert.strictEqual(app.commands.echoSelf(), app.id);
    });

    it('envelop returns null and logs when selector is missing', function () {
      const app = new FabricShell();
      const logs = [];
      app.log = function () { logs.push(Array.from(arguments).join(' ')); };
      const origDocument = global.document;
      global.document = {
        querySelector: function () { return null; }
      };
      try {
        const out = app.envelop('#missing');
        assert.strictEqual(out, null);
        assert.ok(logs.some((x) => x.includes('could not find element')));
      } finally {
        global.document = origDocument;
      }
    });

    it('registerService relays ChatMessage payloads to node relay', async function () {
      const app = new FabricShell();
      app.settings.services = ['relay'];
      const relayed = [];
      app.node = {
        id: 'node-1',
        relayFrom: function (id, msg) {
          relayed.push({ id, msg });
        }
      };
      class RelayService extends require('../types/service') {}
      const service = app._registerService('relay', RelayService);
      service.emit('message', { '@type': 'ChatMessage', body: 'hello' });
      assert.strictEqual(relayed.length, 1);
      assert.strictEqual(relayed[0].id, 'node-1');
    });

    it('registerService signs ChatMessage relays when node.key is present', async function () {
      const Key = require('../types/key');
      const app = new FabricShell();
      app.settings.services = ['relay'];
      const relayed = [];
      const key = new Key();
      app.node = {
        id: 'node-1',
        key,
        relayFrom: function (id, msg) {
          relayed.push({ id, msg });
        }
      };
      class RelayService extends require('../types/service') {}
      const service = app._registerService('relay', RelayService);
      service.emit('message', { '@type': 'ChatMessage', body: 'signed-hello' });
      assert.strictEqual(relayed.length, 1);
      assert.ok(relayed[0].msg.verifyWithKey(key));
    });

    it('registerService forwards warning/error and exercises default message branch', function () {
      const app = new FabricShell();
      app.settings.services = ['relay'];
      const warnings = [];
      const errors = [];
      app._appendWarning = async function (m) { warnings.push(String(m)); };
      app._appendError = async function (m) { errors.push(String(m)); };
      app._appendMessage = async function () {};
      app.node = { id: 'node-1', relayFrom: function () {} };
      class RelayService extends require('../types/service') {}
      const service = app._registerService('relay', RelayService);
      service.emit('warning', { kind: 'warn' });
      service.emit('error', { kind: 'err' });
      service.emit('message', { '@type': 'NotChat', body: 'noop' }); // default switch path
      assert.ok(warnings.some((x) => x.includes('Service warning from relay')));
      assert.ok(errors.some((x) => x.includes('Service "relay" emitted error')));
    });

    it('registerService identity handler invokes _registerActor and handles exceptions', function () {
      const app = new FabricShell();
      app.settings.services = ['relay'];
      const messages = [];
      const errors = [];
      app._appendMessage = async function (m) { messages.push(String(m)); };
      app._appendError = async function (m) { errors.push(String(m)); };
      app.node = { id: 'node-1', relayFrom: function () {} };

      class RelayService extends require('../types/service') {
        _registerActor () {
          throw new Error('actor register failed');
        }
      }

      app._registerService('relay', RelayService);
      app.emit('identity', { id: 'actor-1' });
      assert.ok(messages.some((x) => x.includes('Registering actor on service "relay"')));
      assert.ok(errors.some((x) => x.includes('actor register failed')));
    });

    it('registerService duplicate returns warning path', function () {
      const app = new FabricShell();
      app.settings.services = ['dup'];
      const warnings = [];
      app._appendWarning = async function (m) { warnings.push(String(m)); };
      app.node = { id: 'node-1', relayFrom: function () {} };
      class DupService extends require('../types/service') {}
      app._registerService('dup', DupService);
      app._registerService('dup', DupService);
      assert.ok(warnings.some((x) => x.includes('Service already registered: dup')));
    });
  });
});

/**
 * Application ARC / Federation wire shapes against `@fabric/core`.
 *
 * Covers Hub tracked CONTRACT_PUBLISH → Accept spend overlay, opaque queue,
 * Federation group genesis (`proposedPolicy` + top-level `messageTypes`),
 * GroupChangeProposal votes, and Peer `contract:message` `messageHex`
 * accumulate — without importing any application product repo.
 */

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
function applicationCanonicalPubkeyList (list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const x = pubkeyXOnly(item);
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  out.sort();
  return out;
}

function applicationProposalSigningString (proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  return JSON.stringify({
    type: 'GroupChangeProposal',
    v: 2,
    id: String(p.id || ''),
    contractId: String(p.contractId || '').toLowerCase(),
    groupId: String(p.groupId || ''),
    action: String(p.action || ''),
    member: p.member != null ? String(p.member).toLowerCase() : null,
    role: p.role != null ? String(p.role) : null,
    members: applicationCanonicalPubkeyList(p.members),
    signers: applicationCanonicalPubkeyList(p.signers),
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
