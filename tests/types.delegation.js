'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Message = require('../types/message');
const Delegation = require('../types/delegation');
const {
  DELEGATION_LINK_OFFER,
  DELEGATION_MAILBOX_FETCH,
  FIXTURE_SEED
} = require('../constants');
const { encodeFabricUri } = require('../functions/fabricUri');
const { importSeed, deriveAccount } = require('../functions/accountKeys');
const { classifyGossipWireType, isPublicGossipFloodType } = require('../functions/gossipNetwork');
const { createChallenge, verifyAssertion } = require('../functions/passport');

const d = Delegation;

const MASTER = importSeed(FIXTURE_SEED);
const PASSPORT = deriveAccount(MASTER, { account: 0, network: 'regtest' });
const HUB = deriveAccount(MASTER, { account: 1, network: 'regtest' });
const OTHER = deriveAccount(MASTER, { account: 2, network: 'regtest' });
const SITE = 'https://goon.vc';

const NOW = 1_800_000_000_000;
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

const TYPES = [
  'DELEGATION_LINK_OFFER',
  'DELEGATION_LINK_ANSWER',
  'DELEGATION_LINK_REVEAL',
  'DELEGATION_GRANT',
  'DELEGATION_REVOKE',
  'DELEGATION_REQUEST',
  'DELEGATION_RESULT',
  'DELEGATION_MAILBOX_FETCH'
];

/** Pair PASSPORT (initiator) with HUB (responder). */
function pair (now = NOW) {
  const offer = d.createLinkOffer({ origin: 'https://hub.fabric.pub', label: 'Passport', network: 'regtest', now }, PASSPORT.identity.key);
  const answer = d.createLinkAnswer({ offer: offer.uri, label: 'Hub', now: now + 10 }, HUB.identity.key);
  const reveal = d.createLinkReveal({ offer: offer.uri, answer: answer.uri, nonce: offer.nonce, now: now + 20 }, PASSPORT.identity.key);
  return { offer, answer, reveal };
}

function hubGrant (params = {}) {
  return d.createGrant(Object.assign({
    grantee: PASSPORT.identity.pubkey,
    scopes: ['passport', 'message'],
    cosignerKey: HUB.cosigner.key,
    extensionOrigin: EXT,
    label: 'Hub',
    now: NOW
  }, params), HUB.identity.key);
}

function challenge (params = {}) {
  return createChallenge(Object.assign({ origin: SITE, network: 'regtest', request: ['wallet'], now: NOW }, params));
}

function federationFrame (body, key = OTHER.cosigner.key) {
  return Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]).signWithKey(key);
}

/** Pair two participants; returns both sides' link ids and the code. */
async function link (a, b) {
  const offer = await a.offer({ origin: 'https://hub.fabric.pub', label: 'Passport', network: 'regtest' });
  const answer = await b.answer(offer.uri, { label: 'Hub' });
  const revealed = await a.receive(answer.uri);
  assert.strictEqual(revealed.ok, true, revealed.error);
  const confirmed = await b.receive(revealed.reveal);
  assert.strictEqual(confirmed.ok, true, confirmed.error);
  assert.strictEqual(confirmed.sas, revealed.sas);
  return { linkId: offer.linkId, sas: revealed.sas };
}

describe('@fabric/core/types/delegation', function () {
  this.timeout(30000);

  it('requires a private key', function () {
    assert.throws(() => new Delegation({}), /private key/);
  });

  it('pairs, grants, asks, notifies, and answers a Passport sign-in', async function () {
    const passport = new Delegation({ key: PASSPORT.identity.key });
    const hub = new Delegation({ key: HUB.identity.key });
    const { linkId, sas } = await link(passport, hub);
    assert.match(sas, /^[0-9]{6}$/);
    assert.strictEqual(await passport.sasFor(linkId), sas);
    await passport.confirmLink(linkId);
    const links = await passport.links();
    assert.strictEqual(links[0].status, 'confirmed');
    assert.strictEqual(links[0].peerLabel, 'Hub');

    const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['passport', 'identity'], link: linkId, cosignerKey: HUB.cosigner.key, label: 'Hub' });
    assert.strictEqual((await passport.receive(grant.uri)).ok, true);
    const back = await passport.grant({ grantee: HUB.identity.pubkey, scopes: ['identity'], link: linkId });
    assert.strictEqual((await hub.receive(back.uri)).ok, true);
    assert.deepStrictEqual(await passport.identityPeers(), [HUB.identity.pubkey]);
    assert.deepStrictEqual(await hub.identityPeers(), [PASSPORT.identity.pubkey]);

    const notified = [];
    hub.on('request', (event) => notified.push(event.notification));
    const c = createChallenge({ origin: SITE, network: 'regtest', request: ['wallet'] });
    const req = await passport.request({ target: HUB.identity.pubkey, request: c.uri, origin: SITE, disclose: ['wallet'] });
    assert.strictEqual(req.scope, 'passport');
    const received = await hub.receive(req.uri);
    assert.strictEqual(received.ok, true, received.error);
    assert.strictEqual(notified.length, 1);
    assert.strictEqual(notified[0].title, 'Sign in to goon.vc');
    assert.strictEqual(notified[0].from.label, 'Passport');

    const dupe = await hub.receive(req.uri);
    assert.strictEqual(dupe.duplicate, true);
    assert.strictEqual(notified.length, 1);

    const [pending] = await hub.pending();
    assert.strictEqual(pending.hash, req.hash);
    const assertion = d.answerPassport(pending.read, { signer: 'hub', network: 'regtest', wallet: HUB.wallet }, HUB.identity.key);
    const result = await hub.sign(pending.hash, assertion.uri, { rule: 'goon-sign-in' });
    assert.deepStrictEqual(await hub.pending(), []);
    await assert.rejects(() => hub.decline(pending.hash), /already signed/);

    const results = [];
    passport.on('result', (event) => results.push(event));
    const got = await passport.receive(result.uri);
    assert.strictEqual(got.ok, true, got.error);
    assert.strictEqual(results.length, 1);
    assert.strictEqual((await passport.outboxItem(req.hash)).status, 'signed');
    const v = verifyAssertion(got.result.answer.uri, { origin: SITE, nonce: c.nonce, challengeHash: c.hash, network: 'regtest', allow: c.request, challengeExpiresAt: c.expiresAt });
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.device, PASSPORT.identity.pubkey);
    assert.strictEqual((await hub.inboxItem(req.hash)).rule, 'goon-sign-in');
  });

  it('refuses requests without a grant, and after the grant is revoked', async function () {
    const passport = new Delegation({ key: PASSPORT.identity.key });
    const hub = new Delegation({ key: HUB.identity.key });
    await assert.rejects(() => passport.request({ target: HUB.identity.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'hi']) }), /no message grant/);

    const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
    await passport.receive(grant.uri);
    const first = await passport.request({ target: HUB.identity.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'one']) });
    assert.strictEqual((await hub.receive(first.uri)).ok, true);

    const revoke = await hub.revoke(grant.hash);
    const revoked = [];
    passport.on('revoke', (event) => revoked.push(event));
    assert.strictEqual((await passport.receive(revoke.uri)).ok, true);
    assert.strictEqual(revoked.length, 1);
    assert.deepStrictEqual(await passport.grants('received'), []);

    // A request made under the revoked grant (sent before the revoke arrived) is refused.
    const stale = d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'two']) }, PASSPORT.identity.key);
    assert.match((await hub.receive(stale.uri)).error, /revoked/);
  });

  it('revoking a grant drops requests that were already waiting and refuses to sign them', async function () {
    const passport = new Delegation({ key: PASSPORT.identity.key });
    const hub = new Delegation({ key: HUB.identity.key });
    const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
    await passport.receive(grant.uri);
    const req = await passport.request({ target: HUB.identity.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'sign me']) });
    await hub.receive(req.uri);
    const [pending] = await hub.pending();
    assert.ok(pending);
    await hub.revoke(grant.hash);
    assert.deepStrictEqual(await hub.pending(), []);
    const answer = d.answerMessage(pending.read, HUB.identity.key);
    await assert.rejects(() => hub.sign(pending.hash, answer), /revoked/);
  });

  it('the host does not record an answer to another request', async function () {
    const passport = new Delegation({ key: PASSPORT.identity.key });
    const hub = new Delegation({ key: HUB.identity.key });
    const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
    await passport.receive(grant.uri);
    const req = await passport.request({ target: HUB.identity.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'sign me']) });
    await hub.receive(req.uri);
    const [pending] = await hub.pending();
    const other = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'pay me']) }, PASSPORT.identity.key).uri);
    await assert.rejects(() => hub.sign(pending.hash, d.answerMessage(other, HUB.identity.key)), /another message/);
    assert.strictEqual((await hub.pending()).length, 1, 'the request is still pending');
    const result = await hub.sign(pending.hash, d.answerMessage(pending.read, HUB.identity.key));
    assert.strictEqual((await passport.receive(result.uri)).ok, true);
  });

  it('only the grantor revokes, and only the asked participant answers', async function () {
    const passport = new Delegation({ key: PASSPORT.identity.key });
    const hub = new Delegation({ key: HUB.identity.key });
    const mallory = new Delegation({ key: OTHER.identity.key });
    const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
    await passport.receive(grant.uri);
    const forged = d.createRevoke({ grant: grant.hash }, OTHER.identity.key);
    assert.match((await passport.receive(forged.uri)).error, /only the grantor/);

    const req = await passport.request({ target: HUB.identity.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'sign me']) });
    const fake = d.createResult({ request: req.hash, refusal: 'no' }, OTHER.identity.key);
    assert.match((await passport.receive(fake.uri)).error, /not from the participant asked/);
    assert.match((await mallory.receive(req.uri)).error, /another participant/);

    await hub.receive(req.uri);
    const [pending] = await hub.pending();
    // The hub cannot answer with a frame signed by someone else.
    const foreign = Message.fromVector(['P2P_CHAT_MESSAGE', 'sign me']).signWithKey(OTHER.identity.key);
    await assert.rejects(() => hub.sign(pending.hash, foreign), /identity or granted cosigner/);
    const ok = await hub.sign(pending.hash, d.answerMessage(pending.read, HUB.identity.key));
    assert.strictEqual((await passport.receive(ok.uri)).ok, true);
  });

  it('declines, and keeps every frame in its own store', async function () {
    const store = Delegation.memoryStore();
    const passport = new Delegation({ key: PASSPORT.identity.key });
    const hub = new Delegation({ key: HUB.identity.key, store });
    const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
    await passport.receive(grant.uri);
    const req = await passport.request({ target: HUB.identity.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'x']) });
    await hub.receive(req.uri);
    const declined = await hub.decline(req.hash, 'not today');
    const got = await passport.receive(declined.uri);
    assert.strictEqual(got.result.refusal, 'not today');
    assert.strictEqual((await passport.outboxItem(req.hash)).status, 'declined');

    // A fresh instance on the same store sees the same state.
    const reopened = new Delegation({ key: HUB.identity.key, store });
    assert.strictEqual((await reopened.inboxItem(req.hash)).status, 'declined');
    const frames = await reopened.frames();
    assert.deepStrictEqual(frames.map((f) => f.type), ['DELEGATION_GRANT', 'DELEGATION_REQUEST', 'DELEGATION_RESULT']);
    assert.ok(frames.every((f) => /^[0-9a-f]{64}$/.test(f.hash) && f.hex));
  });

  it('serializes concurrent writes', async function () {
    const passport = new Delegation({ key: PASSPORT.identity.key });
    const hub = new Delegation({ key: HUB.identity.key });
    const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
    await passport.receive(grant.uri);
    const requests = [];
    for (let i = 0; i < 5; i++) requests.push(await passport.request({ target: HUB.identity.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', `n${i}`]) }));
    const results = await Promise.all(requests.map((r) => hub.receive(r.uri)));
    assert.ok(results.every((r) => r.ok));
    assert.strictEqual((await hub.pending()).length, 5);
  });
});

describe('@fabric/core/types/delegation frames', function () {
  this.timeout(30000);

  it('registers the eight opcodes with field schemas, Hub-scoped and never flooded', function () {
    assert.strictEqual(DELEGATION_LINK_OFFER, 0x4243);
    assert.strictEqual(DELEGATION_MAILBOX_FETCH, 0x424A);
    for (const type of TYPES) {
      assert.ok(Message.getBodySchema(type), type);
      assert.strictEqual(Message.canonicalTypeName(Message.canonicalTypeCode(type)), type);
      assert.strictEqual(classifyGossipWireType(type), 'hub', type);
      assert.strictEqual(isPublicGossipFloodType(type), false, type);
    }
    assert.strictEqual(Message.getBodySchema('PASSPORT_SIGN_REQUEST'), null);
  });

  describe('pairing', function () {
    it('shows the same six-digit code on both sides after the reveal', function () {
      const { offer, answer, reveal } = pair();
      assert.match(reveal.sas, /^[0-9]{6}$/);
      const checked = d.verifyLink({ offer: offer.uri, answer: answer.uri, reveal: reveal.uri }, { now: NOW + 30 });
      assert.strictEqual(checked.ok, true, checked.error);
      assert.strictEqual(checked.sas, reveal.sas);
      assert.strictEqual(checked.linkId, offer.linkId);
      assert.strictEqual(checked.initiator, PASSPORT.identity.pubkey.slice(2));
      assert.strictEqual(checked.responder, HUB.identity.pubkey.slice(2));
      assert.deepStrictEqual(checked.labels, { initiator: 'Passport', responder: 'Hub' });
      assert.deepStrictEqual(checked.pubkeys, { initiator: PASSPORT.identity.pubkey, responder: HUB.identity.pubkey });
    });

    it('offers and answers name their author\'s compressed key, so either side can grant after the code', function () {
      const { offer, answer } = pair();
      assert.strictEqual(d.readLinkOffer(offer.uri, { now: NOW + 30 }).pubkey, PASSPORT.identity.pubkey);
      assert.strictEqual(d.readLinkAnswer(answer.uri, { now: NOW + 30 }).pubkey, HUB.identity.pubkey);
      const forged = Message.fromFields('DELEGATION_LINK_OFFER', Object.assign(Message.fromBuffer(offer.message.toBuffer()).toFields(), { pubkey: OTHER.identity.pubkey }));
      forged.signWithKey(PASSPORT.identity.key);
      assert.match(d.readLinkOffer(forged.toBuffer(), { now: NOW + 30 }).error, /does not match/);
    });

    it('the offer commits to its nonce: no other nonce reveals it', function () {
      const { offer, answer } = pair();
      assert.throws(() => d.createLinkReveal({ offer: offer.uri, answer: answer.uri, nonce: 'ab'.repeat(32), now: NOW + 20 }, PASSPORT.identity.key), /commitment/);
      const offer2 = d.createLinkOffer({ origin: 'https://hub.fabric.pub', now: NOW }, PASSPORT.identity.key);
      assert.notStrictEqual(offer2.commitment, offer.commitment);
    });

    it('a man in the middle gets a different code', function () {
      // Fixed nonces, so the two codes are the same on every run.
      const offer = d.createLinkOffer({ origin: 'https://hub.fabric.pub', label: 'Passport', network: 'regtest', nonce: '11'.repeat(32), now: NOW }, PASSPORT.identity.key);
      const answer = d.createLinkAnswer({ offer: offer.uri, label: 'Hub', nonce: '22'.repeat(32), now: NOW + 10 }, HUB.identity.key);
      // Mallory answers in HUB's place with her own key.
      const mallory = d.createLinkAnswer({ offer: offer.uri, label: 'Hub', nonce: '33'.repeat(32), now: NOW + 10 }, OTHER.identity.key);
      const toMallory = d.createLinkReveal({ offer: offer.uri, answer: mallory.uri, nonce: offer.nonce, now: NOW + 20 }, PASSPORT.identity.key);
      const honest = d.createLinkReveal({ offer: offer.uri, answer: answer.uri, nonce: offer.nonce, now: NOW + 20 }, PASSPORT.identity.key);
      assert.notStrictEqual(toMallory.sas, honest.sas);
    });

    it('refuses a reveal by another key, a mismatched answer, and an expired offer', function () {
      const { offer, answer, reveal } = pair();
      const other = pair();
      assert.strictEqual(d.verifyLink({ offer: offer.uri, answer: answer.uri, reveal: other.reveal.uri }, { now: NOW + 30 }).ok, false);
      assert.strictEqual(d.verifyLink({ offer: offer.uri, answer: other.answer.uri, reveal: reveal.uri }, { now: NOW + 30 }).ok, false);
      assert.match(d.readLinkOffer(offer.uri, { now: NOW + 5 * 60 * 1000 }).error, /expired/);
      assert.throws(() => d.createLinkAnswer({ offer: offer.uri, now: NOW }, PASSPORT.identity.key), /itself/);
    });

    it('keeps link frames to three minutes at most', function () {
      const offer = d.createLinkOffer({ origin: SITE, ttlMs: 10 * 60 * 1000, now: NOW }, PASSPORT.identity.key);
      assert.ok(offer.expiresAt <= NOW + 3 * 60 * 1000);
    });
  });

  describe('grants', function () {
    it('round-trips a grant and checks its cosigner proof', function () {
      const g = hubGrant({ origins: [SITE], networks: ['regtest'] });
      const read = d.readGrant(g.uri, { now: NOW + 1 });
      assert.strictEqual(read.ok, true, read.error);
      assert.strictEqual(read.grant.grantor, HUB.identity.pubkey);
      assert.strictEqual(read.grant.grantee, PASSPORT.identity.pubkey);
      assert.deepStrictEqual(read.grant.scopes, ['passport', 'message']);
      assert.deepStrictEqual(read.grant.origins, [SITE]);
      assert.deepStrictEqual(read.grant.networks, ['regtest']);
      assert.strictEqual(read.grant.cosigner, HUB.cosigner.pubkey);
      assert.strictEqual(read.grant.extensionOrigin, EXT);
      assert.strictEqual(read.hash, g.hash);
    });

    it('refuses unknown scopes, an identity key posing as cosigner, and bad extension origins', function () {
      assert.throws(() => hubGrant({ scopes: ['everything'] }), /scope/);
      assert.throws(() => hubGrant({ cosignerKey: HUB.identity.key }), /identity key/);
      assert.throws(() => hubGrant({ extensionOrigin: 'https://evil.example' }), /extension/);
    });

    it('refuses a grant whose cosigner proof was made for another grantee', function () {
      const g = hubGrant();
      const fields = Message.fromBuffer(d.readGrant(g.uri, { now: NOW }).buffer).toFields();
      const forged = Message.fromFields('DELEGATION_GRANT', Object.assign({}, fields, { grantee: OTHER.identity.pubkey }));
      forged.signWithKey(HUB.identity.key);
      assert.match(d.readGrant(encodeFabricUri(forged), { now: NOW }).error, /cosigner proof/);
    });

    it('a revoke names the grant; mutual identity grants link two participants', function () {
      const a = d.readGrant(d.createGrant({ grantee: PASSPORT.identity.pubkey, scopes: ['identity'], now: NOW }, HUB.identity.key).uri, { now: NOW });
      const b = d.readGrant(d.createGrant({ grantee: HUB.identity.pubkey, scopes: ['identity'], now: NOW }, PASSPORT.identity.key).uri, { now: NOW });
      assert.deepStrictEqual(d.identityPeers(PASSPORT.identity.pubkey, [a, b]), [HUB.identity.pubkey]);
      assert.deepStrictEqual(d.identityPeers(PASSPORT.identity.pubkey, [a]), []);
      const revoke = d.readRevoke(d.createRevoke({ grant: a.hash, now: NOW + 5 }, HUB.identity.key).uri, { now: NOW + 6 });
      assert.strictEqual(revoke.ok, true, revoke.error);
      assert.strictEqual(revoke.revoke.grant, a.hash);
      assert.deepStrictEqual(d.identityPeers(PASSPORT.identity.pubkey, [a, b], [a.hash]), []);
    });
  });

  describe('requests', function () {
    it('a Passport sign-in: request, authorize, notify, answer, verify', function () {
      const grant = d.readGrant(hubGrant({ origins: [SITE] }).uri, { now: NOW });
      const c = challenge();
      const req = d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: c.uri, origin: SITE, disclose: ['wallet'], now: NOW + 100 }, PASSPORT.identity.key);
      assert.ok(req.expiresAt <= c.expiresAt, 'a request never outlives its challenge');
      const read = d.readRequest(req.uri, { now: NOW + 200 });
      assert.strictEqual(read.ok, true, read.error);
      assert.strictEqual(read.scope, 'passport');
      assert.deepStrictEqual(read.request.disclose, ['wallet']);

      const auth = d.authorize(read, [grant]);
      assert.strictEqual(auth.ok, true, auth.error);

      const note = d.notificationFor(read, { label: 'Passport' });
      assert.strictEqual(note.kind, 'DelegationRequest');
      assert.strictEqual(note.title, 'Sign in to goon.vc');
      assert.deepStrictEqual(note.actions, ['sign', 'decline']);
      assert.strictEqual(note.request, read.hash);

      const a = d.answerPassport(read, { signer: 'hub', network: 'regtest', wallet: HUB.wallet, now: NOW + 300 }, HUB.identity.key);
      const v = verifyAssertion(a.uri, { origin: SITE, nonce: c.nonce, challengeHash: c.hash, network: 'regtest', allow: c.request, challengeExpiresAt: c.expiresAt, now: NOW + 400 });
      assert.strictEqual(v.ok, true, v.error);
      assert.strictEqual(v.device, PASSPORT.identity.pubkey);

      const result = d.createResult({ request: read.hash, answer: a.uri, now: NOW + 500 }, HUB.identity.key);
      const back = d.readResult(result.uri, { now: NOW + 600 });
      assert.strictEqual(back.ok, true, back.error);
      assert.strictEqual(back.result.request, read.hash);
      assert.strictEqual(back.result.answer.type, 'PASSPORT_ASSERTION');
      assert.strictEqual(back.result.answer.author, HUB.identity.pubkey.slice(2));
    });

    it('authorization comes only from the target\'s grants', function () {
      const grant = d.readGrant(hubGrant({ origins: ['https://hub.fabric.pub'], networks: ['regtest'] }).uri, { now: NOW });
      const c = challenge();
      const read = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: c.uri, origin: SITE, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.match(d.authorize(read, [grant]).error, /does not cover https:\/\/goon.vc/);
      assert.match(d.authorize(read, []).error, /no grant/);
      const wide = d.readGrant(hubGrant({ now: NOW + 1 }).uri, { now: NOW + 2 });
      const underWide = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: wide.hash, request: c.uri, origin: SITE, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 3 });
      assert.strictEqual(d.authorize(underWide, [wide]).ok, true);
      assert.match(d.authorize(underWide, [wide], { revoked: [wide.hash] }).error, /revoked/);
      // A third key holding the request hash learns nothing: the grant names the grantee.
      const stolen = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: wide.hash, request: c.uri, origin: SITE, now: NOW }, OTHER.identity.key).uri, { now: NOW + 3 });
      assert.match(d.authorize(stolen, [wide]).error, /another participant/);
      // Scope the grant does not cover.
      const identityOnly = d.readGrant(d.createGrant({ grantee: PASSPORT.identity.pubkey, scopes: ['identity'], now: NOW }, HUB.identity.key).uri, { now: NOW });
      const outOfScope = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: identityOnly.hash, request: c.uri, origin: SITE, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 3 });
      assert.match(d.authorize(outOfScope, [identityOnly]).error, /does not cover passport/);
    });

    it('a network-limited grant refuses a challenge or message that names no network', function () {
      const grant = d.readGrant(hubGrant({ origins: [SITE], networks: ['regtest'] }).uri, { now: NOW });
      const open = challenge({ network: null });
      const read = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: open.uri, origin: SITE, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.strictEqual(read.ok, true, read.error);
      assert.strictEqual(read.inner.network, null);
      assert.match(d.authorize(read, [grant]).error, /this request does not/);
      const named = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: challenge().uri, origin: SITE, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.strictEqual(d.authorize(named, [grant]).ok, true, d.authorize(named, [grant]).error);
      const chat = Message.fromVector(['P2P_CHAT_MESSAGE', 'o7']);
      const msg = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: chat, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.match(d.authorize(msg, [grant]).error, /this request does not/);
    });

    it('keeps a purpose up to 140 characters', function () {
      const grant = d.readGrant(hubGrant().uri, { now: NOW });
      const purpose = 'p'.repeat(120);
      const req = d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'o7']), purpose, now: NOW }, PASSPORT.identity.key);
      assert.strictEqual(d.readRequest(req.uri, { now: NOW + 1 }).request.purpose, purpose);
    });

    it('an answer must answer its own request', function () {
      const grant = d.readGrant(hubGrant().uri, { now: NOW });
      const ask = (text) => d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: Message.fromVector(['P2P_CHAT_MESSAGE', text]), now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      const mine = ask('o7');
      const other = ask('pay me');
      assert.strictEqual(d.answerError(mine, d.answerMessage(mine, HUB.identity.key)), null);
      assert.match(d.answerError(mine, d.answerMessage(other, HUB.identity.key)), /another message/);
      // An unsigned copy of the asked message is not an answer.
      assert.match(d.answerError(mine, Buffer.from(mine.inner.buffer)), /unsigned/);
      const c = challenge();
      const signIn = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: c.uri, origin: SITE, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.match(d.answerError(signIn, d.answerMessage(mine, HUB.identity.key)), /answered with an assertion/);
      const elsewhere = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: challenge().uri, origin: SITE, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      const assertion = d.answerPassport(elsewhere, { signer: 'hub', network: 'regtest', now: NOW + 2 }, HUB.identity.key);
      assert.match(d.answerError(signIn, assertion.uri), /another challenge/);
    });

    it('a request cannot change the origin or ask for more than the challenge did', function () {
      const c = challenge({ request: [] });
      const grant = d.readGrant(hubGrant().uri, { now: NOW });
      assert.throws(() => d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: c.uri, origin: 'https://evil.example', now: NOW }, PASSPORT.identity.key), /different origin/);
      assert.throws(() => d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: c.uri, origin: SITE, disclose: ['wallet'], now: NOW }, PASSPORT.identity.key), /did not ask/);
    });

    it('federation requests carry signed invites and withdrawals; other protocol frames are refused', function () {
      const grant = d.readGrant(d.createGrant({ grantee: PASSPORT.identity.pubkey, scopes: ['federation'], networks: ['regtest'], now: NOW }, HUB.identity.key).uri, { now: NOW });
      const withdrawal = federationFrame({ contract: 'aa'.repeat(32), type: 'FederationWithdrawalRequest', federationId: 'aa'.repeat(32), requestId: 'bb'.repeat(32), destinationAddress: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', amountSats: 5000, feeSats: 200 });
      const req = d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: withdrawal, purpose: 'Pay the escrow', now: NOW }, PASSPORT.identity.key);
      const read = d.readRequest(req.uri, { now: NOW + 1 });
      assert.strictEqual(read.ok, true, read.error);
      assert.strictEqual(read.scope, 'federation');
      assert.match(d.notificationFor(read).title, /5000 sats/);
      // A withdrawal names no network: refused under a network-limited grant unless the target knows it.
      assert.match(d.authorize(read, [grant]).error, /federation is unknown/);
      assert.strictEqual(d.authorize(read, [grant], { networkOf: () => 'regtest' }).ok, true);
      assert.match(d.authorize(read, [grant], { networkOf: () => 'mainnet' }).error, /does not cover/);
      // A signature answers only the withdrawal it names.
      const signs = (requestId) => federationFrame({ contract: 'aa'.repeat(32), type: 'FederationWithdrawalSignature', federationId: 'aa'.repeat(32), requestId, signatures: [] }, HUB.cosigner.key);
      assert.strictEqual(d.answerError(read, signs('bb'.repeat(32))), null);
      assert.match(d.answerError(read, signs('cc'.repeat(32))), /another withdrawal/);
      // Members accept only canonical ids, so an answer binds only with the exact ids of its request.
      const answer = (change) => federationFrame(Object.assign({ contract: 'aa'.repeat(32), type: 'FederationWithdrawalSignature', federationId: 'aa'.repeat(32), requestId: 'bb'.repeat(32), signatures: [] }, change), HUB.cosigner.key);
      for (const [change, error] of [
        [{ requestId: undefined }, /requestId/],
        [{ requestId: ` ${'bb'.repeat(32)}` }, /requestId/],
        [{ requestId: 'BB'.repeat(32) }, /requestId/],
        [{ federationId: undefined }, /federationId/],
        [{ federationId: `${'aa'.repeat(32)} ` }, /federationId/],
        [{ federationId: 'AA'.repeat(32), contract: 'AA'.repeat(32) }, /federationId/],
        [{ contract: 'cc'.repeat(32) }, /contract must be the federation id/],
        [{ contract: 'cc'.repeat(32), federationId: 'cc'.repeat(32) }, /another federation/]
      ]) {
        assert.match(d.answerError(read, answer(change)), error);
      }
      // The host's record decides a withdrawal's network, not a network the body claims.
      const claimed = federationFrame({ contract: 'aa'.repeat(32), type: 'FederationWithdrawalRequest', federationId: 'aa'.repeat(32), requestId: 'bb'.repeat(32), descriptor: { network: 'regtest' }, destinationAddress: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', amountSats: 5000, feeSats: 200 });
      const claimedRead = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: claimed, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.match(d.authorize(claimedRead, [grant]).error, /federation is unknown/);
      assert.match(d.authorize(claimedRead, [grant], { networkOf: () => 'mainnet' }).error, /names regtest and the federation is on mainnet/);
      assert.strictEqual(d.authorize(claimedRead, [grant], { networkOf: () => 'regtest' }).ok, true);
      // A threshold that is not a positive integer does not reach the prompt.
      const invite = federationFrame({ contract: 'aa'.repeat(32), type: 'FederationInvite', federationId: 'aa'.repeat(32), descriptor: { network: 'regtest', threshold: { toString: 'x' }, validators: ['02'.padEnd(66, '1')] } });
      const inviteRead = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: invite, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.strictEqual(inviteRead.ok, true, inviteRead.error);
      assert.doesNotThrow(() => d.notificationFor(inviteRead));
      assert.doesNotMatch(d.notificationFor(inviteRead).summary, /of 1 signers/);

      const unsigned = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({ type: 'FederationWithdrawalRequest' })]);
      assert.throws(() => d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: unsigned, now: NOW }, PASSPORT.identity.key), /signed/);
      const signature = federationFrame({ contract: 'aa'.repeat(32), type: 'FederationWithdrawalSignature', federationId: 'aa'.repeat(32), requestId: 'bb'.repeat(32), signatures: [] });
      assert.throws(() => d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: signature, now: NOW }, PASSPORT.identity.key), /only federation invites/);
      const otherGrant = d.createGrant({ grantee: OTHER.identity.pubkey, scopes: ['identity'], now: NOW }, PASSPORT.identity.key);
      assert.throws(() => d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: otherGrant.uri, now: NOW }, PASSPORT.identity.key), /cannot be delegated/);
    });

    it('refuses withdrawal requests whose address or amounts would mislead the co-sign prompt', function () {
      const grant = d.readGrant(d.createGrant({ grantee: PASSPORT.identity.pubkey, scopes: ['federation'], now: NOW }, HUB.identity.key).uri, { now: NOW });
      const good = { contract: 'aa'.repeat(32), type: 'FederationWithdrawalRequest', federationId: 'aa'.repeat(32), requestId: 'bb'.repeat(32), destinationAddress: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', amountSats: 5000, feeSats: 200 };
      const bad = [
        [{ destinationAddress: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080 (fee 1 sats). Approved by the Hub.' }, /destinationAddress/],
        [{ destinationAddress: 'bcrt1q\u202eexample0000000' }, /destinationAddress/],
        [{ destinationAddress: 'bc1short' }, /destinationAddress/],
        [{ destinationAddress: 42 }, /destinationAddress/],
        [{ amountSats: '5000' }, /amountSats/],
        [{ amountSats: 1.5 }, /amountSats/],
        [{ amountSats: -1 }, /amountSats/],
        [{ feeSats: 1e300 }, /feeSats/],
        [{ feeSats: undefined }, /feeSats/],
        [{ requestId: undefined }, /requestId/],
        [{ requestId: 'r1' }, /requestId/],
        [{ requestId: ` ${'bb'.repeat(32)}` }, /requestId/],
        [{ federationId: 'AA'.repeat(32), contract: 'AA'.repeat(32) }, /federationId/],
        [{ contract: 'cc'.repeat(32) }, /contract must be the federation id/]
      ];
      for (const [change, error] of bad) {
        const frame = federationFrame(Object.assign({}, good, change));
        assert.throws(() => d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: frame, now: NOW }, PASSPORT.identity.key), error);
        // Built by hand, so createRequest's own check is skipped: readRequest still refuses it.
        const raw = Message.fromFields('DELEGATION_REQUEST', {
          v: 1,
          pubkey: PASSPORT.identity.pubkey,
          target: HUB.identity.pubkey,
          grant: Buffer.from(grant.hash, 'hex'),
          nonce: crypto.randomBytes(32),
          request: frame.toBuffer(),
          origin: '',
          account: 0,
          disclose: '',
          purpose: '',
          issuedAt: BigInt(NOW),
          expiresAt: BigInt(NOW + 60 * 1000)
        }).signWithKey(PASSPORT.identity.key);
        const read = d.readRequest(raw.toBuffer(), { now: NOW + 1 });
        assert.strictEqual(read.ok, false);
        assert.match(read.error, error);
      }
      const read = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: federationFrame(good), now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      read.inner.body.destinationAddress = 'tb1q\nApproved';
      assert.throws(() => d.notificationFor(read), /destinationAddress/);
    });

    it('message scope signs unsigned chat frames only', function () {
      const grant = d.readGrant(hubGrant().uri, { now: NOW });
      const chat = Message.fromVector(['P2P_CHAT_MESSAGE', 'o7']);
      const read = d.readRequest(d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: chat, now: NOW }, PASSPORT.identity.key).uri, { now: NOW + 1 });
      assert.strictEqual(read.ok, true, read.error);
      assert.strictEqual(read.scope, 'message');
      assert.strictEqual(d.authorize(read, [grant]).ok, true);
      const signed = d.answerMessage(read, HUB.identity.key);
      assert.strictEqual(signed.toBuffer().length > 0, true);
      const signedChat = Message.fromVector(['P2P_CHAT_MESSAGE', 'o7']).signWithKey(OTHER.identity.key);
      assert.throws(() => d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: signedChat, now: NOW }, PASSPORT.identity.key), /unsigned/);
    });

    it('requests expire; results refuse an answer with a refusal', function () {
      const grant = d.readGrant(hubGrant().uri, { now: NOW });
      const chat = Message.fromVector(['P2P_CHAT_MESSAGE', 'later']);
      const req = d.createRequest({ target: HUB.identity.pubkey, grant: grant.hash, request: chat, now: NOW }, PASSPORT.identity.key);
      assert.match(d.readRequest(req.uri, { now: NOW + 25 * 60 * 60 * 1000 }).error, /expired/);
      assert.throws(() => d.createResult({ request: req.hash, answer: chat, refusal: 'no', now: NOW }, HUB.identity.key), /exclusive/);
      const declined = d.readResult(d.createResult({ request: req.hash, refusal: 'not now', rule: 'r-1', now: NOW }, HUB.identity.key).uri, { now: NOW });
      assert.strictEqual(declined.result.refusal, 'not now');
      assert.strictEqual(declined.result.rule, 'r-1');
    });
  });

  describe('mailbox', function () {
    it('fetch frames prove the key; frames name their recipient', function () {
      const fetch = d.createMailboxFetch({ since: 3, now: NOW }, PASSPORT.identity.key);
      const read = d.readMailboxFetch(fetch.uri, { now: NOW + 1 });
      assert.strictEqual(read.ok, true, read.error);
      assert.strictEqual(read.pubkey, PASSPORT.identity.pubkey);
      assert.strictEqual(read.since, 3);
      assert.match(d.readMailboxFetch(fetch.uri, { now: NOW + 10 * 60 * 1000 }).error, /expired/);

      const g = hubGrant();
      assert.strictEqual(d.mailboxAddress(g.uri).to, PASSPORT.identity.pubkey);
      const revoke = d.createRevoke({ grant: g.hash, now: NOW }, HUB.identity.key);
      assert.strictEqual(d.mailboxAddress(revoke.uri).ok, false);
      assert.strictEqual(d.mailboxAddress(revoke.uri, { to: PASSPORT.identity.pubkey }).to, PASSPORT.identity.pubkey);
      assert.strictEqual(d.delegationType(g.uri), 'DELEGATION_GRANT');
      assert.strictEqual(d.delegationType(challenge().uri), null);
    });
  });
});
