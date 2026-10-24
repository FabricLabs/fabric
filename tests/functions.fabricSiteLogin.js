'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  SITE_LOGIN_REQUEST,
  SITE_LOGIN_RESPONSE,
  FABRIC_SIGN_REQUEST,
  SITE_LOGIN_MAX_TTL_MS
} = require('../constants');
const { encodeFabricUri, decodeFabricUri } = require('../functions/fabricUri');
const {
  normalizeSiteOrigin,
  createSiteLoginRequest,
  readSiteLoginRequest,
  signSiteLoginResponse,
  verifySiteLoginResponse,
  createFabricSignRequest,
  readFabricSignRequest
} = require('../functions/fabricSiteLogin');

const SITE = 'https://example.com';
const NOW = 1_800_000_000_000;

function identityKey () {
  return new Key({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' })
    .derive("m/44'/7778'/0'/0/0");
}

describe('@fabric/core/functions/fabricSiteLogin', function () {
  it('registers the three opcodes with field schemas', function () {
    assert.strictEqual(Message.canonicalTypeName(SITE_LOGIN_REQUEST), 'SITE_LOGIN_REQUEST');
    assert.strictEqual(Message.canonicalTypeName(SITE_LOGIN_RESPONSE), 'SITE_LOGIN_RESPONSE');
    assert.strictEqual(Message.canonicalTypeName(FABRIC_SIGN_REQUEST), 'FABRIC_SIGN_REQUEST');
    assert.strictEqual(Message.canonicalTypeCode('SiteLoginRequest'), SITE_LOGIN_REQUEST);
    for (const type of ['SITE_LOGIN_REQUEST', 'SITE_LOGIN_RESPONSE', 'FABRIC_SIGN_REQUEST']) {
      assert.ok(Message.getBodySchema(type), type);
    }
  });

  it('normalizes origins and refuses non-web schemes', function () {
    assert.strictEqual(normalizeSiteOrigin('https://Example.com/path?x=1'), 'https://example.com');
    assert.strictEqual(normalizeSiteOrigin('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
    assert.strictEqual(normalizeSiteOrigin('null'), null);
    assert.strictEqual(normalizeSiteOrigin('chrome-extension://abc'), null);
    assert.strictEqual(normalizeSiteOrigin('https://user:pass@example.com'), null);
  });

  it('round-trips request → response → site verification', function () {
    const request = createSiteLoginRequest({ origin: SITE, purpose: 'Sign in to Example', now: NOW });
    const read = readSiteLoginRequest(request.uri, { now: NOW });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.author, null, 'unsigned request');
    assert.strictEqual(read.request.purpose, 'Sign in to Example');

    const key = identityKey();
    const response = signSiteLoginResponse({
      origin: SITE,
      nonce: read.request.nonce,
      signer: 'passport',
      xpub: key.xpub,
      now: NOW
    }, key);
    const verified = verifySiteLoginResponse(response.uri, { origin: SITE, nonce: request.nonce, now: NOW + 1000 });
    assert.strictEqual(verified.ok, true, verified.error);
    assert.strictEqual(verified.signer, 'passport');
    assert.strictEqual(verified.identity.pubkey, key.pubkey);
    assert.strictEqual(verified.identity.xpub, key.xpub);
    assert.ok(verified.identity.id.startsWith('id1'));
  });

  it('accepts a request signed by the site key', function () {
    const siteKey = new Key();
    const request = createSiteLoginRequest({ origin: SITE, now: NOW }, siteKey);
    const read = readSiteLoginRequest(request.uri, { now: NOW });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.author, siteKey.pubkey.slice(2));
  });

  it('refuses a response for another origin, another nonce, or another signer label', function () {
    const key = identityKey();
    const request = createSiteLoginRequest({ origin: SITE, now: NOW });
    const response = signSiteLoginResponse({ origin: SITE, nonce: request.nonce, signer: 'hub', now: NOW }, key);
    assert.match(verifySiteLoginResponse(response.uri, { origin: 'https://evil.example', nonce: request.nonce, now: NOW }).error, /origin/);
    assert.match(verifySiteLoginResponse(response.uri, { origin: SITE, nonce: 'f'.repeat(64), now: NOW }).error, /nonce/);
    assert.match(verifySiteLoginResponse(response.uri, { origin: SITE, nonce: request.nonce, now: NOW, signers: ['passport'] }).error, /not accepted/);
  });

  it('refuses expired responses and lifetimes over the cap', function () {
    const key = identityKey();
    const request = createSiteLoginRequest({ origin: SITE, now: NOW });
    const response = signSiteLoginResponse({ origin: SITE, nonce: request.nonce, signer: 'passport', now: NOW, ttlMs: 60000 }, key);
    assert.match(verifySiteLoginResponse(response.uri, { origin: SITE, nonce: request.nonce, now: NOW + 120000 }).error, /expired/);
    // ttl is capped when signing
    const long = signSiteLoginResponse({ origin: SITE, nonce: request.nonce, signer: 'passport', now: NOW, ttlMs: 10 * SITE_LOGIN_MAX_TTL_MS }, key);
    assert.strictEqual(long.expiresAt - long.issuedAt, SITE_LOGIN_MAX_TTL_MS);
    // a hand-built frame with a longer life is refused
    const forged = Message.fromFields('SITE_LOGIN_RESPONSE', {
      origin: SITE,
      nonce: request.nonce,
      issuedAt: BigInt(NOW),
      expiresAt: BigInt(NOW + (10 * SITE_LOGIN_MAX_TTL_MS)),
      identityId: long.identity.id,
      pubkey: key.pubkey,
      signer: 'passport'
    });
    forged.signWithKey(key);
    assert.match(verifySiteLoginResponse(encodeFabricUri(forged), { origin: SITE, nonce: request.nonce, now: NOW }).error, /too/);
  });

  it('refuses a response whose pubkey is not the frame author', function () {
    const key = identityKey();
    const other = new Key();
    const request = createSiteLoginRequest({ origin: SITE, now: NOW });
    const response = signSiteLoginResponse({ origin: SITE, nonce: request.nonce, signer: 'passport', now: NOW }, key);
    const fields = response.message.toFields();
    const forged = Message.fromFields('SITE_LOGIN_RESPONSE', Object.assign({}, fields, { pubkey: key.pubkey }));
    forged.signWithKey(other);
    assert.match(verifySiteLoginResponse(encodeFabricUri(forged), { origin: SITE, nonce: request.nonce, now: NOW }).error, /author/);
  });

  it('refuses a request frame where a response is expected', function () {
    const request = createSiteLoginRequest({ origin: SITE, now: NOW }, new Key());
    assert.match(verifySiteLoginResponse(request.uri, { origin: SITE, nonce: request.nonce, now: NOW }).error, /not allowed/);
  });

  it('wraps a site request for a desktop app and reads it back', function () {
    const device = new Key();
    const request = createSiteLoginRequest({ origin: SITE, now: NOW });
    const signRequest = createFabricSignRequest({ request: request.uri, origin: SITE, now: NOW }, device);
    assert.ok(signRequest.expiresAt <= request.expiresAt);
    const read = readFabricSignRequest(signRequest.uri, { now: NOW });
    assert.strictEqual(read.ok, true, read.error);
    assert.strictEqual(read.author, device.pubkey.slice(2));
    assert.strictEqual(read.origin, SITE);
    assert.strictEqual(read.request.nonce, request.nonce);
    assert.notStrictEqual(read.nonce, request.nonce);
  });

  it('refuses a sign request whose site request names another origin', function () {
    const device = new Key();
    const claimed = createSiteLoginRequest({ origin: 'https://claimed.example', now: NOW });
    assert.throws(() => createFabricSignRequest({ request: claimed.uri, origin: SITE, now: NOW }, device), /different origin/);
    const forged = Message.fromFields('FABRIC_SIGN_REQUEST', {
      origin: SITE,
      nonce: 'b'.repeat(64),
      issuedAt: BigInt(NOW),
      expiresAt: BigInt(NOW + 60000),
      inner: decodeFabricUri(claimed.uri, { allowUnsigned: true }).buffer
    });
    forged.signWithKey(device);
    assert.match(readFabricSignRequest(encodeFabricUri(forged), { now: NOW }).error, /different origin/);
  });

  it('refuses an unsigned or expired sign request', function () {
    const request = createSiteLoginRequest({ origin: SITE, now: NOW });
    const unsigned = Message.fromFields('FABRIC_SIGN_REQUEST', {
      origin: SITE,
      nonce: 'a'.repeat(64),
      issuedAt: BigInt(NOW),
      expiresAt: BigInt(NOW + 60000),
      inner: decodeFabricUri(request.uri, { allowUnsigned: true }).buffer
    });
    assert.match(readFabricSignRequest(encodeFabricUri(unsigned), { now: NOW }).error, /unsigned/);
    const signRequest = createFabricSignRequest({ request: request.uri, origin: SITE, now: NOW, ttlMs: 30000 }, new Key());
    assert.match(readFabricSignRequest(signRequest.uri, { now: NOW + 120000 }).error, /expired/);
  });
});
