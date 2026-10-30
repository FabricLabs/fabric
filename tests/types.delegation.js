'use strict';

const assert = require('assert');
const Message = require('../types/message');
const Delegation = require('../types/delegation');
const { FIXTURE_SEED } = require('../constants');
const { importSeed, deriveAccount } = require('../functions/accountKeys');
const { createChallenge, verifyAssertion } = require('../functions/passport');
const d = require('../functions/delegation');

const MASTER = importSeed(FIXTURE_SEED);
const PASSPORT = deriveAccount(MASTER, { account: 0, network: 'regtest' });
const HUB = deriveAccount(MASTER, { account: 1, network: 'regtest' });
const OTHER = deriveAccount(MASTER, { account: 2, network: 'regtest' });
const SITE = 'https://goon.vc';

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
