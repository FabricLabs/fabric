'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('../types/key');
const de = require('../functions/beaconFederationSigning');
const { jsonSafe, stableStringify } = require('../functions/fabricCanonicalJson');
const { parseDistributedManifestV1 } = require('../functions/fabricProgramManifest');
const sc = require('../functions/sidechainState');

// Compat aliases used by older assertions in this file
de.jsonSafe = jsonSafe;
de.stableStringify = stableStringify;
de.parseDistributedManifestV1 = parseDistributedManifestV1;

describe('@fabric/core/functions/sidechainState', function () {
  it('contract namespace paths and parent seal patches', function () {
    const id = 'ab'.repeat(32);
    const paths = sc.storePathsForContract(id);
    assert.strictEqual(paths.state, `sidechains/${id}/STATE`);
    assert.strictEqual(sc.parentSealPath(id), `/namespaces/${id}`);
    const head = sc.namespaceHeadFromState(id, sc.createInitialState(), { name: 'App' });
    const patches = sc.patchesForNamespaceHead({}, id, head);
    assert.strictEqual(patches[0].path, '/namespaces');
    assert.ok(patches[0].value[id]);
  });

  it('stateDigest is stable for same content', function () {
    const a = { version: 1, clock: 0, content: { x: 1 } };
    const b = { version: 1, clock: 0, content: { x: 1 } };
    assert.strictEqual(sc.stateDigest(a), sc.stateDigest(b));
  });

  it('applyPatchesToState bumps clock and applies RFC6902', function () {
    const s0 = sc.createInitialState();
    const r = sc.applyPatchesToState(s0, [{ op: 'add', path: '/hello', value: 'world' }]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.state.clock, 1);
    assert.strictEqual(r.state.content.hello, 'world');
  });

  it('validatePatchesAgainstPolicy rejects denied and disallowed paths', function () {
    const policy = sc.parseStatechainPathPolicy({
      maxOps: 2,
      allowedPathPrefixes: ['/app'],
      deniedPathPrefixes: ['/app/secret']
    });
    assert.strictEqual(
      sc.validatePatchesAgainstPolicy([{ op: 'add', path: '/other', value: 1 }], policy).ok,
      false
    );
    assert.strictEqual(
      sc.validatePatchesAgainstPolicy([{ op: 'add', path: '/app/secret', value: 1 }], policy).ok,
      false
    );
    assert.strictEqual(
      sc.validatePatchesAgainstPolicy([{ op: 'add', path: '/app/ok', value: 1 }], policy).ok,
      true
    );
    assert.strictEqual(
      sc.applyPatchesToState(sc.createInitialState(), [
        { op: 'add', path: '/a', value: 1 },
        { op: 'add', path: '/b', value: 2 },
        { op: 'add', path: '/c', value: 3 }
      ], policy).ok,
      false
    );
  });

  it('signingStringForSidechainStatePatch is stable', function () {
    const p = {
      basisClock: 0,
      basisDigest: 'abc',
      patches: [{ op: 'add', path: '/a', value: 1 }]
    };
    assert.strictEqual(
      sc.signingStringForSidechainStatePatch(p),
      sc.signingStringForSidechainStatePatch(p)
    );
    assert.strictEqual(sc.patchCommitmentDigestHex(p).length, 64);
  });

  it('snapshots round-trip and prune by beacon clock', function () {
    const store = new Map();
    const fs = {
      readFile: (name) => {
        const v = store.get(name);
        return v != null ? Buffer.from(v, 'utf8') : null;
      },
      writeFile: (name, content) => {
        store.set(name, typeof content === 'string' ? content : content.toString('utf8'));
        return true;
      }
    };
    const st = { version: 1, clock: 2, content: { x: 1 } };
    assert.strictEqual(sc.saveSnapshotForBeaconClockSync(fs, 5, st), true);
    const got = sc.loadSnapshotForBeaconClock(fs, 5);
    assert.strictEqual(got.clock, 2);
    sc.saveSnapshotForBeaconClockSync(fs, 7, { version: 1, clock: 3, content: {} });
    sc.pruneSnapshotsAfterBeaconClockSync(fs, 5);
    assert.ok(sc.loadSnapshotForBeaconClock(fs, 5));
    assert.strictEqual(sc.loadSnapshotForBeaconClock(fs, 7), null);
  });

  it('journal seals and resolveStateForBeaconTip replays unsealed', function () {
    const store = new Map();
    const fs = {
      readFile: (name) => {
        const v = store.get(name);
        return v != null ? Buffer.from(v, 'utf8') : null;
      },
      writeFile: (name, content) => {
        store.set(name, typeof content === 'string' ? content : content.toString('utf8'));
        return true;
      }
    };

    const s0 = sc.createInitialState();
    const p1 = [{ op: 'add', path: '/a', value: 1 }];
    const r1 = sc.applyPatchesToState(s0, p1);
    assert.ok(r1.ok);
    sc.appendJournalEntrySync(fs, {
      basisClock: 0,
      clock: r1.state.clock,
      basisDigest: r1.basisDigest,
      newDigest: r1.newDigest,
      patchDigest: sc.patchCommitmentDigestHex({
        basisClock: 0,
        basisDigest: r1.basisDigest,
        patches: p1
      }),
      patches: p1
    });
    sc.saveSnapshotForBeaconClockSync(fs, 1, r1.state);
    sc.sealJournalThroughSidechainClockSync(fs, r1.state.clock, 1);

    const p2 = [{ op: 'add', path: '/b', value: 2 }];
    const r2 = sc.applyPatchesToState(r1.state, p2);
    sc.appendJournalEntrySync(fs, {
      basisClock: r1.state.clock,
      clock: r2.state.clock,
      basisDigest: r2.basisDigest,
      newDigest: r2.newDigest,
      patches: p2
    });

    const tipPayload = {
      clock: 1,
      sidechain: { clock: r1.state.clock, stateDigest: sc.stateDigest(r1.state) }
    };
    const resolved = sc.resolveStateForBeaconTip({
      tipPayload,
      snapshot: sc.loadSnapshotForBeaconClock(fs, 1),
      loadedState: r2.state,
      journalEntries: sc.loadJournalDoc(fs).entries,
      replayUnsealed: true
    });
    assert.strictEqual(resolved.source, 'snapshot');
    assert.strictEqual(resolved.unsealedApplied, 1);
    assert.strictEqual(resolved.state.content.a, 1);
    assert.strictEqual(resolved.state.content.b, 2);
    assert.strictEqual(resolved.state.clock, 2);
  });

  it('resolveStateForBeaconTip falls back to genesis when snapshot and digest missing', function () {
    const r = sc.resolveStateForBeaconTip({
      tipPayload: { clock: 9, sidechain: { stateDigest: 'dead' } },
      snapshot: null,
      loadedState: { version: 1, clock: 3, content: { x: 1 } },
      replayUnsealed: false
    });
    assert.strictEqual(r.source, 'genesis');
    assert.strictEqual(r.state.clock, 0);
    assert.ok(r.warning);
  });

  it('createSerializeQueue runs jobs in order', async function () {
    const run = sc.createSerializeQueue();
    const order = [];
    await Promise.all([
      run(async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); }),
      run(async () => { order.push(2); })
    ]);
    assert.deepStrictEqual(order, [1, 2]);
  });

  it('encode/parse SIDECHAIN_STATE_PATCH message', function () {
    const body = sc.encodeSidechainStatePatchMessage({
      basisClock: 0,
      basisDigest: 'aa',
      patches: [{ op: 'add', path: '/x', value: 1 }]
    });
    assert.strictEqual(body.type, sc.SIDECHAIN_STATE_PATCH_TYPE);
    const parsed = sc.parseSidechainStatePatchMessage(body);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.proposal.basisClock, 0);
  });

  it('verifyEpochChainFederationWitnesses fail-closed', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epoch = { clock: 1, height: 1 };
    const msg = Buffer.from(de.signingStringForBeaconEpoch(epoch), 'utf8');
    const good = {
      type: 'BEACON_EPOCH',
      payload: epoch,
      federationWitness: { signatures: { [key.pubkey]: key.signSchnorr(msg).toString('hex') } }
    };
    const bad = { type: 'BEACON_EPOCH', payload: epoch, federationWitness: null };
    assert.strictEqual(sc.verifyEpochChainFederationWitnesses([good], [key.pubkey], 1).ok, true);
    assert.strictEqual(sc.verifyEpochChainFederationWitnesses([bad], [key.pubkey], 1).ok, false);
  });

  it('parseDistributedManifestV1 includes sidechainPolicy', function () {
    const r = de.parseDistributedManifestV1({
      version: 1,
      programId: 'p',
      programHash: 'h',
      allowedMessageTypes: [sc.SIDECHAIN_STATE_PATCH_TYPE],
      sidechainPolicy: { allowedPathPrefixes: ['/app'], maxOps: 4 }
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.manifest.sidechainPolicy);
    assert.strictEqual(r.manifest.sidechainPolicy.maxOps, 4);
    assert.deepStrictEqual(r.manifest.sidechainPolicy.allowedPathPrefixes, ['/app']);
  });

  it('summarizeJournal and summarizeSnapshots for operator UI', function () {
    const store = new Map();
    const fs = {
      readFile: (name) => {
        const v = store.get(name);
        return v != null ? Buffer.from(v, 'utf8') : null;
      },
      writeFile: (name, content) => {
        store.set(name, typeof content === 'string' ? content : content.toString('utf8'));
        return true;
      }
    };

    const s0 = sc.createInitialState();
    const patches = [{ op: 'add', path: '/ui', value: true }];
    const applied = sc.applyPatchesToState(s0, patches);
    assert.ok(applied.ok);
    sc.appendJournalEntrySync(fs, {
      basisClock: 0,
      clock: applied.state.clock,
      basisDigest: applied.basisDigest,
      newDigest: applied.newDigest,
      patchDigest: sc.patchCommitmentDigestHex({
        basisClock: 0,
        basisDigest: applied.basisDigest,
        patches
      }),
      patches
    });
    sc.saveSnapshotForBeaconClockSync(fs, 3, applied.state);
    sc.sealJournalThroughSidechainClockSync(fs, applied.state.clock, 3);

    const openPatches = [{ op: 'add', path: '/open', value: 1 }];
    const open = sc.applyPatchesToState(applied.state, openPatches);
    sc.appendJournalEntrySync(fs, {
      basisClock: applied.state.clock,
      clock: open.state.clock,
      basisDigest: open.basisDigest,
      newDigest: open.newDigest,
      patches: openPatches
    });

    const journal = sc.summarizeJournal(fs, { limit: 10, includePatches: true });
    assert.strictEqual(journal.version, 1);
    assert.strictEqual(journal.path, sc.SIDECHAIN_JOURNAL_PATH);
    assert.strictEqual(journal.entryCount, 2);
    assert.strictEqual(journal.unsealedCount, 1);
    assert.ok(journal.entries.length >= 1);
    assert.ok(Array.isArray(journal.entries[0].patches));

    const snaps = sc.summarizeSnapshots(fs, { limit: 5, includeContent: true });
    assert.strictEqual(snaps.version, 1);
    assert.strictEqual(snaps.path, sc.SIDECHAIN_SNAPSHOTS_PATH);
    assert.strictEqual(snaps.snapshotCount, 1);
    assert.strictEqual(snaps.snapshots[0].beaconClock, 3);
    assert.strictEqual(snaps.snapshots[0].sidechainClock, applied.state.clock);
    assert.ok(snaps.snapshots[0].content);
    assert.strictEqual(snaps.snapshots[0].content.ui, true);
  });

  it('pruneSnapshotsForRemovedBeaconClocksSync drops listed clocks', function () {
    const store = new Map();
    const fs = {
      readFile: (name) => {
        const v = store.get(name);
        return v != null ? Buffer.from(v, 'utf8') : null;
      },
      writeFile: (name, content) => {
        store.set(name, typeof content === 'string' ? content : content.toString('utf8'));
        return true;
      }
    };
    sc.saveSnapshotForBeaconClockSync(fs, 1, { version: 1, clock: 1, content: {} });
    sc.saveSnapshotForBeaconClockSync(fs, 2, { version: 1, clock: 2, content: {} });
    sc.pruneSnapshotsForRemovedBeaconClocksSync(fs, [1]);
    assert.strictEqual(sc.loadSnapshotForBeaconClock(fs, 1), null);
    assert.ok(sc.loadSnapshotForBeaconClock(fs, 2));
  });
});
