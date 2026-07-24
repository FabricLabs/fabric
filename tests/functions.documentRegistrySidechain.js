'use strict';

const assert = require('assert');
const sidechainState = require('../functions/sidechainState');
const registry = require('../functions/documentRegistrySidechain');
const { getBodySchema } = require('../functions/messageBodyCodec');

describe('functions/documentRegistrySidechain', function () {
  it('registers SIDECHAIN_STATE_PATCH body schema', function () {
    assert.ok(getBodySchema(registry.SIDECHAIN_STATE_PATCH_TYPE));
    assert.strictEqual(getBodySchema(registry.SIDECHAIN_STATE_PATCH_TYPE).length, 3);
  });

  it('field round-trip encode/decode', function () {
    const state = sidechainState.createInitialState();
    const catalog = registry.buildRegistryCatalog([
      { id: 'sim/doc', rateSats: 42, contentHash: 'ab'.repeat(32), sellerId: 's1' }
    ]);
    const fields = registry.encodeRegistryUpdateFields(state, catalog);
    const body = registry.encodeRegistryUpdateBody(fields);
    const back = registry.decodeRegistryUpdateBody(body);
    assert.strictEqual(back.basisClock, 0);
    assert.ok(Buffer.isBuffer(back.basisDigest));
    assert.strictEqual(back.basisDigest.toString('hex'), sidechainState.stateDigest(state));
    assert.strictEqual(back.catalogCanonical, fields.catalogCanonical);
  });

  it('applyInventoryToRegistry updates STATE digest without public RFC6902 API', function () {
    let state = sidechainState.createInitialState();
    const r1 = registry.applyInventoryToRegistry(state, [
      { id: 'a', rateSats: 10, contentHash: 'cd'.repeat(32), sellerId: 's0' },
      { id: 'a', rateSats: 12, contentHash: 'cd'.repeat(32), sellerId: 's1' }
    ]);
    assert.ok(r1.ok);
    assert.ok(r1.state.content.registry);
    assert.strictEqual(r1.state.content.registry.sellerCount, 2);
    assert.strictEqual(r1.stateDigest, sidechainState.stateDigest(r1.state));
    assert.ok(r1.body.length > 0);

    const r2 = registry.applyInventoryToRegistry(r1.state, [
      { id: 'b', rateSats: 1, contentHash: 'ef'.repeat(32), sellerId: 's2' }
    ]);
    assert.ok(r2.ok);
    assert.ok(r2.state.clock > r1.state.clock);
    assert.ok(r2.state.content.registry.documents.b);
  });
});
