'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  PASSPORT_CONNECT,
  PASSPORT_SESSION,
  PASSPORT_RESUME,
  PASSPORT_REFUSED,
  FIXTURE_SEED
} = require('../constants');
const { encodeFabricUri } = require('../functions/fabricUri');
const { importSeed, deriveAccount } = require('../functions/accountKeys');
const { classifyGossipWireType, isPublicGossipFloodType } = require('../functions/gossipNetwork');
const {
  PASSPORT_PEER_VERSION,
  createChallenge,
  readChallenge,
  signAssertion,
  verifyAssertion,
  createConnect,
  readConnect,
  createPeerChallenge,
  createPeerSession,
  readPeerSession,
  createResume,
  readResume,
  createRefusal,
  readRefusal
} = require('../functions/passport');
const d = require('../types/delegation');

const NOW = 1_800_000_000_000;
const MASTER = importSeed(FIXTURE_SEED);
const USER = deriveAccount(MASTER, { account: 0, network: 'regtest' });
const PEER = deriveAccount(MASTER, { account: 3, network: 'regtest' }).identity.key;
const IMPOSTOR = deriveAccount(MASTER, { account: 4, network: 'regtest' }).identity.key;
const DESK = deriveAccount(MASTER, { account: 5, network: 'regtest' });
const SESSION = new Key({ private: Buffer.alloc(32, 7).toString('hex') });

/** One sign-in on one connection: connect, challenge, assertion. */
function handshake (params = {}) {
  const connect = createConnect(Object.assign({ peer: PEER.pubkey, origin: 'https://app.example', now: NOW }, params.connect));
  const read = readConnect(connect.uri, { now: NOW + 10 });
  assert.strictEqual(read.ok, true, read.error);
  const challenge = createPeerChallenge(Object.assign({
    clientNonce: read.connect.clientNonce,
    origin: read.connect.origin,
    homes: ['https://hub.example'],
    network: 'regtest',
    request: read.connect.request,
    purpose: 'Sign in to the test peer',
    now: NOW + 20
  }, params.challenge), params.peerKey || PEER);
  return { connect, challenge };
}

function sign (challenge, params = {}, key = USER.identity.key) {
  return signAssertion(Object.assign({
    challenge: challenge.uri,
    peer: PEER.pubkey,
    origin: 'https://app.example',
    signer: 'passport',
    network: 'regtest',
    sessionKey: SESSION.pubkey,
    now: NOW + 50
  }, params), key);
}

function expected (challenge, extra = {}) {
  return Object.assign({
    peer: PEER.pubkey,
    nonce: challenge.nonce,
    challengeHash: challenge.hash,
    network: 'regtest',
    allow: challenge.request,
    challengeExpiresAt: challenge.expiresAt,
    now: NOW + 100
  }, extra);
}

describe('@fabric/core/functions/passport peer sessions (v3)', function () {
  this.timeout(30000);

  it('registers the connect, session, and resume opcodes, never flooded', function () {
    assert.strictEqual(PASSPORT_CONNECT, 0x424B);
    assert.strictEqual(PASSPORT_SESSION, 0x424C);
    assert.strictEqual(PASSPORT_RESUME, 0x424D);
    assert.strictEqual(PASSPORT_REFUSED, 0x424E);
    for (const type of ['PASSPORT_CONNECT', 'PASSPORT_SESSION', 'PASSPORT_RESUME', 'PASSPORT_REFUSED']) {
      assert.ok(Message.getBodySchema(type), `${type} has a field schema`);
      assert.strictEqual(Message.canonicalTypeName(Message.canonicalTypeCode(type)), type);
      assert.strictEqual(classifyGossipWireType(type), 'session', type);
      assert.strictEqual(isPublicGossipFloodType(type), false, type);
    }
  });

  it('leaves v2 frames byte-identical', function () {
    const c = createChallenge({ origin: 'https://example.com', network: 'regtest', nonce: 'aa'.repeat(32), now: NOW });
    const fields = Message.fromBuffer(c.message.toBuffer()).toFields();
    assert.strictEqual(fields.v, 2);
    assert.strictEqual(fields.peer, '');
    // The v2 schema, as it was before the v3 fields were appended.
    const v2 = Message.getBodySchema('PASSPORT_CHALLENGE').slice(0, 8);
    assert.deepStrictEqual(v2.map((f) => f.name), ['v', 'origin', 'nonce', 'issuedAt', 'expiresAt', 'purpose', 'network', 'request']);
    assert.ok(Message.encodeBody(v2, fields).equals(c.message.bodyBuffer));
  });

  it('connects, signs in to the peer by its key, and confirms a session key', function () {
    const { connect, challenge } = handshake({ connect: { request: ['wallet'] } });
    const read = readChallenge(challenge.uri, { now: NOW + 30, peer: PEER.pubkey, clientNonce: connect.clientNonce });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.challenge.v, PASSPORT_PEER_VERSION);
    assert.strictEqual(read.challenge.peer, PEER.pubkey);
    assert.deepStrictEqual(read.challenge.homes, ['https://hub.example']);
    assert.strictEqual(read.challenge.origin, 'https://app.example');

    const a = sign(challenge, { disclose: ['wallet'], wallet: USER.wallet });
    assert.strictEqual(a.peer, PEER.pubkey);
    assert.strictEqual(a.sessionKey, SESSION.pubkey);
    const v = verifyAssertion(a.uri, expected(challenge));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.identity.pubkey, USER.identity.pubkey);
    assert.strictEqual(v.sessionKey, SESSION.pubkey);
    assert.strictEqual(v.origin, 'https://app.example');
    assert.ok(v.wallet);

    const hash = require('crypto').createHash('sha256').update(a.message.toBuffer()).digest('hex');
    const s = createPeerSession({ assertionHash: hash, pubkey: v.identity.pubkey, sessionKey: v.sessionKey, now: NOW + 120 }, PEER);
    const back = readPeerSession(s.uri, { peer: PEER.pubkey, sessionKey: SESSION.pubkey, assertionHash: hash, now: NOW + 130 });
    assert.strictEqual(back.ok, true, back.error);
    assert.strictEqual(back.session.sessionId, s.sessionId);
    assert.strictEqual(back.session.identity.id, USER.identity.id);
    assert.match(readPeerSession(s.uri, { peer: IMPOSTOR.pubkey, now: NOW + 130 }).error, /another peer/);
    assert.match(readPeerSession(s.uri, { now: NOW + 130 }).error, /expected peer/, 'the signer check is never skipped');

    // A frame signed by the session key is the identity's on this peer.
    const call = Message.fromVector(['JSONCall', JSON.stringify({ method: 'Whoami', params: [] })]).signWithKey(SESSION);
    assert.strictEqual(Message.verifyFrameAuthor(call.toBuffer()).ok, true);
  });

  it('works for a page origin the peer never pinned, or none at all', function () {
    const { challenge } = handshake({ connect: { origin: null }, challenge: { origin: null } });
    assert.strictEqual(readChallenge(challenge.uri, { now: NOW + 30 }).challenge.origin, null);
    const native = sign(challenge, { origin: undefined, signer: 'gooncitizen' });
    const v = verifyAssertion(native.uri, expected(challenge));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.origin, null);
  });

  it('refuses an unsigned, impostor-signed, or wrong-nonce challenge', function () {
    const { connect, challenge } = handshake();
    assert.match(readChallenge(challenge.uri, { now: NOW + 30, peer: IMPOSTOR.pubkey }).error, /another peer/);
    assert.match(readChallenge(challenge.uri, { now: NOW + 30, clientNonce: 'bb'.repeat(32) }).error, /clientNonce mismatch/);
    assert.match(readChallenge(challenge.uri, { now: NOW + 30, clientNonce: connect.clientNonce.toUpperCase() }).ok ? 'ok' : 'x', /ok/);

    // An impostor naming the real peer cannot sign as it.
    const forged = Message.fromFields('PASSPORT_CHALLENGE', Message.fromBuffer(challenge.message.toBuffer()).toFields());
    forged.signWithKey(IMPOSTOR);
    assert.match(readChallenge(encodeFabricUri(forged), { now: NOW + 30 }).error, /signed by its peer/);
    const unsigned = Message.fromFields('PASSPORT_CHALLENGE', Message.fromBuffer(challenge.message.toBuffer()).toFields());
    assert.match(readChallenge(encodeFabricUri(unsigned), { now: NOW + 30 }).error, /signed by its peer/);

    assert.throws(() => sign(challenge, { peer: IMPOSTOR.pubkey }), /another peer/);
  });

  it('a peer assertion needs a session key and names its audience', function () {
    const { challenge } = handshake();
    assert.throws(() => sign(challenge, { sessionKey: undefined }), /sessionKey/);
    assert.throws(() => sign(challenge, { sessionKey: USER.identity.pubkey }), /identity key/);
    assert.throws(() => sign(challenge, { origin: 'https://evil.example' }), /different origin/);

    const a = sign(challenge);
    assert.match(verifyAssertion(a.uri, expected(challenge, { peer: IMPOSTOR.pubkey })).error, /peer mismatch/);
    assert.match(verifyAssertion(a.uri, expected(challenge, { nonce: 'cc'.repeat(32) })).error, /nonce mismatch/);
    // A peer assertion is never a site assertion, and the other way round.
    assert.match(verifyAssertion(a.uri, { origin: 'https://app.example', nonce: challenge.nonce, challengeHash: challenge.hash, now: NOW + 100 }).error, /version/);
    const site = createChallenge({ origin: 'https://app.example', network: 'regtest', now: NOW });
    const siteAssertion = signAssertion({ challenge: site.uri, origin: 'https://app.example', signer: 'passport', network: 'regtest', now: NOW + 10 }, USER.identity.key);
    assert.match(verifyAssertion(siteAssertion.uri, expected(site)).error, /version/);
    assert.throws(() => signAssertion({ challenge: site.uri, origin: 'https://app.example', peer: PEER.pubkey, signer: 'passport', network: 'regtest', now: NOW }, USER.identity.key), /not a peer challenge|another peer/);
  });

  it('binds a cosigner proof to the peer and the sign-in', function () {
    const { challenge } = handshake({ connect: { request: ['cosigner'] } });
    const a = sign(challenge, { disclose: ['cosigner'], cosignerKey: USER.cosigner.key });
    const v = verifyAssertion(a.uri, expected(challenge));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.cosigner.pubkey, USER.cosigner.pubkey);
  });

  it('resumes a session on a new connection with the session key only', function () {
    const sessionId = 'dd'.repeat(32);
    const { challenge } = handshake();
    const r = createResume({ sessionId, challenge: challenge.uri, peer: PEER.pubkey, now: NOW + 40 }, SESSION);
    const ok = readResume(r.uri, { peer: PEER.pubkey, nonce: challenge.nonce, challengeHash: challenge.hash, challengeExpiresAt: challenge.expiresAt, sessionKey: SESSION.pubkey, now: NOW + 60 });
    assert.strictEqual(ok.ok, true, ok.error);
    assert.strictEqual(ok.sessionId, sessionId);

    // Replayed onto another connection's challenge, it fails.
    const other = handshake().challenge;
    assert.match(readResume(r.uri, { peer: PEER.pubkey, nonce: other.nonce, challengeHash: other.hash, now: NOW + 60 }).error, /nonce mismatch/);
    // Signed by any other key, it does not resume the session.
    const stolen = createResume({ sessionId, challenge: challenge.uri, now: NOW + 40 }, USER.identity.key);
    assert.match(readResume(stolen.uri, { peer: PEER.pubkey, nonce: challenge.nonce, challengeHash: challenge.hash, sessionKey: SESSION.pubkey, now: NOW + 60 }).error, /session key/);
  });

  it('a refusal says why and which frame it answers', function () {
    const { connect } = handshake();
    const refused = createRefusal({ error: 'unknown session', answers: connect.message, now: NOW }, PEER);
    const read = readRefusal(refused.uri);
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.error, 'unknown session');
    assert.strictEqual(read.author, PEER.pubkey.slice(2));
    assert.strictEqual(read.answers, require('crypto').createHash('sha256').update(connect.message.toBuffer()).digest('hex'));
  });

  it('a desktop delegate signs a peer sign-in for Passport, limited by peer', function () {
    const PASSPORT_KEY = USER.identity.key;
    const grant = d.readGrant(d.createGrant({ grantee: PASSPORT_KEY.pubkey, scopes: ['passport'], peers: [PEER.pubkey], now: NOW }, DESK.identity.key).uri, { now: NOW });
    assert.strictEqual(grant.ok, true, grant.error);
    assert.deepStrictEqual(grant.grant.peers, [PEER.pubkey]);

    const { challenge } = handshake({ challenge: { origin: null } });
    assert.throws(() => d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: challenge.uri, now: NOW + 30 }, PASSPORT_KEY), /sessionKey/);
    const req = d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: challenge.uri, origin: 'https://app.example', sessionKey: SESSION.pubkey, now: NOW + 30 }, PASSPORT_KEY);
    const read = d.readRequest(req.uri, { now: NOW + 40 });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.request.sessionKey, SESSION.pubkey);
    assert.strictEqual(d.authorize(read, [grant]).ok, true, d.authorize(read, [grant]).error);
    assert.match(d.notificationFor(read).title, /app\.example/);

    const a = d.answerPassport(read, { signer: 'hub', network: 'regtest', now: NOW + 50 }, DESK.identity.key);
    assert.strictEqual(d.answerError(read, a.uri), null);
    const v = verifyAssertion(a.uri, expected(challenge));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.sessionKey, SESSION.pubkey);
    assert.strictEqual(v.device, PASSPORT_KEY.pubkey);

    // The same grant does not cover another peer, or a site sign-in.
    const elsewhere = handshake({ peerKey: IMPOSTOR }).challenge;
    const readElsewhere = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: elsewhere.uri, sessionKey: SESSION.pubkey, now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    assert.match(d.authorize(readElsewhere, [grant]).error, /does not cover peer/);
    const site = createChallenge({ origin: 'https://app.example', network: 'regtest', now: NOW });
    const readSite = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: site.uri, origin: 'https://app.example', now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    assert.match(d.authorize(readSite, [grant]).error, /site sign-ins/);

    // An origin-limited grant needs the origin the requester saw, not the peer's claim.
    const limited = d.readGrant(d.createGrant({ grantee: PASSPORT_KEY.pubkey, scopes: ['passport'], origins: ['https://app.example'], now: NOW + 1 }, DESK.identity.key).uri, { now: NOW + 2 });
    const claimed = handshake({ challenge: { origin: 'https://app.example' } }).challenge;
    const unreported = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: limited.hash, request: claimed.uri, sessionKey: SESSION.pubkey, now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    assert.strictEqual(unreported.ok, true, unreported.error);
    assert.match(d.authorize(unreported, [limited]).error, /without a reported origin/);
    const reported = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: limited.hash, request: claimed.uri, origin: 'https://app.example', sessionKey: SESSION.pubkey, now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    assert.strictEqual(d.authorize(reported, [limited]).ok, true);
  });
});
