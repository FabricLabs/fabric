'use strict';

/**
 * End-to-end mesh scenarios: hub (listener) startup → member peering →
 * priced document publish → inventory (BTC offers) → file bytes on the wire.
 *
 * Hub uses `networking: false` (listen-only seed). Members use `networking: true`
 * so {@link Peer#start} dials `pubkey@127.0.0.1:port` (see types/peer.js).
 */

const assert = require('assert');
const crypto = require('crypto');

const Message = require('../types/message');
const Peer = require('../types/peer');
const { purchaseContentHashHex } = require('../functions/publishedDocumentEnvelope');
const {
  NODEA,
  NODEB,
  hubBaseSettings,
  memberBaseSettings,
  waitUntil,
  getFreePort
} = require('./helpers/peer');

async function waitForHubConnections (hub, n, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (Object.keys(hub.connections).length >= n) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Hub expected ${n} inbound connections, got ${Object.keys(hub.connections).length}`);
}

function remoteHubAddress (member) {
  const keys = Object.keys(member.connections);
  assert.ok(keys.length >= 1, 'member must have an outbound connection to the hub');
  return keys[0];
}

describe('@fabric/core Hub mesh integration', function () {
  this.timeout(30000);

  const peers = [];

  after(async function () {
    for (const peer of peers) {
      try {
        if (peer && typeof peer.stop === 'function') await peer.stop();
      } catch (err) {
        console.warn('[TEST:HUB_MESH] cleanup stop:', err && err.message);
      }
    }
    peers.length = 0;
  });

  it('hub starts (listener) and mesh members establish peer connections', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port));
    peers.push(hub);

    const alice = new Peer(memberBaseSettings(hub, NODEB));
    peers.push(alice);

    await hub.start();
    await alice.start();

    await waitForHubConnections(hub, 1);
    assert.ok(Object.keys(alice.connections).length >= 1);

    await hub.stop();
    await alice.stop();
  });

  it('full flow: publish → priced gossip → inventory with BTC offer → file retrieval (early + late joiners)', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port));
    peers.push(hub);

    const docId = 'catalog/mesh-asset/v2';
    const body = Buffer.from('Mesh settlement: offer sats, verify contentHash, receive bytes.', 'utf8');
    const parsed = {
      id: docId,
      name: 'mesh-asset.txt',
      mime: 'text/plain',
      revision: 1,
      contentBase64: body.toString('base64'),
      size: body.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex')
    };
    const contentHash = purchaseContentHashHex(docId, parsed);
    const askSats = 75_000;

    hub.on('inventory', ({ origin }) => {
      const addr = origin.name;
      const sock = hub.connections[addr];
      if (!sock || !sock._writeFabric) return;

      const inv = Message.fromVector(['P2P_INVENTORY_RESPONSE', JSON.stringify({
        type: 'INVENTORY_RESPONSE',
        object: {
          items: [{ id: docId, rateSats: askSats, contentHash, network: 'bitcoin' }]
        }
      })]);
      inv.signWithKey(hub.key);
      sock._writeFabric(inv.toBuffer());

      // First-class opcode — P2P_FILE_SEND must not escalate from P2P_BASE_MESSAGE.
      const file = Message.fromVector(['P2P_FILE_SEND', JSON.stringify({
        name: docId,
        body: body.toString('base64')
      })]);
      file.signWithKey(hub.key);
      sock._writeFabric(file.toBuffer());
    });

    await hub.start();

    const alice = new Peer(memberBaseSettings(hub, NODEB));
    peers.push(alice);

    const alicePublishes = [];
    const aliceInventory = [];
    const aliceFiles = [];

    alice.on('documentPublish', (ev) => alicePublishes.push(ev));
    alice.on('inventoryResponse', (ev) => aliceInventory.push(ev));
    alice.on('file', (ev) => aliceFiles.push(ev));

    await alice.start();
    await waitForHubConnections(hub, 1);

    hub._publishDocument(docId, body.toString('utf8'), askSats);
    await waitUntil(() => {
      const c = alicePublishes.filter((e) => e.source === 'canonical').length;
      const p = alicePublishes.filter((e) => e.source === 'pricing').length;
      return c >= 1 && p >= 1;
    });

    const aliceCanonical = alicePublishes.filter((e) => e.source === 'canonical');
    const alicePricing = alicePublishes.filter((e) => e.source === 'pricing');
    assert.strictEqual(aliceCanonical.length, 1);
    assert.strictEqual(alicePricing.length, 1);
    assert.strictEqual(aliceCanonical[0].documentId, docId);
    assert.strictEqual(alicePricing[0].documentId, docId);
    assert.strictEqual(alicePricing[0].rateSats, askSats);

    const hubAddrAlice = remoteHubAddress(alice);
    assert.strictEqual(alice.requestPeerInventory(hubAddrAlice, {
      offerBtc: true,
      maxSats: 500_000
    }), true);
    await waitUntil(() => aliceInventory.length >= 1 && aliceFiles.length >= 1);

    assert.strictEqual(aliceInventory.length, 1);
    assert.strictEqual(aliceInventory[0].message.object.items[0].contentHash, contentHash);
    assert.strictEqual(aliceInventory[0].message.object.items[0].rateSats, askSats);

    assert.strictEqual(aliceFiles.length, 1);
    assert.strictEqual(aliceFiles[0].message.object.name, docId);
    assert.strictEqual(Buffer.from(aliceFiles[0].message.object.body, 'base64').toString('utf8'), body.toString('utf8'));

    const bob = new Peer(memberBaseSettings(hub, { key: {} }));
    peers.push(bob);

    const bobPublishes = [];
    const bobInventory = [];
    const bobFiles = [];

    bob.on('documentPublish', (ev) => bobPublishes.push(ev));
    bob.on('inventoryResponse', (ev) => bobInventory.push(ev));
    bob.on('file', (ev) => bobFiles.push(ev));

    await bob.start();
    await waitForHubConnections(hub, 2);

    assert.strictEqual(bobPublishes.length, 0, 'late joiner should not receive earlier broadcast');

    const hubAddrBob = remoteHubAddress(bob);
    assert.strictEqual(bob.requestPeerInventory(hubAddrBob, {
      offerBtc: true,
      maxSats: 1_000_000
    }), true);
    await waitUntil(() => bobInventory.length >= 1 && bobFiles.length >= 1);

    assert.strictEqual(bobInventory.length, 1);
    assert.strictEqual(bobInventory[0].message.object.items[0].contentHash, contentHash);
    assert.strictEqual(bobFiles.length, 1);
    assert.strictEqual(Buffer.from(bobFiles[0].message.object.body, 'base64').toString('utf8'), body.toString('utf8'));

    await hub.stop();
    await alice.stop();
    await bob.stop();
  });

  it('announceDocumentsOnPeerConnect replays document gossip to late joiners after session open', async function () {
    const port = await getFreePort();
    const hub = new Peer(Object.assign(hubBaseSettings(port), {
      announceDocumentsOnPeerConnect: true
    }));
    peers.push(hub);

    const docId = 'catalog/late-join/v1';
    const body = 'Late joiners see re-announced publishes after P2P_SESSION_OPEN.';
    const askSats = 12_000;

    await hub.start();

    const alice = new Peer(memberBaseSettings(hub, NODEB));
    peers.push(alice);
    await alice.start();
    await waitForHubConnections(hub, 1);

    hub._publishDocument(docId, body, askSats);
    await new Promise((r) => setTimeout(r, 350));

    const bob = new Peer(memberBaseSettings(hub, { key: {} }));
    peers.push(bob);
    const bobPublishes = [];
    bob.on('documentPublish', (ev) => bobPublishes.push(ev));

    await bob.start();
    await waitForHubConnections(hub, 2);
    await new Promise((r) => setTimeout(r, 600));

    const bobCanonical = bobPublishes.filter((e) => e.source === 'canonical');
    const bobPricing = bobPublishes.filter((e) => e.source === 'pricing');
    assert.strictEqual(bobCanonical.length, 1);
    assert.strictEqual(bobPricing.length, 1);
    assert.strictEqual(bobCanonical[0].documentId, docId);
    assert.strictEqual(bobPricing[0].documentId, docId);
    assert.strictEqual(bobPricing[0].rateSats, askSats);

    await hub.stop();
    await alice.stop();
    await bob.stop();
  });
});

/**
 * Publish a generic application contract, run common ARC operations, gossip
 * the AMP chain across a local Peer mesh, and lock the message collection
 * plus folded tip to tests/fixtures/application-contract-chain.json.
 *
 *   UPDATE_FIXTURE=1 npm test -- --grep 'generic application contract chain'
 */

const fs = require('fs');
const path = require('path');

const {
  createCollection,
  ingest,
  toJSON,
  fromJSON,
  replay
} = require('../functions/fabricMessageCollection');
const { NetworkHarness } = require('./simulator/lib/network');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'application-contract-chain.json');

function loadFixture () {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function attachCollector (peer) {
  const collection = createCollection();
  const orig = peer._handleFabricMessage.bind(peer);
  peer._handleFabricMessage = function (buffer, origin, socket) {
    ingest(collection, buffer, {
      origin: origin && origin.name ? String(origin.name) : 'peer'
    });
    return orig(buffer, origin, socket);
  };
  return collection;
}

function appHashes (collection) {
  return (collection.messages || [])
    .filter((row) => row.type === 'CONTRACT_PUBLISH' || row.type === 'CONTRACT_MESSAGE')
    .map((row) => row.hash)
    .sort();
}

describe('generic application contract chain', function () {
  this.timeout(30000);

  it('builds a stable AMP chain that matches the committed fixture', function () {
    const chain = buildGenericApplicationChain();
    if (process.env.UPDATE_FIXTURE === '1' || process.env.UPDATE_FIXTURE === 'true') {
      fs.writeFileSync(FIXTURE_PATH, JSON.stringify(serializeFixture(chain), null, 2) + '\n');
    }
    const fixture = loadFixture();
    assert.strictEqual(fixture.type, 'FabricApplicationContractChainFixture');
    assert.strictEqual(chain.contractId, fixture.contractId);
    assert.strictEqual(chain.document.root, fixture.collection.root);
    assert.strictEqual(chain.document.count, fixture.collection.count);
    assert.deepStrictEqual(
      chain.document.messages.map((m) => m.hash),
      fixture.collection.messages.map((m) => m.hash)
    );
    assert.deepStrictEqual(chain.tip, fixture.tip);
    assert.deepStrictEqual(
      [...GOVERNANCE_ACTIONS].sort(),
      chain.groupChangeActions,
      'chain must include every GroupChange action'
    );
    assert.deepStrictEqual(fixture.groupChangeActions, chain.groupChangeActions);
    const changeLabels = fixture.labels.filter((row) => row.appType === 'GroupChange');
    const changeActions = [...new Set(changeLabels.map((row) => row.action))].sort();
    assert.deepStrictEqual(changeActions, [...GOVERNANCE_ACTIONS].sort());
    assert.ok(changeLabels.some((row) => /member-add-dave/.test(row.label)));
    assert.ok(changeLabels.some((row) => /eve-reader/.test(row.label)));
    assert.ok(changeLabels.some((row) => /member-remove-dave/.test(row.label)));
    assert.ok(changeLabels.some((row) => /members-set/.test(row.label)));
    assert.ok(changeLabels.some((row) => /signers-set/.test(row.label)));
    assert.ok(changeLabels.some((row) => row.label === 'change-update'));
    assert.strictEqual(fixture.tip.proposalStatus, 'adopted');
    assert.ok(fixture.tip.members.length >= 2);
    assert.ok(fixture.tip.signers.length >= 2);
    assert.deepStrictEqual(fixture.tip.chatBodies, ['hello application', 'carol is in']);
  });

  it('replays the fixture collection to the bound tip digest', function () {
    const fixture = loadFixture();
    const replayed = replayCollectionDocument(fixture.collection);
    assert.strictEqual(replayed.skipped, 0, JSON.stringify(replayed.errors));
    assert.strictEqual(replayed.applied, fixture.collection.count);
    assert.strictEqual(replayed.contractId, fixture.contractId);
    assert.deepStrictEqual(replayed.tip, fixture.tip);
    assert.strictEqual(replayed.tip.stateDigest, fixture.tip.stateDigest);
  });

  it('gossips the fixture chain across a local Peer mesh and replays to the same tip', async function () {
    const fixture = loadFixture();
    const network = new NetworkHarness({
      peerCount: 3,
      topology: 'star',
      connectTimeoutMs: 20000
    });
    try {
      await network.start();
      const collectors = network.peers.map(attachCollector);
      const hub = network.peers[0];
      for (const row of fixture.collection.messages) {
        hub._handleFabricMessage(Buffer.from(row.hex, 'hex'), { name: 'local-inject' });
      }

      const expected = fixture.collection.messages.map((m) => m.hash).sort();
      await waitUntil(() => {
        return collectors.every((col) => {
          const got = appHashes(col);
          return got.length === expected.length && got.every((h, i) => h === expected[i]);
        });
      }, 20000);

      for (const peer of network.peers) {
        assert.ok(
          peer.contracts && peer.contracts[fixture.contractId],
          'each node should register the published contract'
        );
      }

      for (const col of collectors) {
        const subset = createCollection();
        for (const row of col.messages) {
          if (row.type === 'CONTRACT_PUBLISH' || row.type === 'CONTRACT_MESSAGE') {
            ingest(subset, row.hex);
          }
        }
        const replayed = replayCollectionDocument(toJSON(subset));
        assert.strictEqual(replayed.tip.stateDigest, fixture.tip.stateDigest);
        assert.deepStrictEqual(replayed.tip.members, fixture.tip.members);
        assert.deepStrictEqual(replayed.tip.chatBodies, fixture.tip.chatBodies);
        assert.strictEqual(replayed.tip.proposalStatus, 'adopted');
      }
    } finally {
      await network.stop();
    }
  });
});

const Actor = require('../types/actor');
const Key = require('../types/key');
const { pubkeyXOnly } = require('../functions/groupChatSeal');
const {
  GOVERNANCE_ACTIONS,
  signProposalVote
} = require('../functions/groupChangeGovernance');
const {
  createMemoryStore,
  ingestContractPublishBuffer,
  ingestMessageBuffer,
  loadDoc,
  tipFromDoc
} = require('../functions/contractMessageAccumulate');

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


/**
 * Playnet-oriented CONTRACT_PUBLISH → register → re-publish integration.
 *
 * Always runs offline (in-process Peer). Optional live dial when
 * FABRIC_PLAYNET_PUBLISH=1 (connects FABRIC_PLAYNET_PEERS, default
 * 127.0.0.1:7777) — skipped unless that env is set. Live mode also requires
 * an explicit FABRIC_MNEMONIC (no public fallback).
 *
 *   npm test -- --grep 'playnet contract publish'
 *   FABRIC_PLAYNET_PUBLISH=1 FABRIC_MNEMONIC='…' npm test -- --grep 'playnet contract publish live'
 */


describe('playnet contract publish + re-publish', function () {
  it('publishes, registers Actor id, and re-publishes without allow-list hijack', function () {
    const peer = new Peer({ listen: false, peersDb: null, networking: false });
    const owner = new Key();
    const attacker = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const attackerPub = String(attacker.pubkey).toLowerCase();

    const definition = {
      name: 'PlaynetDemoContract',
      version: 1,
      messageTypes: ['GroupChat', 'GroupChange'],
      parties: [ownerPub],
      validators: [ownerPub],
      threshold: 1,
      state: { network: 'regtest', label: 'playnet-leader' }
    };
    const contractId = new Actor(definition).id;
    assert.match(contractId, /^[0-9a-f]{64}$/);

    let publishes = 0;
    peer.on('contract:publish', () => { publishes++; });

    const wire = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    peer._handleFabricMessage(wire.toBuffer(), { name: '127.0.0.1:18444' });

    assert.ok(peer.contracts[contractId] || Object.keys(peer.contracts || {}).length >= 1);
    const id = peer.contracts[contractId] ? contractId : Object.keys(peer.contracts)[0];
    assert.ok(peer._signerMayPatchContract(id, ownerPub));
    assert.strictEqual(peer._signerMayPatchContract(id, attackerPub), false);

    // Re-publish identical body (owner) — first-writer-wins / stable registration.
    const again = peer._registerContract(definition, ownerPub);
    assert.strictEqual(again, true);
    assert.ok(peer._signerMayPatchContract(id, ownerPub));

    // Attacker re-signs identical body — must not gain patch rights.
    assert.strictEqual(peer._registerContract(definition, attackerPub), true);
    assert.strictEqual(
      peer._signerMayPatchContract(id, attackerPub),
      false,
      're-publish must not grant patch rights to a new wire signer'
    );

    assert.ok(publishes >= 1, 'CONTRACT_PUBLISH ingest must emit contract:publish');
  });

  it('broadcast writes CONTRACT_PUBLISH frames to connected peers', function () {
    const peer = new Peer({ listen: false, peersDb: null, networking: false });
    const writes = [];
    peer.connections['127.0.0.1:7777'] = {
      _writeFabric (buf) { writes.push(Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.from(buf)); }
    };
    const owner = new Key();
    const definition = {
      name: 'PlaynetWriteAssert',
      version: 1,
      parties: [String(owner.pubkey).toLowerCase()],
      state: { network: 'regtest' }
    };
    const msg = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    const sent = peer.broadcast(msg.toBuffer());
    assert.ok(sent > 0, `expected CONTRACT_PUBLISH fan-out > 0, got ${sent}`);
    assert.strictEqual(writes.length, 1);
    const parsed = Message.fromBuffer(writes[0]);
    assert.strictEqual(parsed.type, 'CONTRACT_PUBLISH');
  });

  it('deterministic Actor id is stable across JSON clone (re-publish body)', function () {
    const owner = new Key();
    const ownerPub = String(owner.pubkey).toLowerCase();
    const definition = {
      name: 'PlaynetDemoContract',
      version: 1,
      messageTypes: ['GroupChat'],
      parties: [ownerPub],
      state: {}
    };
    const a = new Actor(definition).id;
    const b = new Actor(JSON.parse(JSON.stringify(definition))).id;
    assert.strictEqual(a, b);
  });
});

describe('playnet contract publish live', function () {
  const runLive = process.env.FABRIC_PLAYNET_PUBLISH === '1' || process.env.FABRIC_PLAYNET_PUBLISH === 'true';
  const mnemonic = String(process.env.FABRIC_MNEMONIC || '').trim();

  (runLive && mnemonic ? it : it.skip)('dials configured peers and emits CONTRACT_PUBLISH', async function () {
    this.timeout(60000);
    const peers = String(process.env.FABRIC_PLAYNET_PEERS || '127.0.0.1:7777')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const peer = new Peer({
      listen: false,
      networking: true,
      peers,
      key: { mnemonic },
      peersDb: null
    });
    peer.on('error', () => {});
    try {
      await peer.start();

      const deadline = Date.now() + Number(process.env.FABRIC_PLAYNET_WAIT_MS || 20000);
      while (Date.now() < deadline && Object.keys(peer.connections || {}).length === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
      const conns = Object.keys(peer.connections || {});
      assert.ok(conns.length > 0, `expected at least one connection to ${peers.join(',')}`);

      const ownerPub = String(peer.key.pubkey).toLowerCase();
      const definition = {
        name: 'PlaynetLivePublish',
        version: 1,
        parties: [ownerPub],
        state: { network: process.env.FABRIC_FLUSH_NETWORK || 'regtest' }
      };
      const msg = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(peer.key);
      const sent1 = peer.broadcast(msg.toBuffer());
      assert.ok(sent1 > 0, `expected CONTRACT_PUBLISH fan-out > 0, got ${sent1}`);

      // Brief observe, then re-publish once.
      await new Promise((r) => setTimeout(r, 1000));
      const msg2 = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(peer.key);
      const sent2 = peer.broadcast(msg2.toBuffer());
      assert.ok(sent2 > 0, `expected second CONTRACT_PUBLISH fan-out > 0, got ${sent2}`);
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      await peer.stop();
    }
  });
});
