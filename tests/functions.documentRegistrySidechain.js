'use strict';

const assert = require('assert');
const sidechainState = require('../functions/sidechainState');
const registry = require('../functions/documentRegistrySidechain');
const { getBodySchema } = require('../types/message');

describe('functions/documentRegistrySidechain', function () {
  it('registers SIDECHAIN_STATE_PATCH body schema', function () {
    assert.ok(getBodySchema(registry.SIDECHAIN_STATE_PATCH_TYPE));
    assert.strictEqual(getBodySchema(registry.SIDECHAIN_STATE_PATCH_TYPE).length, 4);
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
    assert.strictEqual(back.patchesCanonical, '');
  });

  it('decodes legacy 3-field bodies without patchesCanonical', function () {
    const { encodeBody, decodeBody } = require('../types/message');
    const legacySchema = Object.freeze([
      { name: 'basisClock', type: 'u32' },
      { name: 'basisDigest', type: 'bytes32' },
      { name: 'catalogCanonical', type: 'string' }
    ]);
    const legacy = encodeBody(legacySchema, {
      basisClock: 0,
      basisDigest: Buffer.alloc(32),
      catalogCanonical: '{"version":1,"documents":{}}'
    });
    const back = decodeBody(registry.SCHEMA_SIDECHAIN_STATE_PATCH, legacy);
    assert.strictEqual(back.catalogCanonical, '{"version":1,"documents":{}}');
    assert.strictEqual(back.patchesCanonical, '');
  });

  it('applyRegistryUpdateFields honors multi-op patchesCanonical', function () {
    let state = sidechainState.createInitialState();
    const catalog = registry.buildRegistryCatalog([
      { id: 'doc-a', rateSats: 1, contentHash: 'ab'.repeat(32), sellerId: 's1' }
    ]);
    // Seed registry first.
    const seeded = registry.applyRegistryUpdateFields(state, {
      basisClock: 0,
      basisDigest: Buffer.from(sidechainState.stateDigest(state), 'hex'),
      catalogCanonical: JSON.stringify(catalog)
    });
    assert.ok(seeded.ok);
    state = seeded.state;

    const patches = [
      { op: 'add', path: '/registry/documents/doc-b', value: { id: 'doc-b', sellers: ['s2'] } },
      { op: 'replace', path: '/registry/sellerCount', value: 2 }
    ];
    const fields = {
      basisClock: state.clock,
      basisDigest: Buffer.from(sidechainState.stateDigest(state), 'hex'),
      patchesCanonical: JSON.stringify(patches)
    };
    const applied = registry.applyRegistryUpdateFields(state, fields);
    assert.ok(applied.ok);
    assert.ok(applied.state.content.registry.documents['doc-b']);
    assert.strictEqual(applied.state.content.registry.sellerCount, 2);
  });

  it('applyRegistryUpdateFields accepts patchesCanonical without catalogCanonical', function () {
    const state = sidechainState.createInitialState();
    const catalog = { version: 1, documents: {}, sellerCount: 0, updatedAt: '2026-01-01T00:00:00.000Z' };
    const patches = [{ op: 'add', path: '/registry', value: catalog }];
    const applied = registry.applyRegistryUpdateFields(state, {
      basisClock: 0,
      basisDigest: Buffer.from(sidechainState.stateDigest(state), 'hex'),
      patchesCanonical: JSON.stringify(patches)
    });
    assert.ok(applied.ok);
    assert.ok(applied.state.content.registry);
    assert.strictEqual(applied.state.content.registry.sellerCount, 0);
  });

  it('applyRegistryUpdateFields rejects patches outside /registry', function () {
    const state = sidechainState.createInitialState();
    const applied = registry.applyRegistryUpdateFields(state, {
      basisClock: 0,
      basisDigest: Buffer.from(sidechainState.stateDigest(state), 'hex'),
      patchesCanonical: JSON.stringify([
        { op: 'add', path: '/note', value: 'escape' }
      ])
    });
    assert.strictEqual(applied.ok, false);
    assert.match(applied.error, /path not allowed by policy/);
  });

  it('applyRegistryUpdateFields rejects copy/move from outside /registry', function () {
    const state = sidechainState.createInitialState();
    const applied = registry.applyRegistryUpdateFields(state, {
      basisClock: 0,
      basisDigest: Buffer.from(sidechainState.stateDigest(state), 'hex'),
      patchesCanonical: JSON.stringify([
        { op: 'copy', from: '/outside-registry', path: '/registry/documents/x', value: null }
      ])
    });
    assert.strictEqual(applied.ok, false);
    assert.match(applied.error, /from not allowed by policy|from denied/i);
  });

  it('applyRegistryUpdateFields still requires catalogCanonical without patches', function () {
    const state = sidechainState.createInitialState();
    const applied = registry.applyRegistryUpdateFields(state, {
      basisClock: 0,
      basisDigest: Buffer.from(sidechainState.stateDigest(state), 'hex')
    });
    assert.strictEqual(applied.ok, false);
    assert.match(applied.error, /catalogCanonical required/);
  });

  it('registryUpdatePathPolicy denies allowlists with no /registry overlap', function () {
    const denied = registry.registryUpdatePathPolicy({
      allowedPathPrefixes: ['/contracts', '/note']
    });
    assert.deepStrictEqual(denied.allowedPathPrefixes, []);
    assert.match(denied.error, /no \/registry overlap/);

    const state = sidechainState.createInitialState();
    const applied = registry.applyRegistryUpdateFields(state, {
      basisClock: 0,
      basisDigest: Buffer.from(sidechainState.stateDigest(state), 'hex'),
      patchesCanonical: JSON.stringify([
        { op: 'add', path: '/registry', value: { version: 1, documents: {} } }
      ])
    }, { allowedPathPrefixes: ['/contracts'] });
    assert.strictEqual(applied.ok, false);
    assert.match(applied.error, /no \/registry overlap/);

    const narrowed = registry.registryUpdatePathPolicy({
      allowedPathPrefixes: ['/registry', '/contracts']
    });
    assert.deepStrictEqual(narrowed.allowedPathPrefixes, ['/registry']);
    assert.ok(!narrowed.error);
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
