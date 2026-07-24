'use strict';

const assert = require('assert');
const Statechain = require('../functions/sidechainState');
const contractStatechains = require('../functions/contractStatechains');
const local = require('../functions/contractSidechainLocal');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('@fabric/core/functions/contractStatechains', function () {
  it('provisionAcceptedContract seals /namespaces/<id> on parent', async function () {
    const mem = new Map();
    const fakeFs = {
      readFile (p) { return mem.has(p) ? mem.get(p) : null; },
      writeFile (p, data) {
        mem.set(p, typeof data === 'string' ? data : JSON.stringify(data));
        return true;
      },
      async publish (p, data) {
        mem.set(p, typeof data === 'string' ? data : JSON.stringify(data));
      }
    };
    const parent = Statechain.createInitialState();
    const contractId = 'ab'.repeat(32);
    const result = await contractStatechains.provisionAcceptedContract(
      fakeFs,
      parent,
      { contractId, name: 'DemoApp' },
      null
    );
    assert.strictEqual(result.ok, true);
    assert.ok(result.parentState.content.namespaces[contractId]);
    assert.strictEqual(
      result.parentState.content.namespaces[contractId].stateDigest,
      result.head.stateDigest
    );
  });
});

describe('@fabric/core/functions/contractSidechainLocal', function () {
  it('persists under storeRoot/sidechains/<id>/STATE.json', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-csl-'));
    const id = 'cd'.repeat(32);
    const ensured = local.ensureLocalContractChain(root, id, { name: 'Group' });
    assert.strictEqual(ensured.created, true);
    assert.ok(fs.existsSync(ensured.paths.state));
    const pub = local.publishContent(root, id, { hello: 1 }, { name: 'Group' });
    assert.strictEqual(pub.state.clock, 1);
    assert.strictEqual(pub.head.stateDigest, Statechain.stateDigest(pub.state));
    const patches = local.patchesForNamespaceHead({}, id, pub.head);
    assert.strictEqual(patches[0].path, '/namespaces');
  });
});
