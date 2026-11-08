'use strict';

const assert = require('assert');
const Message = require('../types/message');
const {
  PASSPORT_CHALLENGE,
  PASSPORT_ASSERTION,
  PASSPORT_MAX_TTL_MS,
  FIXTURE_SEED
} = require('../constants');
const { encodeFabricUri } = require('../functions/fabricUri');
const { importSeed, deriveAccount, extendedKeyForNetwork } = require('../functions/accountKeys');
const { classifyGossipWireType, isPublicGossipFloodType, isRelayAsIsWireType } = require('../functions/gossipNetwork');
const {
  normalizeOrigin,
  challengeHash,
  createChallenge,
  readChallenge,
  signAssertion,
  verifyAssertion
} = require('../functions/passport');
const Key = require('../types/key');
const { PASSPORT_CONNECT, PASSPORT_SESSION, PASSPORT_RESUME, PASSPORT_REFUSED } = require('../constants');
const { PASSPORT_PEER_VERSION, createConnect, readConnect, createPeerChallenge, createPeerSession, readPeerSession, createResume, readResume, createRefusal, readRefusal } = require('../functions/passport');
const d = require('../types/delegation');

const SITE = 'https://example.com';
const NOW = 1_800_000_000_000;
const MASTER = importSeed(FIXTURE_SEED);
const ACCOUNT = deriveAccount(MASTER, { account: 0, network: 'regtest' });
const OTHER = deriveAccount(MASTER, { account: 1, network: 'regtest' });
const DEVICE = deriveAccount(MASTER, { account: 7, network: 'regtest' }).identity.key;

function challenge (params = {}) {
  return createChallenge(Object.assign({ origin: SITE, network: 'regtest', now: NOW }, params));
}

function expected (c, extra = {}) {
  return Object.assign({
    origin: SITE,
    nonce: c.nonce,
    challengeHash: c.hash,
    network: c.network,
    allow: c.request,
    challengeExpiresAt: c.expiresAt,
    now: NOW + 1000
  }, extra);
}

function assertion (c, params = {}, key = ACCOUNT.identity.key) {
  return signAssertion(Object.assign({
    challenge: c.uri,
    origin: SITE,
    signer: 'passport',
    network: 'regtest',
    now: NOW + 500
  }, params), key);
}

/** Sign an assertion with arbitrary fields (what an attacker could produce). */
function forge (fields, key = ACCOUNT.identity.key) {
  const message = Message.fromFields('PASSPORT_ASSERTION', Object.assign({
    v: 2,
    origin: SITE,
    nonce: '',
    challengeHash: Buffer.alloc(32),
    issuedAt: BigInt(NOW + 500),
    expiresAt: BigInt(NOW + 60000),
    network: 'regtest',
    pubkey: ACCOUNT.identity.pubkey,
    identityId: ACCOUNT.identity.id,
    signer: 'passport',
    device: '',
    wallet: '',
    cosigner: ''
  }, fields));
  message.signWithKey(key);
  return encodeFabricUri(message);
}

describe('@fabric/core/functions/passport', function () {
  this.timeout(30000);

  it('registers the challenge and assertion opcodes with field schemas, never relayed', function () {
    assert.strictEqual(PASSPORT_CHALLENGE, 0x4240);
    assert.strictEqual(PASSPORT_ASSERTION, 0x4241);
    assert.strictEqual(PASSPORT_MAX_TTL_MS, 3 * 60 * 1000);
    for (const type of ['PASSPORT_CHALLENGE', 'PASSPORT_ASSERTION']) {
      assert.ok(Message.getBodySchema(type), type);
      assert.strictEqual(Message.canonicalTypeName(Message.canonicalTypeCode(type)), type);
      assert.strictEqual(classifyGossipWireType(type), 'hub', type);
      assert.strictEqual(isPublicGossipFloodType(type), false, type);
      assert.strictEqual(isRelayAsIsWireType(type), false, type);
    }
    assert.strictEqual(Message.canonicalTypeCode('PassportAssertion'), PASSPORT_ASSERTION);
    assert.strictEqual(Message.canonicalTypeName(0x4230), null);
    // Retired: delegated sign-ins are DELEGATION_REQUESTs (types/delegation).
    assert.strictEqual(Message.getBodySchema('PASSPORT_SIGN_REQUEST'), null);
    assert.strictEqual(classifyGossipWireType('PASSPORT_SIGN_REQUEST'), 'hub');
  });

  it('normalizes origins', function () {
    assert.strictEqual(normalizeOrigin('https://Example.com/path?q'), SITE);
    assert.strictEqual(normalizeOrigin('null'), null);
    assert.strictEqual(normalizeOrigin('chrome-extension://abc'), null);
    assert.strictEqual(normalizeOrigin('https://u:p@example.com'), null);
  });

  it('creates and reads a challenge', function () {
    const c = challenge({ purpose: 'Sign in to Example', request: ['cosigner', 'wallet'] });
    assert.match(c.nonce, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(c.request, ['wallet', 'cosigner']);
    assert.strictEqual(c.hash, challengeHash(c.uri));
    const read = readChallenge(c.uri, { now: NOW });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.challenge.origin, SITE);
    assert.strictEqual(read.challenge.network, 'regtest');
    assert.strictEqual(read.hash, c.hash);
    assert.strictEqual(read.author, null);
    assert.throws(() => challenge({ request: ['xpub'] }), /request may only list/);
    assert.throws(() => challenge({ nonce: 'short' }), /32 bytes/);
    assert.strictEqual(challenge({ purpose: 'x'.repeat(500) }).message.toFields().purpose.length, 140);
  });

  it('refuses a challenge that is too old or lives too long', function () {
    const c = challenge();
    assert.match(readChallenge(c.uri, { now: NOW + 10 * 60 * 1000 }).error, /expired/);
    const long = challenge({ ttlMs: 60 * 60 * 1000 });
    assert.strictEqual(long.expiresAt - long.issuedAt, PASSPORT_MAX_TTL_MS);
  });

  it('signs and verifies an identity-only assertion', function () {
    const c = challenge();
    const a = assertion(c);
    assert.ok(a.expiresAt <= c.expiresAt);
    const v = verifyAssertion(a.uri, expected(c));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.identity.pubkey, ACCOUNT.identity.pubkey);
    assert.strictEqual(v.identity.id, ACCOUNT.identity.id);
    assert.strictEqual(v.network, 'regtest');
    assert.strictEqual(v.wallet, null);
    assert.strictEqual(v.cosigner, null);
    const fields = a.message.toFields();
    assert.strictEqual(fields.xpub, undefined);
    assert.strictEqual(fields.crossSign, undefined);
  });

  it('refuses the wrong origin, nonce, challenge, or signer', function () {
    const c = challenge();
    const a = assertion(c);
    assert.match(verifyAssertion(a.uri, expected(c, { origin: 'https://evil.example' })).error, /origin mismatch/);
    assert.match(verifyAssertion(a.uri, expected(c, { nonce: 'f'.repeat(64) })).error, /nonce mismatch/);
    assert.match(verifyAssertion(a.uri, expected(c, { challengeHash: 'a'.repeat(64) })).error, /challengeHash mismatch/);
    assert.match(verifyAssertion(a.uri, expected(c, { signers: ['hub'] })).error, /not accepted/);
    assert.throws(() => assertion(c, { origin: 'https://evil.example' }), /different origin/);
  });

  it('refuses tampered fields', function () {
    const c = challenge();
    const a = assertion(c);
    const bytes = Buffer.from(a.message.toBuffer());
    bytes[bytes.length - 5] ^= 1;
    assert.match(verifyAssertion(encodeFabricUri(bytes), expected(c)).error, /hash mismatch/);

    const swapped = forge({
      nonce: c.nonce,
      challengeHash: Buffer.from(c.hash, 'hex'),
      pubkey: OTHER.identity.pubkey,
      identityId: OTHER.identity.id
    });
    assert.match(verifyAssertion(swapped, expected(c)).error, /frame author/);

    const wrongId = forge({ nonce: c.nonce, challengeHash: Buffer.from(c.hash, 'hex'), identityId: OTHER.identity.id });
    assert.match(verifyAssertion(wrongId, expected(c)).error, /identity id/);

    const v1 = forge({ v: 1, nonce: c.nonce, challengeHash: Buffer.from(c.hash, 'hex') });
    assert.match(verifyAssertion(v1, expected(c)).error, /version/);
  });

  it('refuses a network mismatch', function () {
    const c = challenge();
    assert.throws(() => assertion(c, { network: 'signet' }), /for regtest/);
    const forged = forge({ nonce: c.nonce, challengeHash: Buffer.from(c.hash, 'hex'), network: 'mainnet' });
    assert.match(verifyAssertion(forged, expected(c)).error, /network mismatch/);
    const open = challenge({ network: null });
    const a = assertion(open, { network: 'signet' });
    assert.strictEqual(verifyAssertion(a.uri, expected(open, { network: 'regtest' })).error, 'network mismatch');
    assert.strictEqual(verifyAssertion(a.uri, expected(open)).network, 'signet');
  });

  it('refuses an assertion that is too old or outlives its challenge', function () {
    const c = challenge();
    const a = assertion(c);
    assert.match(verifyAssertion(a.uri, expected(c, { now: NOW + 10 * 60 * 1000 })).error, /expired/);
    const outliving = forge({
      nonce: c.nonce,
      challengeHash: Buffer.from(c.hash, 'hex'),
      expiresAt: BigInt(c.expiresAt + 30000)
    });
    assert.match(verifyAssertion(outliving, expected(c)).error, /outlives/);
    const long = forge({
      nonce: c.nonce,
      challengeHash: Buffer.from(c.hash, 'hex'),
      expiresAt: BigInt(NOW + 500 + PASSPORT_MAX_TTL_MS + 1)
    });
    assert.match(verifyAssertion(long, expected(c, { challengeExpiresAt: undefined })).error, /lifetime too long/);
  });

  it('discloses the wallet only when requested and agreed', function () {
    const asked = challenge({ request: ['wallet'] });
    assert.throws(() => assertion(challenge(), { disclose: ['wallet'], wallet: ACCOUNT.wallet }), /did not ask for wallet/);
    const silent = assertion(asked);
    assert.strictEqual(verifyAssertion(silent.uri, expected(asked)).wallet, null);

    const shared = assertion(asked, { disclose: ['wallet'], wallet: ACCOUNT.wallet });
    const v = verifyAssertion(shared.uri, expected(asked));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.wallet.receive, 'segwit');
    assert.strictEqual(v.wallet.segwit.xpub, ACCOUNT.wallet.segwit.xpub);
    assert.strictEqual(v.wallet.standard.xpub, ACCOUNT.wallet.standard.xpub);
    assert.strictEqual(v.wallet.descriptors.watch.length, 4);
    for (const d of v.wallet.descriptors.watch) assert.ok(!d.includes('['));

    // The site asked for nothing: a wallet in the frame is refused.
    const notAllowed = verifyAssertion(shared.uri, expected(asked, { allow: [] }));
    assert.match(notAllowed.error, /wallet disclosed without being requested/);
  });

  it('refuses wallet xpubs for another network or with forged descriptors', function () {
    const asked = challenge({ request: ['wallet'] });
    const mainnet = deriveAccount(MASTER, { network: 'mainnet' }).wallet;
    const bad = forge({
      nonce: asked.nonce,
      challengeHash: Buffer.from(asked.hash, 'hex'),
      wallet: JSON.stringify({ segwit: { xpub: mainnet.segwit.xpub }, standard: { xpub: mainnet.standard.xpub }, receive: 'segwit', descriptors: {} })
    });
    assert.match(verifyAssertion(bad, expected(asked)).error, /shareable account xpubs for the assertion network/);

    // Right network, but the xpub still names its depth, parent, and index.
    const unshared = extendedKeyForNetwork(ACCOUNT.wallet.segwit.key.xpub, 'regtest');
    assert.match(unshared, /^tpub/);
    assert.notStrictEqual(unshared, ACCOUNT.wallet.segwit.xpub);
    const withOrigin = forge({
      nonce: asked.nonce,
      challengeHash: Buffer.from(asked.hash, 'hex'),
      wallet: JSON.stringify({ segwit: { xpub: unshared }, standard: { xpub: ACCOUNT.wallet.standard.xpub }, receive: 'segwit', descriptors: {} })
    });
    assert.match(verifyAssertion(withOrigin, expected(asked)).error, /shareable account xpubs for the assertion network/);

    const good = JSON.parse(assertion(asked, { disclose: ['wallet'], wallet: ACCOUNT.wallet }).message.toFields().wallet);
    good.descriptors.watch.push(`wpkh(${OTHER.wallet.segwit.xpub}/0/*)`);
    const forged = forge({ nonce: asked.nonce, challengeHash: Buffer.from(asked.hash, 'hex'), wallet: JSON.stringify(good) });
    assert.match(verifyAssertion(forged, expected(asked)).error, /descriptors do not match/);
  });

  it('discloses the cosigner key with a proof bound to this sign-in', function () {
    const asked = challenge({ request: ['cosigner'] });
    assert.throws(() => assertion(asked, { disclose: ['cosigner'] }), /cosignerKey required/);
    const shared = assertion(asked, { disclose: ['cosigner'], cosignerKey: ACCOUNT.cosigner.key });
    const v = verifyAssertion(shared.uri, expected(asked));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.cosigner.pubkey, ACCOUNT.cosigner.pubkey);
    assert.notStrictEqual(v.cosigner.pubkey, v.identity.pubkey);
    assert.match(verifyAssertion(shared.uri, expected(asked, { allow: ['wallet'] })).error, /cosigner disclosed without being requested/);
  });

  it('refuses a cosigner proof replayed from another sign-in or identity', function () {
    const first = challenge({ request: ['cosigner'] });
    const second = challenge({ request: ['cosigner'] });
    const stolen = assertion(first, { disclose: ['cosigner'], cosignerKey: ACCOUNT.cosigner.key }).message.toFields().cosigner;
    const replayed = forge({ nonce: second.nonce, challengeHash: Buffer.from(second.hash, 'hex'), cosigner: stolen });
    assert.match(verifyAssertion(replayed, expected(second)).error, /cosigner proof does not verify/);

    const otherIdentity = forge({
      nonce: first.nonce,
      challengeHash: Buffer.from(first.hash, 'hex'),
      pubkey: OTHER.identity.pubkey,
      identityId: OTHER.identity.id,
      cosigner: stolen
    }, OTHER.identity.key);
    assert.match(verifyAssertion(otherIdentity, expected(first)).error, /cosigner proof does not verify/);

    const self = forge({
      nonce: first.nonce,
      challengeHash: Buffer.from(first.hash, 'hex'),
      cosigner: JSON.stringify({ pubkey: ACCOUNT.identity.pubkey, proof: '00'.repeat(64) })
    });
    assert.match(verifyAssertion(self, expected(first)).error, /identity key/);
  });

  it('names the delegate that asked in a delegated assertion', function () {
    const c = challenge({ request: ['wallet'] });
    const desk = deriveAccount(MASTER, { account: 2, network: 'regtest' });
    const a = signAssertion({
      challenge: c.uri,
      origin: SITE,
      signer: 'hub',
      network: 'regtest',
      disclose: ['wallet'],
      wallet: desk.wallet,
      device: DEVICE.pubkey,
      now: NOW + 300
    }, desk.identity.key);
    const v = verifyAssertion(a.uri, expected(c));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.signer, 'hub');
    assert.strictEqual(v.device, DEVICE.pubkey);
    assert.ok(v.wallet);
  });

  it('refuses old 0x4230-series frames', function () {
    const c = challenge();
    const a = assertion(c);
    for (const opcode of [0x4230, 0x4231, 0x4232]) {
      const bytes = Buffer.from(a.message.toBuffer());
      bytes.writeUInt32BE(opcode, 72);
      const uri = encodeFabricUri(bytes);
      assert.match(verifyAssertion(uri, expected(c)).error, /unknown message type|not allowed/);
      assert.strictEqual(readChallenge(uri, { now: NOW }).ok, false);
    }
    assert.strictEqual(readChallenge(a.uri, { now: NOW }).ok, false);
    assert.strictEqual(verifyAssertion(c.uri, expected(c)).ok, false);
  });
});

describe('@fabric/core/functions/passport peer sessions (v3)', function () {
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

    const { connect, challenge } = handshake({ challenge: { origin: null } });
    const clientNonce = connect.clientNonce;
    assert.throws(() => d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: challenge.uri, clientNonce, now: NOW + 30 }, PASSPORT_KEY), /sessionKey/);
    const req = d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: challenge.uri, origin: 'https://app.example', sessionKey: SESSION.pubkey, clientNonce, now: NOW + 30 }, PASSPORT_KEY);
    const read = d.readRequest(req.uri, { now: NOW + 40 });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.request.sessionKey, SESSION.pubkey);
    assert.strictEqual(read.request.clientNonce, clientNonce);
    assert.strictEqual(d.authorize(read, [grant]).ok, true, d.authorize(read, [grant]).error);
    // The prompt names the peer key it binds; the reported origin is only a note.
    const prompt = d.notificationFor(read);
    assert.match(prompt.title, new RegExp(`peer ${PEER.pubkey.slice(2, 10)}`));
    assert.match(prompt.summary, /reported as app\.example/);
    assert.strictEqual(grant.grant.peers.length, 1);

    const a = d.answerPassport(read, { signer: 'hub', network: 'regtest', now: NOW + 50 }, DESK.identity.key);
    assert.strictEqual(d.answerError(read, a.uri), null);
    const v = verifyAssertion(a.uri, expected(challenge));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.sessionKey, SESSION.pubkey);
    assert.strictEqual(v.device, PASSPORT_KEY.pubkey);

    // The same grant does not cover another peer, or a site sign-in.
    const elsewhere = handshake({ peerKey: IMPOSTOR }).challenge;
    const readElsewhere = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: elsewhere.uri, sessionKey: SESSION.pubkey, clientNonce: elsewhere.clientNonce, now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    assert.match(d.authorize(readElsewhere, [grant]).error, /does not cover peer/);
    const site = createChallenge({ origin: 'https://app.example', network: 'regtest', now: NOW });
    const readSite = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: site.uri, origin: 'https://app.example', now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    assert.match(d.authorize(readSite, [grant]).error, /site sign-ins/);

    // An origin-limited grant needs the origin the requester saw, not the peer's claim.
    const limited = d.readGrant(d.createGrant({ grantee: PASSPORT_KEY.pubkey, scopes: ['passport'], origins: ['https://app.example'], now: NOW + 1 }, DESK.identity.key).uri, { now: NOW + 2 });
    const claimed = handshake({ challenge: { origin: 'https://app.example' } }).challenge;
    const unreported = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: limited.hash, request: claimed.uri, sessionKey: SESSION.pubkey, clientNonce: claimed.clientNonce, now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    assert.strictEqual(unreported.ok, true, unreported.error);
    assert.match(d.authorize(unreported, [limited]).error, /without a reported origin/);
    const reported = d.readRequest(d.createRequest({ target: DESK.identity.pubkey, grant: limited.hash, request: claimed.uri, origin: 'https://app.example', sessionKey: SESSION.pubkey, clientNonce: claimed.clientNonce, now: NOW + 30 }, PASSPORT_KEY).uri, { now: NOW + 40 });
    // A reported origin never stands in for the peer: a grant without that
    // peer listed does not sign a peer session, whatever origin it names.
    assert.match(d.authorize(reported, [limited]).error, /does not cover peer/);
  });

  it('a peer sign-in request names the clientNonce the challenge echoes', function () {
    const PASSPORT_KEY = USER.identity.key;
    const grant = d.readGrant(d.createGrant({ grantee: PASSPORT_KEY.pubkey, scopes: ['passport'], peers: [PEER.pubkey], now: NOW }, DESK.identity.key).uri, { now: NOW });
    const { connect, challenge } = handshake({ challenge: { origin: null } });
    const base = { target: DESK.identity.pubkey, grant: grant.hash, request: challenge.uri, sessionKey: SESSION.pubkey, now: NOW + 30 };
    assert.throws(() => d.createRequest(base, PASSPORT_KEY), /clientNonce/);
    const other = createConnect({ peer: PEER.pubkey, now: NOW }).clientNonce;
    assert.throws(() => d.createRequest(Object.assign({ clientNonce: other }, base), PASSPORT_KEY), /different clientNonce/);
    const site = createChallenge({ origin: 'https://app.example', network: 'regtest', now: NOW });
    assert.throws(() => d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: site.uri, origin: 'https://app.example', clientNonce: connect.clientNonce, now: NOW + 30 }, PASSPORT_KEY), /peer sign-ins only/);

    const made = d.createRequest(Object.assign({ clientNonce: connect.clientNonce }, base), PASSPORT_KEY);
    const fields = made.message.toFields();
    const resign = (changes) => Message.fromFields('DELEGATION_REQUEST', Object.assign({}, fields, changes)).signWithKey(PASSPORT_KEY);
    assert.strictEqual(Number(fields.v), d.DELEGATION_VERSION);
    assert.match(d.readRequest(resign({ clientNonce: '' }).toBuffer(), { now: NOW + 40 }).error, /needs a clientNonce/);
    assert.match(d.readRequest(resign({ clientNonce: other }).toBuffer(), { now: NOW + 40 }).error, /different clientNonce/);
    assert.match(d.readRequest(resign({ v: 2 }).toBuffer(), { now: NOW + 40 }).error, /unsupported delegation version/);
    // A site sign-in carries the same fields, empty.
    const siteRequest = d.createRequest({ target: DESK.identity.pubkey, grant: grant.hash, request: site.uri, origin: 'https://app.example', now: NOW + 30 }, PASSPORT_KEY);
    const siteFields = siteRequest.message.toFields();
    assert.strictEqual(Number(siteFields.v), d.DELEGATION_VERSION);
    assert.strictEqual(siteFields.sessionKey, '');
    assert.strictEqual(siteFields.clientNonce, '');
  });

  it('restrictions are required fields: a request or grant without them does not decode', function () {
    const PASSPORT_KEY = USER.identity.key;
    const grant = d.createGrant({ grantee: PASSPORT_KEY.pubkey, scopes: ['passport'], peers: [PEER.pubkey], now: NOW }, DESK.identity.key);
    const open = d.createGrant({ grantee: PASSPORT_KEY.pubkey, scopes: ['passport'], now: NOW }, DESK.identity.key);
    assert.strictEqual(Number(grant.message.toFields().v), d.DELEGATION_VERSION);
    assert.strictEqual(Number(open.message.toFields().v), d.DELEGATION_VERSION);
    assert.strictEqual(open.message.toFields().peers, '');
    assert.deepStrictEqual(d.readGrant(open.uri, { now: NOW }).grant.peers, []);
    const site = createChallenge({ origin: 'https://app.example', network: 'regtest', now: NOW });
    const request = d.createRequest({ target: DESK.identity.pubkey, grant: open.hash, request: site.uri, origin: 'https://app.example', now: NOW + 30 }, PASSPORT_KEY);
    // The same frames with the last (empty) field cut off, signed again.
    for (const [type, made, read] of [['DELEGATION_GRANT', open, d.readGrant], ['DELEGATION_REQUEST', request, d.readRequest]]) {
      const whole = Message.fromVector([type, made.message.raw.data]).signWithKey(PASSPORT_KEY);
      const cut = Message.fromVector([type, made.message.raw.data.slice(0, -2)]).signWithKey(PASSPORT_KEY);
      assert.doesNotMatch(String(read(whole.toBuffer(), { now: NOW + 40 }).error), /malformed/);
      assert.match(read(cut.toBuffer(), { now: NOW + 40 }).error, new RegExp(`malformed ${type} body`));
    }
    assert.strictEqual(grant.message.toFields().peers, PEER.pubkey);
  });
});
