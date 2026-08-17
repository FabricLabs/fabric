'use strict';

/**
 * Publish a generic application contract, run common ARC operations, gossip
 * the AMP chain across a local Peer mesh, and lock the message collection
 * plus folded tip to tests/fixtures/application-contract-chain.json.
 *
 *   UPDATE_FIXTURE=1 npm test -- --grep 'generic application contract chain'
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildGenericApplicationChain,
  serializeFixture,
  replayCollectionDocument,
  GOVERNANCE_ACTIONS
} = require('./helpers/applicationContractChain');
const {
  createCollection,
  ingest,
  toJSON
} = require('../functions/fabricMessageCollection');
const { NetworkHarness } = require('./simulator/lib/network');
const { waitUntil } = require('./helpers/peer');

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
