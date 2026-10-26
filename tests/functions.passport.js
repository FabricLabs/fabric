'use strict';

const assert = require('assert');
const Message = require('../types/message');
const {
  PASSPORT_CHALLENGE,
  PASSPORT_ASSERTION,
  PASSPORT_SIGN_REQUEST,
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
  verifyAssertion,
  createSignRequest,
  readSignRequest,
  pairingCode
} = require('../functions/passport');

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

  it('registers the three opcodes with field schemas, never relayed', function () {
    assert.strictEqual(PASSPORT_CHALLENGE, 0x4240);
    assert.strictEqual(PASSPORT_ASSERTION, 0x4241);
    assert.strictEqual(PASSPORT_SIGN_REQUEST, 0x4242);
    assert.strictEqual(PASSPORT_MAX_TTL_MS, 3 * 60 * 1000);
    for (const type of ['PASSPORT_CHALLENGE', 'PASSPORT_ASSERTION', 'PASSPORT_SIGN_REQUEST']) {
      assert.ok(Message.getBodySchema(type), type);
      assert.strictEqual(Message.canonicalTypeName(Message.canonicalTypeCode(type)), type);
      assert.strictEqual(classifyGossipWireType(type), 'hub', type);
      assert.strictEqual(isPublicGossipFloodType(type), false, type);
      assert.strictEqual(isRelayAsIsWireType(type), false, type);
    }
    assert.strictEqual(Message.canonicalTypeCode('PassportAssertion'), PASSPORT_ASSERTION);
    assert.strictEqual(Message.canonicalTypeName(0x4230), null);
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

  it('wraps a challenge in a sign request for a paired desktop', function () {
    const c = challenge({ request: ['wallet', 'cosigner'] });
    const req = createSignRequest({ challenge: c.uri, origin: SITE, account: 2, disclose: ['wallet'], now: NOW + 100 }, DEVICE);
    assert.ok(req.expiresAt <= c.expiresAt);
    const read = readSignRequest(req.uri, { now: NOW + 200 });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.author, DEVICE.pubkey.slice(2));
    assert.strictEqual(read.account, 2);
    assert.deepStrictEqual(read.disclose, ['wallet']);
    assert.strictEqual(read.challengeHash, c.hash);
    assert.strictEqual(read.challenge.network, 'regtest');

    // The desktop answers with the challenge it was handed.
    const desk = deriveAccount(MASTER, { account: read.account, network: read.challenge.network });
    const a = signAssertion({
      challenge: read.challengeBuffer,
      origin: read.origin,
      signer: 'hub',
      network: read.challenge.network,
      disclose: read.disclose,
      wallet: desk.wallet,
      device: DEVICE.pubkey,
      now: NOW + 300
    }, desk.identity.key);
    const v = verifyAssertion(a.uri, expected(c));
    assert.strictEqual(v.ok, true, v.error);
    assert.strictEqual(v.signer, 'hub');
    assert.strictEqual(v.device, DEVICE.pubkey);
    assert.ok(v.wallet);

    assert.throws(() => createSignRequest({ challenge: c.uri, origin: 'https://evil.example', now: NOW }, DEVICE), /different origin/);
    assert.throws(() => createSignRequest({ challenge: challenge().uri, origin: SITE, disclose: ['cosigner'], now: NOW }, DEVICE), /did not ask/);
    assert.match(readSignRequest(req.uri, { now: NOW + 10 * 60 * 1000 }).error, /expired/);
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
      assert.strictEqual(readSignRequest(uri, { now: NOW }).ok, false);
    }
    assert.strictEqual(readChallenge(a.uri, { now: NOW }).ok, false);
    assert.strictEqual(verifyAssertion(c.uri, expected(c)).ok, false);
  });

  it('derives the same six-digit pairing code on both devices', function () {
    const a = ACCOUNT.identity.pubkey;
    const b = OTHER.identity.pubkey;
    const code = pairingCode(a, b);
    assert.match(code, /^[0-9]{6}$/);
    assert.strictEqual(pairingCode(b, a), code);
    assert.strictEqual(pairingCode(a.slice(2), b), code);
    assert.notStrictEqual(pairingCode(a, DEVICE.pubkey), code);
    assert.throws(() => pairingCode(a, a), /itself/);
  });
});
