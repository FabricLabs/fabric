'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  createMemoryStore,
  ingestMessageBuffer,
  ingestContractPublishBuffer,
  foldContractState,
  stateDigest,
  bufferFromPaste,
  tipFromDoc,
  loadDoc,
  normalizeGenesis,
  resolveMaxJournalEntries
} = require('../functions/contractMessageAccumulate');
const { pubkeyXOnly } = require('../functions/groupChatSeal');
const {
  signProposalVote
} = require('../functions/groupChangeGovernance');
const {
  OP_CONTRACT_SIGN,
  issueContractCapability
} = require('../functions/contractCapability');
const {
  createPending,
  markReceived,
  markReceipt,
  receiptSigningMessage,
  phaseFlags,
  allPhasesComplete,
  aggregatePhaseFlags,
  pendingForRelay
} = require('../functions/contractMessageCommit');
const { signContractMessage } = require('./fixtures/contractMessage');

describe('@fabric/core contractMessageAccumulate', function () {
  const contractId = 'c'.repeat(64);

  it('idempotent multi-origin ingest of the same AMP bytes', function () {
    const author = new Key();
    const genesis = { signers: [author.pubkey] };
    const msg = signContractMessage(author, contractId, 'GroupChat', {
      body: 'hello',
      author: author.pubkey,
      ts: '2026-01-01T00:00:00.000Z'
    });
    const buf = msg.toBuffer();
    const paste = `fabric:${buf.toString('hex')}`;

    const store = createMemoryStore();
    const a = ingestMessageBuffer(store, contractId, buf, { origin: 'mesh', genesis });
    assert.strictEqual(a.accepted, true);
    const b = ingestMessageBuffer(store, contractId, buf, { origin: 'queue', genesis });
    assert.strictEqual(b.duplicate, true);
    const c = ingestMessageBuffer(store, contractId, paste, { origin: 'paste', genesis });
    assert.strictEqual(c.duplicate, true);
    assert.strictEqual(a.tip.stateDigest, b.tip.stateDigest);
    assert.strictEqual(a.tip.stateDigest, c.tip.stateDigest);
    assert.strictEqual(a.tip.clock, 1);
    assert.strictEqual(loadDoc(store, contractId).entries.length, 1);
  });

  it('arrival-order independence across peers', function () {
    const aKey = new Key();
    const bKey = new Key();
    // Both authors must be authorized for GroupChat in any arrival order.
    const genesis = { signers: [aKey.pubkey, bKey.pubkey] };
    const m1 = signContractMessage(aKey, contractId, 'GroupChange', {
      action: 'members.set',
      members: [aKey.pubkey, bKey.pubkey]
    });
    const m2 = signContractMessage(aKey, contractId, 'GroupChat', { body: 'one', author: aKey.pubkey });
    const m3 = signContractMessage(bKey, contractId, 'GroupChat', { body: 'two', author: bKey.pubkey });
    const bufs = [m1.toBuffer(), m2.toBuffer(), m3.toBuffer()];

    const storeA = createMemoryStore();
    for (const buf of bufs) ingestMessageBuffer(storeA, contractId, buf, { origin: 'mesh', genesis });

    const storeB = createMemoryStore();
    for (const buf of [bufs[2], bufs[0], bufs[1]]) {
      ingestMessageBuffer(storeB, contractId, buf, { origin: 'mesh', genesis });
    }

    const storeC = createMemoryStore();
    ingestMessageBuffer(storeC, contractId, `fabric:${bufs[1].toString('hex')}`, { origin: 'paste', genesis });
    ingestMessageBuffer(storeC, contractId, bufs[0], { origin: 'queue', genesis });
    ingestMessageBuffer(storeC, contractId, bufs[2], { origin: 'mesh', genesis });

    const tipA = tipFromDoc(loadDoc(storeA, contractId));
    const tipB = tipFromDoc(loadDoc(storeB, contractId));
    const tipC = tipFromDoc(loadDoc(storeC, contractId));
    assert.strictEqual(tipA.stateDigest, tipB.stateDigest);
    assert.strictEqual(tipA.stateDigest, tipC.stateDigest);
    assert.strictEqual(tipA.clock, 3);
    assert.deepStrictEqual(tipA.content.members.slice().sort(), tipB.content.members.slice().sort());
  });

  it('publisher local accumulate matches paste-only participant', function () {
    const publisher = new Key();
    const peer = new Key();
    const genesis = { signers: [publisher.pubkey, peer.pubkey] };
    const out = signContractMessage(publisher, contractId, 'GroupChat', {
      body: 'from publisher',
      author: publisher.pubkey
    });
    const reply = signContractMessage(peer, contractId, 'GroupChat', {
      body: 'reply',
      author: peer.pubkey
    });

    const pubStore = createMemoryStore();
    ingestMessageBuffer(pubStore, contractId, out.toBuffer(), { origin: 'local', genesis });
    ingestMessageBuffer(pubStore, contractId, reply.toBuffer(), { origin: 'mesh', genesis });

    const partStore = createMemoryStore();
    ingestMessageBuffer(partStore, contractId, `fabric:${out.toBuffer().toString('hex')}`, { origin: 'paste', genesis });
    ingestMessageBuffer(partStore, contractId, reply.toBuffer(), { origin: 'mesh', genesis });

    assert.strictEqual(
      tipFromDoc(loadDoc(pubStore, contractId)).stateDigest,
      tipFromDoc(loadDoc(partStore, contractId)).stateDigest
    );
  });

  it('rejects wrong contract, bad signature, and leaves tip unchanged', function () {
    const author = new Key();
    const attacker = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [author.pubkey] };
    const good = signContractMessage(author, contractId, 'GroupChat', { body: 'ok' });
    ingestMessageBuffer(store, contractId, good.toBuffer(), { origin: 'mesh', genesis });
    const tip0 = tipFromDoc(loadDoc(store, contractId)).stateDigest;

    const wrongContract = signContractMessage(author, 'd'.repeat(64), 'GroupChat', { body: 'nope' });
    const badContract = ingestMessageBuffer(store, contractId, wrongContract.toBuffer(), { genesis });
    assert.strictEqual(badContract.accepted, false);
    assert.match(badContract.error, /mismatch/i);

    const forged = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChat',
      object: { body: 'evil' }
    })]).signWithKey(attacker);
    // Corrupt the BIP340 signature field (AMP trailer), not the JSON body.
    const signed = forged.toBuffer();
    const badBuf = Buffer.from(signed);
    // Signature is the last 64 bytes of the Fabric Message frame.
    assert.ok(badBuf.length > 64);
    badBuf[badBuf.length - 1] ^= 0xff;
    const badSig = ingestMessageBuffer(store, contractId, badBuf, { genesis });
    assert.strictEqual(badSig.accepted, false);
    assert.match(badSig.error, /invalid signature/i);

    assert.strictEqual(tipFromDoc(loadDoc(store, contractId)).stateDigest, tip0);
  });

  it('rejects frames larger than Peer MAX_MESSAGE_SIZE before parse', function () {
    const { HEADER_SIZE, MAX_MESSAGE_SIZE } = require('../constants');
    const store = createMemoryStore();
    const huge = Buffer.alloc(HEADER_SIZE + MAX_MESSAGE_SIZE + 1, 0xab);
    const res = ingestMessageBuffer(store, contractId, huge, {
      origin: 'paste',
      genesis: { signers: ['02' + '11'.repeat(32)] }
    });
    assert.strictEqual(res.accepted, false);
    assert.match(res.error, /MAX_MESSAGE_SIZE/);
  });

  it('rejects GroupChat from non-reader/non-signer', function () {
    const owner = new Key();
    const outsider = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey], readers: [owner.pubkey] };
    const bad = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(outsider, contractId, 'GroupChat', { body: 'spam' }).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(bad.accepted, false);
    assert.match(bad.error, /reader\/signer/i);
    assert.strictEqual(loadDoc(store, contractId).entries.length, 0);
  });

  it('rejects GroupChange from non-signer (F1)', function () {
    const owner = new Key();
    const attacker = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey] };

    const takeover = signContractMessage(attacker, contractId, 'GroupChange', {
      action: 'members.set',
      members: [attacker.pubkey]
    });
    const bad = ingestMessageBuffer(store, contractId, takeover.toBuffer(), {
      origin: 'mesh',
      genesis
    });
    assert.strictEqual(bad.accepted, false);
    assert.match(bad.error, /not authorized/i);
    assert.strictEqual(loadDoc(store, contractId).entries.length, 0);

    const ok = ingestMessageBuffer(store, contractId, signContractMessage(owner, contractId, 'GroupChange', {
      action: 'members.set',
      members: [owner.pubkey]
    }).toBuffer(), { origin: 'mesh', genesis });
    assert.strictEqual(ok.accepted, true);
    assert.deepStrictEqual(ok.tip.content.members, [pubkeyXOnly(owner.pubkey)]);
  });

  it('rejects governance/invite/journal-request spam from non-signers (tip integrity)', function () {
    const owner = new Key();
    const outsider = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey] };
    const tipBefore = () => {
      const doc = loadDoc(store, contractId);
      return tipFromDoc(doc);
    };

    for (const type of [
      'GroupChangeProposal',
      'GroupChangeVote',
      'FederationContractInvite',
      'FederationContractInviteResponse',
      'GroupJournalRequest'
    ]) {
      const bad = ingestMessageBuffer(
        store,
        contractId,
        signContractMessage(outsider, contractId, type, { note: 'spam' }).toBuffer(),
        { origin: 'mesh', genesis }
      );
      assert.strictEqual(bad.accepted, false, type);
      assert.match(bad.error, /not authorized|fail closed|genesis/i, type);
    }
    assert.strictEqual(loadDoc(store, contractId).entries.length, 0);
    assert.strictEqual(tipBefore().clock, 0);
  });

  it('rejects GroupChange with no genesis signers (fail closed)', function () {
    const anyone = new Key();
    const store = createMemoryStore();
    const res = ingestMessageBuffer(store, contractId, signContractMessage(anyone, contractId, 'GroupChange', {
      action: 'member.add',
      member: anyone.pubkey
    }).toBuffer(), { origin: 'mesh' });
    assert.strictEqual(res.accepted, false);
    assert.match(res.error, /genesis|fail closed/i);
  });

  it('accepts GroupChange via verified OP_CONTRACT_SIGN token', function () {
    const owner = new Key();
    const delegate = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey] };
    const tok = issueContractCapability({
      issuerKey: owner,
      subject: delegate.pubkey,
      contractId,
      capability: OP_CONTRACT_SIGN
    });
    const change = signContractMessage(delegate, contractId, 'GroupChange', {
      action: 'member.add',
      member: delegate.pubkey
    });
    const without = ingestMessageBuffer(store, contractId, change.toBuffer(), {
      origin: 'mesh',
      genesis
    });
    assert.strictEqual(without.accepted, false);

    const withTok = ingestMessageBuffer(store, contractId, change.toBuffer(), {
      origin: 'mesh',
      genesis,
      capabilityToken: tok
    });
    assert.strictEqual(withTok.accepted, true);
    assert.ok(withTok.tip.content.members.includes(pubkeyXOnly(delegate.pubkey)));
    assert.ok(withTok.tip.content.signers.includes(pubkeyXOnly(delegate.pubkey)));
  });

  it('reader-role GroupChange widens members but not signers', function () {
    const owner = new Key();
    const reader = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey] };
    const change = signContractMessage(owner, contractId, 'GroupChange', {
      action: 'member.add',
      member: reader.pubkey,
      role: 'reader'
    });
    const res = ingestMessageBuffer(store, contractId, change.toBuffer(), {
      origin: 'mesh',
      genesis
    });
    assert.strictEqual(res.accepted, true);
    assert.deepStrictEqual(res.tip.content.signers, []);
    assert.deepStrictEqual(res.tip.content.members, [pubkeyXOnly(reader.pubkey)]);

    // Owner already a signer via member.add (commutes with reader add under
    // hash-ordered fold). Avoid members.set here — a later-sorted set would
    // clear the reader and flake this assertion.
    const store2 = createMemoryStore();
    const seed = ingestMessageBuffer(store2, contractId, signContractMessage(owner, contractId, 'GroupChange', {
      action: 'member.add',
      member: owner.pubkey,
      role: 'signer'
    }).toBuffer(), { origin: 'mesh', genesis });
    assert.strictEqual(seed.accepted, true);
    const withReader = ingestMessageBuffer(store2, contractId, change.toBuffer(), {
      origin: 'mesh',
      genesis
    });
    assert.strictEqual(withReader.accepted, true);
    assert.deepStrictEqual(withReader.tip.content.signers, [pubkeyXOnly(owner.pubkey)]);
    assert.ok(withReader.tip.content.members.includes(pubkeyXOnly(owner.pubkey)));
    assert.ok(withReader.tip.content.members.includes(pubkeyXOnly(reader.pubkey)));
    assert.ok(!withReader.tip.content.signers.includes(pubkeyXOnly(reader.pubkey)));
  });

  it('rejects unknown body types and enforces genesis primitives', function () {
    const author = new Key();
    const store = createMemoryStore();
    const unknown = ingestMessageBuffer(store, contractId, signContractMessage(author, contractId, 'EvilCustom', {
      body: 'nope'
    }).toBuffer(), { origin: 'mesh' });
    assert.strictEqual(unknown.accepted, false);
    assert.match(unknown.error, /not allowed/i);

    const chat = signContractMessage(author, contractId, 'GroupChat', { body: 'hi' });
    const blocked = ingestMessageBuffer(store, contractId, chat.toBuffer(), {
      origin: 'mesh',
      genesis: {
        signers: [author.pubkey],
        primitives: { messageTypes: ['GroupChange'] }
      }
    });
    assert.strictEqual(blocked.accepted, false);
    assert.match(blocked.error, /not allowed/i);

    const emptyAllow = ingestMessageBuffer(store, contractId, chat.toBuffer(), {
      origin: 'mesh',
      genesis: {
        signers: [author.pubkey],
        primitives: { messageTypes: [] }
      }
    });
    assert.strictEqual(emptyAllow.accepted, false);
    assert.match(emptyAllow.error, /not allowed/i);
  });

  it('custom genesis messageTypes still require reader/signer membership', function () {
    const owner = new Key();
    const outsider = new Key();
    const store = createMemoryStore();
    const genesis = {
      signers: [owner.pubkey],
      primitives: { messageTypes: ['AppNote'] }
    };
    const spam = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(outsider, contractId, 'AppNote', { body: 'spam' }).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(spam.accepted, false);
    assert.match(spam.error, /reader\/signer|fail closed/i);

    const ok = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(owner, contractId, 'AppNote', { body: 'ok' }).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(ok.accepted, true, ok.error);
  });

  it('threads bitcoinBlockHash onto tip', function () {
    const author = new Key();
    const store = createMemoryStore();
    const hash = 'ab'.repeat(32);
    const res = ingestMessageBuffer(store, contractId, signContractMessage(author, contractId, 'GroupChat', {
      body: 'anchored'
    }).toBuffer(), {
      origin: 'mesh',
      genesis: { signers: [author.pubkey] },
      bitcoinBlockHash: hash,
      bitcoinHeight: 100
    });
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.tip.bitcoinBlockHash, hash);
    assert.strictEqual(res.tip.bitcoinHeight, 100);

    const bad = ingestMessageBuffer(store, contractId, signContractMessage(author, contractId, 'GroupChat', {
      body: 'bad-hash'
    }).toBuffer(), {
      origin: 'mesh',
      genesis: { signers: [author.pubkey] },
      bitcoinBlockHash: 'not-a-hash'
    });
    assert.strictEqual(bad.accepted, false);
    assert.match(bad.error, /bitcoinBlockHash/i);
  });

  it('bufferFromPaste accepts fabric: prefix', function () {
    const buf = Buffer.from('abcd', 'hex');
    assert.ok(bufferFromPaste(`fabric:${buf.toString('hex')}`).equals(buf));
  });

  it('foldContractState sorts by hash', function () {
    const entries = [
      { hash: 'bb', type: 'GroupChat', object: { body: 'b' } },
      { hash: 'aa', type: 'GroupChat', object: { body: 'a' } }
    ];
    const state = foldContractState(entries);
    assert.strictEqual(state.content.messages[0].body, 'a');
    assert.strictEqual(state.clock, 2);
    assert.ok(stateDigest(state));
  });

  it('MessageReceipt stores + relays without advancing tip digest; updates 2PC sidecar', function () {
    const a = new Key();
    const b = new Key();
    const genesis = { signers: [a.pubkey], readers: [a.pubkey, b.pubkey] };
    const chat = signContractMessage(a, contractId, 'GroupChat', {
      body: 'o7',
      author: a.pubkey,
      ts: '2026-01-01T00:00:00.000Z'
    });
    const store = createMemoryStore();
    const chatRes = ingestMessageBuffer(store, contractId, chat.toBuffer(), {
      origin: 'local',
      genesis
    });
    assert.strictEqual(chatRes.accepted, true);
    const tipBefore = chatRes.tip.stateDigest;
    const clockBefore = chatRes.tip.clock;
    assert.ok(store.get('contractmessagecommits', chatRes.entry.hash), 'sync filter opens pending 2PC');

    const wireHash = chatRes.entry.hash;
    const receiptSig = Buffer.from(b.signSchnorr(receiptSigningMessage(wireHash))).toString('hex');
    const receipt = signContractMessage(b, contractId, 'MessageReceipt', {
      messageId: wireHash,
      receiptAt: '2026-01-01T00:00:01.000Z',
      receiptSig
    });
    const rx = ingestMessageBuffer(store, contractId, receipt.toBuffer(), {
      origin: 'mesh',
      genesis
    });
    assert.strictEqual(rx.accepted, true, rx.error);
    assert.strictEqual(rx.entry.type, 'MessageReceipt');
    assert.ok(rx.entry.hex);
    assert.strictEqual(rx.tip.stateDigest, tipBefore);
    assert.strictEqual(rx.tip.clock, clockBefore);
    assert.strictEqual(loadDoc(store, contractId).entries.length, 2);
    assert.strictEqual(
      store.get('contractmessagecommits', rx.entry.hash),
      null,
      'ACK frames do not open a new pending row'
    );

    const sidecar = store.get('contractmessagecommits', wireHash);
    assert.ok(sidecar);
    assert.strictEqual(phaseFlags(sidecar, b.pubkey).receipt, true);
    assert.ok(Array.isArray(sidecar.ackMessages));
    assert.strictEqual(sidecar.ackMessages[0].type, 'MessageReceipt');
  });

  it('delivery sync filter tracks GroupChange and respects deliverySync.none', function () {
    const {
      isSyncTrackedType,
      ensureDeliveryPending
    } = require('../functions/contractMessageAccumulate');
    assert.strictEqual(isSyncTrackedType('GroupChange'), true);
    assert.strictEqual(isSyncTrackedType('GroupChat'), true);
    assert.strictEqual(isSyncTrackedType('MessageReceipt'), false);
    assert.strictEqual(isSyncTrackedType('GroupJournalRequest'), false);

    const a = new Key();
    const genesis = {
      signers: [a.pubkey],
      readers: [a.pubkey],
      primitives: { deliverySync: { mode: 'none' } }
    };
    const change = signContractMessage(a, contractId, 'GroupChange', {
      action: 'members.set',
      members: [a.pubkey]
    });
    const store = createMemoryStore();
    const res = ingestMessageBuffer(store, contractId, change.toBuffer(), {
      origin: 'local',
      genesis
    });
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(
      store.get('contractmessagecommits', res.entry.hash),
      null,
      'deliverySync.none skips pending 2PC'
    );
    assert.strictEqual(isSyncTrackedType('GroupChange', loadDoc(store, contractId), { genesis }), false);

    // include mode tracks only listed types
    const includeDoc = {
      genesis: normalizeGenesis({
        signers: [a.pubkey],
        primitives: { deliverySync: { mode: 'include', types: ['GroupShare'] } }
      })
    };
    assert.strictEqual(isSyncTrackedType('GroupChat', includeDoc), false);
    assert.strictEqual(isSyncTrackedType('GroupShare', includeDoc), true);
    assert.ok(ensureDeliveryPending);
  });

  it('threshold-1 GroupChangeProposal from a signer adopts member.add', function () {
    const owner = new Key();
    const recruit = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey], threshold: 1 };
    const proposal = {
      id: 'gprop-t1',
      contractId,
      action: 'member.add',
      member: recruit.pubkey,
      role: 'signer',
      proposedBy: pubkeyXOnly(owner.pubkey),
      createdAt: '2026-01-01T00:00:00.000Z',
      threshold: 1
    };
    const res = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(owner, contractId, 'GroupChangeProposal', proposal).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(res.accepted, true);
    const adopted = (res.tip.content.proposals || []).find((p) => p.id === 'gprop-t1');
    assert.ok(adopted);
    assert.strictEqual(adopted.status, 'adopted');
    assert.ok(res.tip.content.members.includes(pubkeyXOnly(recruit.pubkey)));
    assert.ok(res.tip.content.members.includes(pubkeyXOnly(owner.pubkey)));
    assert.ok(res.tip.content.signers.includes(pubkeyXOnly(recruit.pubkey)));
  });

  it('threshold-2 proposal stays pending until a BIP340 vote', function () {
    const a = new Key();
    const b = new Key();
    const recruit = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [a.pubkey, b.pubkey], threshold: 2 };
    const proposal = {
      id: 'gprop-t2',
      contractId,
      action: 'member.add',
      member: recruit.pubkey,
      role: 'signer',
      proposedBy: pubkeyXOnly(a.pubkey),
      createdAt: '2026-01-01T00:00:00.000Z',
      threshold: 2
    };
    const first = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(a, contractId, 'GroupChangeProposal', proposal).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(first.accepted, true);
    assert.strictEqual(first.tip.content.proposals[0].status, 'pending');
    assert.ok(!first.tip.content.members.includes(pubkeyXOnly(recruit.pubkey)));

    const signed = signProposalVote(b, proposal);
    const vote = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(b, contractId, 'GroupChangeVote', {
        proposalId: proposal.id,
        voter: pubkeyXOnly(b.pubkey),
        signature: signed.signature
      }).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(vote.accepted, true);
    assert.strictEqual(vote.tip.content.proposals[0].status, 'adopted');
    assert.ok(vote.tip.content.members.includes(pubkeyXOnly(recruit.pubkey)));
  });

  it('rejects GroupChangeVote with voter/AMP mismatch or bad signature', function () {
    const a = new Key();
    const b = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [a.pubkey, b.pubkey], threshold: 2 };
    const proposal = {
      id: 'gprop-bad',
      contractId,
      action: 'member.add',
      member: new Key().pubkey,
      proposedBy: pubkeyXOnly(a.pubkey),
      createdAt: '2026-01-01T00:00:00.000Z',
      threshold: 2
    };
    ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(a, contractId, 'GroupChangeProposal', proposal).toBuffer(),
      { origin: 'mesh', genesis }
    );
    const mismatch = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(b, contractId, 'GroupChangeVote', {
        proposalId: proposal.id,
        voter: pubkeyXOnly(a.pubkey),
        signature: 'ab'.repeat(64)
      }).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(mismatch.accepted, false);
    assert.match(mismatch.error, /voter must match/i);

    const badSig = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(b, contractId, 'GroupChangeVote', {
        proposalId: proposal.id,
        voter: pubkeyXOnly(b.pubkey),
        signature: 'ab'.repeat(64)
      }).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(badSig.accepted, false);
    assert.match(badSig.error, /invalid vote/i);
  });

  it('persists genesis from CONTRACT_PUBLISH so GroupChange needs no meta.genesis', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const definition = {
      name: 'ArcGenesisSeed',
      members: { signers: [owner.pubkey], threshold: 1 },
      primitives: { messageTypes: ['GroupChange', 'GroupChat'] }
    };
    const pub = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer());
    assert.strictEqual(seeded.accepted, true);
    assert.ok(seeded.contractId);
    const change = ingestMessageBuffer(
      store,
      seeded.contractId,
      signContractMessage(owner, seeded.contractId, 'GroupChange', {
        action: 'member.add',
        member: owner.pubkey
      }).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(change.accepted, true, change.error);
    assert.ok(change.tip.content.members.includes(pubkeyXOnly(owner.pubkey)));
  });

  it('persists genesis from field-encoded CONTRACT_PUBLISH (Message.fromFields)', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const definition = {
      name: 'ArcGenesisFields',
      members: { signers: [owner.pubkey], threshold: 1 },
      primitives: { messageTypes: ['GroupChange'] }
    };
    const pub = Message.fromFields('CONTRACT_PUBLISH', {
      definition: JSON.stringify(definition)
    }).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer());
    assert.strictEqual(seeded.accepted, true, seeded.error);
    assert.ok(seeded.contractId);
    const doc = loadDoc(store, seeded.contractId);
    assert.ok(doc.genesis.signers.includes(pubkeyXOnly(owner.pubkey)));
  });

  it('rejects field-encoded CONTRACT_PUBLISH with invalid definition JSON', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const pub = Message.fromFields('CONTRACT_PUBLISH', {
      definition: 'not-json{'
    }).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer());
    assert.strictEqual(seeded.accepted, false);
    assert.match(String(seeded.error || ''), /invalid publish body/);
  });

  it('rejects a JSON publish body that is an array', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const pub = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify([1, 2, 3])]).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer());
    assert.strictEqual(seeded.accepted, false);
    assert.match(String(seeded.error || ''), /invalid publish body/);
  });

  it('field-encoded publish then GroupChange without meta.genesis', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const definition = {
      name: 'FieldsThenChange',
      members: { signers: [owner.pubkey], threshold: 1 },
      primitives: { messageTypes: ['GroupChange', 'GroupChat'] }
    };
    const pub = Message.fromFields('CONTRACT_PUBLISH', {
      definition: JSON.stringify(definition)
    }).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer());
    assert.strictEqual(seeded.accepted, true, seeded.error);
    const change = ingestMessageBuffer(
      store,
      seeded.contractId,
      signContractMessage(owner, seeded.contractId, 'GroupChange', {
        action: 'member.add',
        member: owner.pubkey
      }).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(change.accepted, true, change.error);
    assert.ok(change.tip.content.members.includes(pubkeyXOnly(owner.pubkey)));
  });

  it('does not let meta.genesis replace the signed CONTRACT_PUBLISH body', function () {
    const owner = new Key();
    const attacker = new Key();
    const store = createMemoryStore();
    const definition = {
      name: 'SignedGenesisAuthoritative',
      members: { signers: [owner.pubkey], threshold: 1 }
    };
    const pub = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer(), {
      genesis: { signers: [attacker.pubkey], threshold: 1 }
    });
    assert.strictEqual(seeded.accepted, true, seeded.error);
    const doc = loadDoc(store, seeded.contractId);
    const expected = pubkeyXOnly(owner.pubkey);
    const unexpected = pubkeyXOnly(attacker.pubkey);
    assert.ok(doc.genesis.signers.includes(expected));
    assert.ok(!doc.genesis.signers.includes(unexpected));
  });

  it('does not let meta.signers replace the signed CONTRACT_PUBLISH body', function () {
    const owner = new Key();
    const attacker = new Key();
    const store = createMemoryStore();
    const definition = {
      name: 'SignedGenesisSignersAuthoritative',
      members: { signers: [owner.pubkey], threshold: 1 }
    };
    const pub = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(owner);
    const seeded = ingestContractPublishBuffer(store, pub.toBuffer(), {
      signers: [attacker.pubkey],
      threshold: 1
    });
    assert.strictEqual(seeded.accepted, true, seeded.error);
    const doc = loadDoc(store, seeded.contractId);
    const expected = pubkeyXOnly(owner.pubkey);
    const unexpected = pubkeyXOnly(attacker.pubkey);
    assert.ok(doc.genesis.signers.includes(expected));
    assert.ok(!doc.genesis.signers.includes(unexpected));
  });

  it('second GroupChange reuses stored genesis without meta.signers', function () {
    const owner = new Key();
    const other = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey] };
    const first = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(owner, contractId, 'GroupChange', {
        action: 'member.add',
        member: owner.pubkey
      }).toBuffer(),
      { origin: 'mesh', genesis }
    );
    assert.strictEqual(first.accepted, true);
    const second = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(owner, contractId, 'GroupChange', {
        action: 'member.add',
        member: other.pubkey
      }).toBuffer(),
      { origin: 'mesh' }
    );
    assert.strictEqual(second.accepted, true, second.error);
    assert.ok(second.tip.content.members.includes(pubkeyXOnly(other.pubkey)));
  });

  it('journal cap drops GroupChat by hash but keeps GroupChange', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const genesis = { signers: [owner.pubkey] };
    const change = ingestMessageBuffer(
      store,
      contractId,
      signContractMessage(owner, contractId, 'GroupChange', {
        action: 'members.set',
        members: [owner.pubkey]
      }).toBuffer(),
      { origin: 'mesh', genesis, maxJournalEntries: 3 }
    );
    assert.strictEqual(change.accepted, true);
    for (let i = 0; i < 5; i++) {
      ingestMessageBuffer(
        store,
        contractId,
        signContractMessage(owner, contractId, 'GroupChat', {
          body: `m${i}`,
          author: owner.pubkey,
          ts: `2026-01-0${i + 1}T00:00:00.000Z`
        }).toBuffer(),
        { origin: 'mesh', maxJournalEntries: 3 }
      );
    }
    const doc = loadDoc(store, contractId);
    assert.ok(doc.entries.length <= 3);
    assert.ok(doc.entries.some((e) => e.type === 'GroupChange'));
    assert.ok(doc.content.members.includes(pubkeyXOnly(owner.pubkey)));
  });

  it('prefers genesis journal cap over peer-local meta.maxJournalEntries', function () {
    const genesis = {
      primitives: { maxJournalEntries: 10 }
    };
    assert.strictEqual(
      resolveMaxJournalEntries({ genesis, maxJournalEntries: 8 }, { maxJournalEntries: 3 }),
      10
    );
    assert.strictEqual(
      resolveMaxJournalEntries({ maxJournalEntries: 8 }, { maxJournalEntries: 3 }),
      8
    );
    assert.strictEqual(
      resolveMaxJournalEntries({}, { maxJournalEntries: 3 }),
      3
    );
  });
});

describe('@fabric/core contractMessageCommit', function () {
  it('tracks per-reader received and receipt phases', function () {
    const a = new Key();
    const b = new Key();
    const record = createPending({
      id: 'm1',
      contractId: 'c'.repeat(64),
      readers: [a.pubkey, b.pubkey]
    });
    assert.deepStrictEqual(phaseFlags(record, a.pubkey), { received: false, receipt: false });
    markReceived(record, a.pubkey);
    assert.strictEqual(phaseFlags(record, a.pubkey).received, true);
    assert.strictEqual(aggregatePhaseFlags(record).received, false);
    markReceived(record, b.pubkey);
    assert.strictEqual(aggregatePhaseFlags(record).received, true);
    assert.strictEqual(allPhasesComplete(record), false);
    const msg = receiptSigningMessage(record.id);
    const sigA = Buffer.from(a.signSchnorr(msg)).toString('hex');
    const sigB = Buffer.from(b.signSchnorr(msg)).toString('hex');
    markReceipt(record, a.pubkey, null, sigA);
    markReceipt(record, b.pubkey, null, sigB);
    assert.strictEqual(allPhasesComplete(record), true);
    assert.deepStrictEqual(aggregatePhaseFlags(record), { received: true, receipt: true });
    assert.strictEqual(pendingForRelay([record]).length, 0);
  });

  it('rejects mark for non-reader', function () {
    const a = new Key();
    const outsider = new Key();
    const record = createPending({
      id: 'm2',
      contractId: 'c'.repeat(64),
      readers: [a.pubkey]
    });
    assert.throws(() => markReceived(record, outsider.pubkey), /reader set/);
  });

  it('rejects markReceipt without a valid BIP340 receiptSig', function () {
    const a = new Key();
    const record = createPending({
      id: 'm3',
      contractId: 'c'.repeat(64),
      readers: [a.pubkey]
    });
    markReceived(record, a.pubkey);
    assert.throws(() => markReceipt(record, a.pubkey), /receiptSig required/);
    assert.throws(() => markReceipt(record, a.pubkey, null, 'ab'.repeat(32)), /invalid receiptSig/);
    const wrong = Buffer.from(a.signSchnorr(receiptSigningMessage('other'))).toString('hex');
    assert.throws(() => markReceipt(record, a.pubkey, null, wrong), /invalid receiptSig/);
  });

  it('markReceived initializes peers map when missing (legacy records)', function () {
    const a = new Key();
    const x = require('../functions/groupChatSeal').pubkeyXOnly(a.pubkey);
    const record = {
      id: 'm4',
      contractId: 'c'.repeat(64),
      readers: [x],
      peers: null
    };
    markReceived(record, a.pubkey);
    assert.ok(record.peers && record.peers[x] && record.peers[x].receivedAt);
    assert.throws(() => markReceived(record, new Key().pubkey), /reader set|invalid reader/);
  });

  it('preserves public reader wildcard and fail-closes empty delivery-ack authz', function () {
    const {
      normalizePubkeyList,
      authorAllowedByReaders,
      authorizeIngest
    } = require('../functions/contractMessageAccumulate');
    const cid = 'c'.repeat(64);
    const readers = normalizePubkeyList(['*', '02' + 'ab'.repeat(32)]);
    assert.ok(readers.includes('*'));
    assert.strictEqual(authorAllowedByReaders(['*'], 'cd'.repeat(32)), true);
    assert.strictEqual(authorAllowedByReaders([], 'cd'.repeat(32)), false);

    const outsider = new Key();
    const doc = {
      id: cid,
      genesis: { signers: [], readers: [] },
      content: { members: [], signers: [] },
      entries: []
    };
    const denied = authorizeIngest(doc, 'MessageReceived', pubkeyXOnly(outsider.pubkey), {}, {
      messageId: 'ab'.repeat(32)
    });
    assert.strictEqual(denied.ok, false);
    assert.match(denied.error, /fail closed/i);

    const publicDoc = {
      id: cid,
      genesis: { signers: [], readers: ['*'] },
      content: { members: [], signers: [] },
      entries: []
    };
    const allowed = authorizeIngest(publicDoc, 'MessageReceived', pubkeyXOnly(outsider.pubkey), {}, {
      messageId: 'ab'.repeat(32)
    });
    assert.strictEqual(allowed.ok, true);
  });
});
