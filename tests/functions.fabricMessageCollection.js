'use strict';

const assert = require('assert');
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
});
