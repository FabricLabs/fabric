'use strict';

const Fabric = require('../');
const assert = require('assert');

const samples = require('./fixtures/collection');

describe('@fabric/core/types/collection', function () {
  describe('Collection', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Collection instanceof Function, true);
    });

    it('starts as empty', async function () {
      const set = new Fabric.Collection();
      assert.equal(set.render(), '[]');
    });

    it('can hold a single entity', async function () {
      let set = new Fabric.Collection();
      set.push('test');
      // console.log('the set:', set);
      let populated = await set.populate();
      // console.log('populated:', populated);
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    it('can restore from an Array object', async function () {
      let set = new Fabric.Collection(['test']);
      let populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    it('can restore from a more complex Array object', async function () {
      let set = new Fabric.Collection(['test', { text: 'Hello, world!' }]);
      let populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test",{"text":"Hello, world!"}]');
    });

    it('manages a collection of objects', async function () {
      let set = new Fabric.Collection();

      set.push('Α');
      set.push('Ω');

      let populated = await set.populate();

      // console.log('set:', set);
      // console.log('populated:', populated);
      // console.log('rendered:', set.render());

      assert.equal(JSON.stringify(populated), '["Α","Ω"]');
      const expectedIDs = [new Fabric.Entity('Α').id, new Fabric.Entity('Ω').id];
      assert.equal(set.render(), JSON.stringify(expectedIDs));
    });

    it('getLatest is undefined on an empty collection', function () {
      const set = new Fabric.Collection();
      assert.strictEqual(set.getLatest(), undefined);
    });

    it('can import with commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.import(samples.list[0]);
      assert.equal(set.len, 1);
    });

    it('can import without commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.import(samples.list[0], false);
      assert.equal(set.len, 1);
    });

    it('can import list', async () => {
      let set = new Fabric.Collection();
      let res = await set.importList(samples.list);
      assert.equal(set.len, 3);
    });

    it('can create with commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.create(samples.list[0]);

      assert.equal(set.len, 1);
    });

    it('can create without commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.create(samples.list[0], false);

      assert.equal(set.len, 1);
    });

    // let converters = ['map', 'typedMap', 'toTypedArray', 'list'];
    let converters = ['map', 'typedMap', 'list'];

    converters.forEach(converter => {
      it('can convert to ' + converter, async () => {
        const set = new Fabric.Collection();
        await set.importList(samples.list);
        const converted = set[converter]();

        assert.ok(converted);
        const entries = Object.values(converted);
        assert.strictEqual(entries.length, samples.list.length);

        for (const sample of samples.list) {
          const matched = entries.find((item) => item.id === sample.id);
          assert.ok(matched, `missing converted item for ${sample.id}`);
          for (const k of Object.keys(sample)) {
            assert.strictEqual(matched[k], sample[k]);
          }
        }
      });
    });

    it('starts empty and exposes empty map/list views', function () {
      const set = new Fabric.Collection();
      assert.deepStrictEqual(set.map(), {});
      assert.deepStrictEqual(set.list(), {});
      assert.deepStrictEqual(set.typedMap(), {});
      assert.deepStrictEqual(set.toTypedArray(), []);
      assert.equal(set.len, 0);
    });

    it('can create and retrieve entities by id', async function () {
      const set = new Fabric.Collection({ name: 'widget' });
      const created = await set.create({ name: 'alpha', symbol: 'ALP' });

      assert.ok(created.id);
      assert.equal(set.len, 1);

      const fetched = set.getByID(created.id);
      assert.ok(fetched);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.name, 'alpha');
      assert.equal(fetched.symbol, 'ALP');
    });

    it('can import one item and import a list', async function () {
      const set = new Fabric.Collection({ name: 'sample' });

      const one = await set.import(samples.list[0], false);
      assert.equal(one.id, samples.list[0].id);
      assert.equal(set.len, 1);

      const ids = await set.importList(samples.list.slice(1));
      assert.equal(ids.length, 2);
      assert.equal(set.len, 3);
    });

    it('can find and convert imported entries', async function () {
      const set = new Fabric.Collection({ name: 'thing' });
      await set.importList([
        { id: 'a1', name: 'alpha', symbol: 'ALP' },
        { id: 'b2', name: 'beta', symbol: 'BET' }
      ]);

      const mapped = set.map();
      const ids = Object.keys(mapped);
      assert.equal(ids.length, 2);

      const foundByName = set.findByName('beta');
      assert.ok(foundByName);
      assert.equal(foundByName.symbol, 'BET');

      const foundByField = set.findByField('symbol', 'ALP');
      assert.ok(foundByField);
      assert.equal(foundByField.name, 'alpha');

      const foundBySymbol = set.findBySymbol('BET');
      assert.ok(foundBySymbol);
      assert.equal(foundBySymbol.name, 'beta');

      const matches = set.match({ symbol: 'ALP' });
      assert.equal(matches.length, 1);
      assert.equal(matches[0].name, 'alpha');

      const typed = set.toTypedArray();
      assert.equal(typed.length, 2);
    });

    it('can patch an existing target path', async function () {
      const set = new Fabric.Collection({ name: 'patch' });
      const created = await set.create({ id: 'p1', name: 'before' }, false);
      const link = `${set.path}/${created.id}`;

      const updated = await set._patchTarget(link, [
        { op: 'replace', path: '/name', value: 'after' }
      ]);

      const root = set.path.slice(1);
      assert.equal(updated[root][created.id].name, 'after');
      assert.equal(set.getByID(created.id).name, 'after');
    });

    it('covers accessors and map helpers', async function () {
      const set = new Fabric.Collection({ name: 'route' });
      set.settings.routes = ['/foo'];
      assert.deepStrictEqual(set.routes, ['/foo']);

      set._setKey('customId');
      assert.equal(set.settings.key, 'customId');
      set.path = '/route-custom';
      assert.equal(set.path, '/route-custom');
      set.path = '/routes';

      await set.importList([
        { id: 'x1', name: 'x' },
        { id: 'x2', name: 'y' }
      ]);

      const latest = set.getLatest();
      assert.ok(latest);
      assert.strictEqual(latest.id, 'x2');
      assert.strictEqual(latest.name, 'y');

      const queryResult = await set.query(`${set.path}/x1/name`);
      assert.strictEqual(queryResult, null);
      const rendered = set.render();
      assert.equal(typeof rendered, 'string');
      assert.equal(JSON.parse(rendered).length, 2);
      const typedMap = set.typedMap();
      assert.equal(Object.keys(typedMap).length, 2);

      const tree = set.asMerkleTree();
      assert.ok(tree);
      assert.ok(Buffer.isBuffer(tree.getRoot()));
    });

    it('can import from a map', async function () {
      const set = new Fabric.Collection({ name: 'map' });
      const ids = await set.importMap({
        a: { id: 'm1', name: 'alpha' },
        b: { id: 'm2', name: 'beta' }
      });

      assert.deepStrictEqual(ids, ['m1', 'm2']);
      assert.equal(set.len, 2);
    });

    it('supports custom create method and listener hook', async function () {
      let listenerCalled = false;
      const set = new Fabric.Collection({
        name: 'hook',
        deterministic: false,
        methods: {
          create: async function (input) {
            return {
              data: Object.assign({}, input, { transformed: true })
            };
          }
        },
        listeners: {
          create: async function () {
            listenerCalled = true;
          }
        }
      });

      const created = await set.create({ id: 'h1', name: 'hooked' });
      assert.equal(created.id.length, 64);
      assert.equal(created.transformed, true);
      assert.equal(created.name, 'hooked');
      assert.equal(typeof created.created, 'number');
      assert.equal(listenerCalled, true);
    });

    it('handles create commit failures without throwing', async function () {
      const set = new Fabric.Collection({ name: 'createfail' });
      const originalCommit = set.commit.bind(set);
      const originalError = console.error;
      let commitCalls = 0;
      let errorCalls = 0;

      set.commit = async function () {
        commitCalls++;
        if (commitCalls >= 2) throw new Error('commit-failed-create');
        return originalCommit();
      };

      console.error = function () {
        errorCalls++;
      };

      try {
        const created = await set.create({ id: 'cf1', name: 'create-fail' }, true);
        assert.equal(created.name, 'create-fail');
        assert.ok(errorCalls >= 1);
      } finally {
        console.error = originalError;
      }
    });

    it('handles import commit failures without throwing', async function () {
      const set = new Fabric.Collection({ name: 'importfail' });
      const originalCommit = set.commit.bind(set);
      const originalError = console.error;
      let commitCalls = 0;
      let errorCalls = 0;

      set.commit = async function () {
        commitCalls++;
        if (commitCalls >= 2) throw new Error('commit-failed-import');
        return originalCommit();
      };

      console.error = function () {
        errorCalls++;
      };

      try {
        const imported = await set.import({ id: 'if1', name: 'import-fail' }, true);
        assert.equal(imported.id, 'if1');
        assert.ok(errorCalls >= 1);
      } finally {
        console.error = originalError;
      }
    });

    it('covers verbosity, catch, and branch-heavy paths', async function () {
      class WrappedType {
        constructor (input) {
          this.payload = input;
        }
      }

      const set = new Fabric.Collection({
        name: 'branch',
        type: WrappedType,
        verbosity: 5
      });

      const originalLog = console.log;
      const originalError = console.error;
      let logCalls = 0;
      let errorCalls = 0;

      console.log = function () {
        logCalls++;
      };
      console.error = function () {
        errorCalls++;
      };

      try {
        const first = await set.create({ id: 'dup', name: 'duplicate' }, false);
        const second = await set.create({ id: 'dup', name: 'duplicate' }, false);
        assert.ok(first.id);
        assert.ok(second.id);

        // getByID true path + wrapped result branch
        const wrapped = set.getByID(first.id);
        assert.ok(wrapped instanceof WrappedType);

        // getByID null short-circuit path
        assert.strictEqual(set.getByID(null), null);

        // getByID catch path via invalid pointer token in id
        set.getByID('bad~token');

        // get() catch branch via invalid pointer path
        assert.strictEqual(set.get('/bad~path'), null);

        // import() path for input['@data'] and verbosity-only logging paths
        const imported = await set.import({
          '@data': { id: 'wrapped', name: 'wrapped-import' }
        }, false);
        assert.equal(imported.id, 'wrapped');

        // _patchTarget catch path with invalid op
        const patchResult = await set._patchTarget(set.path, [
          { op: 'bad-op', path: '/nope', value: 1 }
        ]);
        assert.strictEqual(patchResult, null);

        // push() commit catch path (throw on commit call)
        const originalCommit = set.commit.bind(set);
        set.commit = async function () {
          throw new Error('forced-push-commit-error');
        };
        const pushLen = await set.push({ id: 'p', name: 'push' }, true);
        assert.ok(pushLen >= 1);
        set.commit = originalCommit;

        // match() catch branch by forcing Array.filter to throw
        const originalFilter = Array.prototype.filter;
        Array.prototype.filter = function () {
          throw new Error('forced-filter-error');
        };
        try {
          const matchResult = set.match({ id: 'x' });
          assert.strictEqual(matchResult, null);
        } finally {
          Array.prototype.filter = originalFilter;
        }
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      assert.ok(logCalls >= 1);
      assert.ok(errorCalls >= 1);
    });

    it('covers remaining branch alternatives', async function () {
      const set = new Fabric.Collection({ name: 'branches2' });
      await set.importList([
        { id: 'd1', name: 'dup', symbol: 'SYM' },
        { id: 'd2', name: 'dup', symbol: 'SYM' }
      ]);

      // Exercise ternary branch where result is already set.
      assert.equal(set.findByField('name', 'dup').id, 'd1');
      assert.equal(set.findByName('dup').id, 'd1');
      assert.equal(set.findBySymbol('SYM').id, 'd1');

      // Exercise input.id || entity.id fallback branches in import().
      const importedNoId = await set.import({ title: 'no-id' }, false);
      assert.ok(importedNoId.id);

      // Exercise result.data || result fallback branches in create().
      const custom = new Fabric.Collection({
        name: 'plain',
        methods: {
          create: async function (input) {
            return Object.assign({}, input, { transformed: true });
          }
        }
      });
      const created = await custom.create({ label: 'plain-object' }, false);
      assert.ok(created.id);
    });
  });
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const Key = require('../types/key');
const Message = require('../types/message');
const { chatTextOf } = require('../functions/fabricChatText');
const {
  COLLECTION_TYPE,
  createCollection,
  ingest,
  ingestMany,
  ingestText,
  recordsFromJournalEntries,
  toJSON,
  fromJSON,
  toJSONL,
  fromJSONL,
  replay,
  replayFold,
  walkParentChain,
  merkleTreeOf,
  inclusionProof,
  nonInclusionProof,
  writeFile,
  readFile,
  runCli,
  parseFrame,
  verifyBodyHash,
  resolveCollectionFilePath
} = require('../functions/fabricMessageCollection');
const {
  createMemoryStore,
  ingestMessageBuffer,
  loadDoc,
  parseContractMessageBody
} = require('../functions/contractMessageAccumulate');
const {
  SIGN_TYPE,
  buildCrossSignObject
} = require('../functions/identityCrossSign');

function signContract (key, contractId, type, object) {
  const body = JSON.stringify({
    contract: contractId,
    type,
    object
  });
  return Message.fromVector(['CONTRACT_MESSAGE', body]).signWithKey(key);
}

function signChat (key, text) {
  return Message.fromVector(['P2P_CHAT_MESSAGE', text]).signWithKey(key);
}

describe('@fabric/core/functions/fabricMessageCollection', function () {
  const contractId = 'a'.repeat(64);

  it('round-trips AMP hex with a stable body hash', function () {
    const key = new Key();
    const msg = signChat(key, 'o7 from the shoutbox');
    const buf = msg.toBuffer();
    const collection = createCollection();
    const one = ingest(collection, buf, { origin: 'mesh', peer: 'hub.fabric.pub:7777' });
    assert.strictEqual(one.accepted, true);
    assert.strictEqual(one.record.hash.length, 64);
    assert.strictEqual(one.record.type, 'P2P_CHAT_MESSAGE');
    assert.strictEqual(one.record.hex, buf.toString('hex'));

    const restored = fromJSON(toJSON(collection));
    assert.strictEqual(restored.messages.length, 1);
    assert.strictEqual(restored.messages[0].hash, one.record.hash);
    assert.strictEqual(restored.messages[0].hex, one.record.hex);

    const jsonl = fromJSONL(toJSONL(collection));
    assert.strictEqual(jsonl.messages[0].hash, one.record.hash);
  });

  it('dedupes by body hash and skips a flipped header hash', function () {
    const key = new Key();
    const msg = signChat(key, 'same bytes twice');
    const buf = msg.toBuffer();
    const collection = createCollection();
    assert.strictEqual(ingest(collection, buf).accepted, true);
    assert.strictEqual(ingest(collection, `fabric:${buf.toString('hex')}`).duplicate, true);
    assert.strictEqual(collection.messages.length, 1);

    const flipped = Buffer.from(buf);
    flipped[80] ^= 0xff;
    const bad = ingest(collection, flipped);
    assert.strictEqual(bad.skipped, true);
    assert.strictEqual(bad.error, 'body-hash-mismatch');
    assert.strictEqual(collection.messages.length, 1);

    const tiny = ingest(collection, Buffer.alloc(10));
    assert.strictEqual(tiny.error, 'undersize');
  });

  it('replays shoutbox UTF-8 and CONTRACT_MESSAGE inner types in order', function () {
    const key = new Key();
    const chat = signChat(key, 'public mesh line');
    const pack = signContract(key, contractId, 'GroupDataShare', {
      type: 'GroupDataShare',
      groupId: 'grp-ops',
      packs: [{
        pack: 'chat.catalog',
        platform: 'discord',
        payload: { platform: 'discord', guilds: [{ id: 'g1', name: 'Fleet Ops' }] }
      }]
    });
    const cross = signContract(key, contractId, SIGN_TYPE, buildCrossSignObject({
      localPubkey: key.pubkey,
      peerPubkey: '02' + 'bb'.repeat(32),
      nonce: 'ab'.repeat(32)
    }));

    const collection = createCollection();
    ingestMany(collection, [chat, pack, cross], { origin: 'peer' });
    assert.strictEqual(collection.messages.length, 3);
    assert.strictEqual(collection.messages[1].appType, 'GroupDataShare');
    assert.strictEqual(collection.messages[2].appType, SIGN_TYPE);

    const texts = [];
    const types = [];
    const result = replay(collection, (ctx) => {
      types.push(ctx.inner && ctx.inner.type ? ctx.inner.type : ctx.message.type);
      if (ctx.message.type === 'P2P_CHAT_MESSAGE') {
        texts.push(chatTextOf(ctx.message.body));
      }
    });
    assert.strictEqual(result.applied, 3);
    assert.deepStrictEqual(texts, ['public mesh line']);
    assert.deepStrictEqual(types, ['P2P_CHAT_MESSAGE', 'GroupDataShare', SIGN_TYPE]);
  });

  it('replays a GroupJournalBatch-style fabricMessage.hex list', function () {
    const key = new Key();
    const change = signContract(key, contractId, 'GroupChange', {
      action: 'member.add',
      member: '02' + 'cc'.repeat(32)
    });
    const stored = ingest(createCollection(), change);
    const entries = [{
      id: 'gchg-1',
      type: 'GroupChange',
      clock: 1,
      fabricMessage: {
        hash: stored.record.hash,
        hex: stored.record.hex,
        type: 'GroupChange'
      }
    }];
    const claimed = recordsFromJournalEntries(entries);
    assert.strictEqual(claimed.length, 1);
    const honest = createCollection();
    const ok = ingest(honest, claimed[0]);
    assert.strictEqual(ok.accepted, true);
    assert.strictEqual(ok.record.appType, 'GroupChange');
    assert.strictEqual(ok.record.hash, stored.record.hash);

    const lying = createCollection();
    const mismatch = ingest(lying, { hash: 'deadbeef'.repeat(8).slice(0, 64), hex: stored.record.hex });
    assert.strictEqual(mismatch.error, 'hash-claim-mismatch');
  });

  it('collection root is order-sensitive; ARC tip fold is not', function () {
    const aKey = new Key();
    const bKey = new Key();
    const genesis = { signers: [aKey.pubkey, bKey.pubkey] };
    const m1 = signContract(aKey, contractId, 'GroupChange', {
      action: 'members.set',
      members: [aKey.pubkey, bKey.pubkey]
    });
    const m2 = signContract(bKey, contractId, 'GroupChat', {
      body: 'second',
      author: bKey.pubkey,
      ts: '2026-01-01T00:00:00.000Z'
    });

    const ab = createCollection();
    ingest(ab, m1);
    ingest(ab, m2);
    const ba = createCollection();
    ingest(ba, m2);
    ingest(ba, m1);
    assert.notStrictEqual(toJSON(ab).root, toJSON(ba).root);
    assert.strictEqual(toJSON(ab).count, 2);

    function foldIntoStore (collection) {
      const store = createMemoryStore();
      replay(collection, (ctx) => {
        ingestMessageBuffer(store, contractId, ctx.buffer, { origin: 'replay', genesis });
      });
      return loadDoc(store, contractId);
    }

    const docAB = foldIntoStore(ab);
    const docBA = foldIntoStore(ba);
    assert.strictEqual(docAB.entries.length, 2);
    assert.strictEqual(docBA.entries.length, 2);
    const hashesAB = docAB.entries.map((e) => e.hash).sort();
    const hashesBA = docBA.entries.map((e) => e.hash).sort();
    assert.deepStrictEqual(hashesAB, hashesBA);
  });

  it('save and restore a JSON file then fold GroupChat deterministically', function () {
    const key = new Key();
    const genesis = { signers: [key.pubkey] };
    const msg = signContract(key, contractId, 'GroupChat', {
      body: 'restore me',
      author: key.pubkey,
      ts: '2026-08-15T00:00:00.000Z'
    });
    const collection = createCollection();
    ingest(collection, msg, { origin: 'local' });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-msgcol-'));
    const file = path.join(dir, 'stream.json');
    writeFile(file, collection);
    const restored = readFile(file);

    const store = createMemoryStore();
    const folded = replayFold(restored, (state, ctx) => {
      const result = ingestMessageBuffer(state.store, contractId, ctx.buffer, {
        origin: 'replay',
        genesis
      });
      state.accepted += result.accepted ? 1 : 0;
      return state;
    }, { store, accepted: 0 });

    assert.strictEqual(folded.applied, 1);
    assert.strictEqual(folded.state.accepted, 1);
    const inner = parseContractMessageBody(Message.fromBuffer(Buffer.from(restored.messages[0].hex, 'hex')));
    assert.strictEqual(inner.type, 'GroupChat');
    assert.strictEqual(inner.object.body, 'restore me');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ingestText accepts a collection document and CLI collect/replay', function () {
    const key = new Key();
    const msg = signChat(key, 'cli line');
    const seed = createCollection();
    ingest(seed, msg);
    const collection = createCollection();
    const stats = ingestText(collection, JSON.stringify(toJSON(seed)));
    assert.strictEqual(stats.accepted, 1);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-msgcli-'));
    const file = path.join(dir, 'seed.json');
    fs.writeFileSync(file, JSON.stringify(toJSON(seed)));
    const chunks = [];
    const code = runCli(['collect', file], {
      stdout: { write (s) { chunks.push(s); return true; } },
      stderr: { write () { return true; } }
    });
    assert.strictEqual(code, 0);
    const collected = JSON.parse(chunks.join(''));
    assert.strictEqual(collected.type, COLLECTION_TYPE);
    assert.strictEqual(collected.count, 1);

    const replayOut = [];
    const replayCode = runCli(['verify', file], {
      stdout: { write (s) { replayOut.push(s); return true; } },
      stderr: { write () { return true; } }
    });
    assert.strictEqual(replayCode, 0);
    const verified = JSON.parse(replayOut.join(''));
    assert.strictEqual(verified.applied, 1);

    const help = [];
    const helpCode = runCli(['help'], {
      stdout: { write (s) { help.push(s); return true; } },
      stderr: { write () { return true; } }
    });
    assert.strictEqual(helpCode, 0);
    assert.ok(help.join('').includes('collect'));

    const missingErr = [];
    const missingCode = runCli(['collect', path.join(dir, 'no-such.json')], {
      stdout: { write () { return true; } },
      stderr: { write (s) { missingErr.push(s); return true; } }
    });
    assert.strictEqual(missingCode, 2);
    assert.ok(missingErr.join('').includes('read failed'));

    const parsed = parseFrame(msg.toBuffer());
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(verifyBodyHash(parsed.message), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects relative collection paths that escape cwd', function () {
    assert.strictEqual(resolveCollectionFilePath(''), null);
    assert.strictEqual(resolveCollectionFilePath('..\0secret.json'), null);
    assert.strictEqual(resolveCollectionFilePath('../etc/passwd'), null);
    const abs = path.join(os.tmpdir(), 'fabric-msgcol-ok.json');
    assert.strictEqual(resolveCollectionFilePath(abs), path.normalize(abs));
    const collection = createCollection();
    assert.throws(() => writeFile('../etc/passwd', collection), /invalid collection path/);
  });

  it('records parent/id, walks the chain, and proves merkle inclusion', function () {
    const key = new Key();
    const first = signChat(key, 'stack-one');
    const second = Message.fromVector(['P2P_CHAT_MESSAGE', 'stack-two', first]).signWithKey(key);
    const collection = createCollection();
    ingest(collection, first);
    ingest(collection, second);
    assert.strictEqual(collection.messages[0].genesis, true);
    assert.strictEqual(collection.messages[1].parent, first.id);
    assert.strictEqual(collection.messages[1].id, second.id);

    const walked = walkParentChain(collection.messages, second.id);
    assert.strictEqual(walked.length, 2);
    assert.strictEqual(walked[0].id, first.id);
    assert.strictEqual(walked[1].id, second.id);

    const doc = toJSON(collection);
    assert.ok(doc.merkleRoot && doc.merkleRoot.length === 64);
    const hit = inclusionProof(collection, second.id);
    assert.strictEqual(hit.included, true);
    const tree = merkleTreeOf(collection.messages);
    assert.ok(tree.verifyInclusion(hit));
    const gap = nonInclusionProof(collection, 'ab'.repeat(32));
    assert.strictEqual(gap.included, false);
    assert.ok(tree.verifyNonInclusion(gap));
  });
});
