'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('../types/key');
const Identity = require('../types/identity');
const {
  CROSS_SIGN_PREFIX,
  REVOKE_PREFIX,
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage,
  parseCrossSignMessage,
  parseRevokeMessage,
  buildCrossSignObject,
  buildRevokeObject,
  isCrossSignType
} = require('../functions/identityCrossSign');
const {
  fabricIdentityIdFromPubkeyHex,
  buildFabricIdentitySignedPayload,
  verifyIdentitySchnorr
} = require('../functions/fabricIdentitySchnorr');
const {
  signCrossSign,
  verifyCrossSignObject
} = require('../functions/identityCrossSignVerify');

function nonce () {
  return crypto.randomBytes(32).toString('hex');
}

describe('@fabric/core/functions/identityCrossSign', function () {
  it('round-trips the canonical cross-sign string', function () {
    const n = 'ab'.repeat(32);
    const a = '02' + 'aa'.repeat(32);
    const b = '03' + 'bb'.repeat(32);
    const msg = buildCrossSignMessage(n, a, b);
    assert.ok(msg.startsWith(CROSS_SIGN_PREFIX));
    const parsed = parseCrossSignMessage(msg);
    assert.strictEqual(parsed.nonce, n);
    assert.strictEqual(parsed.localPubkey, a.toLowerCase());
    assert.strictEqual(parsed.peerPubkey, b.toLowerCase());
  });

  it('round-trips revoke messages and rejects a short nonce', function () {
    const n = 'cd'.repeat(32);
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    const msg = buildRevokeMessage(n, a, b);
    assert.ok(msg.startsWith(REVOKE_PREFIX));
    const parsed = parseRevokeMessage(msg);
    assert.strictEqual(parsed.nonce, n);
    assert.strictEqual(parsed.localPubkey, a);
    assert.strictEqual(parsed.peerPubkey, b);
    assert.strictEqual(buildCrossSignMessage('short', a, b), null);
    assert.strictEqual(buildRevokeMessage(n, '', b), null);
    assert.strictEqual(buildCrossSignMessage(n, 'aa', b), null);
    assert.strictEqual(buildCrossSignMessage(n, a + ':' + b, b), null);
    const with0x = buildRevokeMessage('0x' + n, '0x' + a, b);
    assert.strictEqual(with0x, msg);
    assert.strictEqual(isCrossSignType(SIGN_TYPE), true);
    assert.strictEqual(isCrossSignType(REVOKE_TYPE), true);
    assert.strictEqual(isCrossSignType('ChatMessage'), false);
  });

  it('object builders drop an invalid nonce instead of keeping the raw string', function () {
    const a = '02' + 'aa'.repeat(32);
    const b = '03' + 'bb'.repeat(32);
    const sign = buildCrossSignObject({ localPubkey: a, peerPubkey: b, nonce: 'not-64-hex' });
    const revoke = buildRevokeObject({ localPubkey: a, peerPubkey: b, nonce: 'bad:colon' });
    assert.strictEqual(sign.nonce, '');
    assert.strictEqual(revoke.nonce, '');
    assert.strictEqual(sign.type, SIGN_TYPE);
    assert.strictEqual(revoke.type, REVOKE_TYPE);
    assert.strictEqual(buildCrossSignMessage(sign.nonce, a, b), null);
  });
});

describe('@fabric/core/functions/fabricIdentitySchnorr', function () {
  it('signs and verifies with Identity.fabricKey', function () {
    const ident = new Identity(new Key());
    const message = 'fabric:hub-login:1:test';
    const payload = buildFabricIdentitySignedPayload(ident, message);
    assert.strictEqual(payload.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(payload.identity.id, ident.id);
    const verified = verifyIdentitySchnorr(
      message,
      payload.signature,
      payload.pubkeyHex,
      payload.identity
    );
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.identityId, ident.id);
    assert.strictEqual(fabricIdentityIdFromPubkeyHex(payload.pubkeyHex), ident.id);
  });

  it('signs Passport-style leaf private + fabric-path xpub', function () {
    const ident = new Identity(new Key());
    const fabric = ident.fabricKey;
    const priv = Buffer.isBuffer(fabric.private)
      ? fabric.private.toString('hex')
      : String(fabric.private);
    const message = 'fabric:device-link:id-probe';
    const payload = buildFabricIdentitySignedPayload({
      privateKeyHex: priv,
      xpub: fabric.xpub
    }, message);
    assert.strictEqual(payload.pubkeyHex, fabric.pubkey);
    const verified = verifyIdentitySchnorr(
      message,
      payload.signature,
      payload.pubkeyHex,
      payload.identity
    );
    assert.strictEqual(verified.ok, true);
  });

  it('rejects a tampered signature', function () {
    const ident = new Identity(new Key());
    const message = 'fabric:hub-login:1:test';
    const payload = buildFabricIdentitySignedPayload(ident, message);
    const flipped = payload.signature.replace(/[0-9a-f]$/, (c) => (c === '0' ? '1' : '0'));
    const verified = verifyIdentitySchnorr(
      message,
      flipped,
      payload.pubkeyHex,
      payload.identity
    );
    assert.strictEqual(verified.ok, false);
  });

  it('rejects truncated or non-hex pubkey bytes', function () {
    assert.throws(() => fabricIdentityIdFromPubkeyHex('02aa' + 'zz'), /invalid pubkey|66 hex/i);
    assert.throws(() => fabricIdentityIdFromPubkeyHex('02aa'), /66 hex/i);
    assert.throws(() => fabricIdentityIdFromPubkeyHex('0'), /invalid pubkey|66 hex/i);
    assert.throws(() => fabricIdentityIdFromPubkeyHex(''), /Missing pubkey/i);
  });
});

describe('@fabric/core/functions/identityCrossSignVerify', function () {
  it('signs and verifies with Fabric Identity.fabricKey', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() });
    assert.strictEqual(obj.type, SIGN_TYPE);
    const v = verifyCrossSignObject(obj, ident.fabricKey.pubkey);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.kind, SIGN_TYPE);
  });

  it('rejects a tampered peer pubkey', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() });
    obj.peerPubkey = new Identity(new Key()).pubkey;
    const v = verifyCrossSignObject(obj);
    assert.strictEqual(v.ok, false);
  });

  it('signs revoke bodies', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() }, REVOKE_TYPE);
    assert.strictEqual(obj.type, REVOKE_TYPE);
    const v = verifyCrossSignObject(obj);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.kind, REVOKE_TYPE);
  });

  it('signs a raw HD Key with fabricKey pubkey, not the master', function () {
    const master = new Key();
    const ident = new Identity(master);
    const peer = new Identity(new Key());
    const obj = signCrossSign(master, { peerPubkey: peer.pubkey, nonce: nonce() });
    assert.strictEqual(obj.localPubkey.toLowerCase(), ident.fabricKey.pubkey.toLowerCase());
    assert.notStrictEqual(obj.localPubkey.toLowerCase(), String(master.pubkey).toLowerCase());
    const v = verifyCrossSignObject(obj);
    assert.strictEqual(v.ok, true);
  });

  it('signs Passport-style leaf private + fabric-path xpub', function () {
    const ident = new Identity(new Key());
    const fabric = ident.fabricKey;
    const priv = Buffer.isBuffer(fabric.private)
      ? fabric.private.toString('hex')
      : String(fabric.private);
    const peer = new Identity(new Key());
    const obj = signCrossSign({
      privateKeyHex: priv,
      xpub: fabric.xpub
    }, { peerPubkey: peer.pubkey, nonce: nonce() });
    assert.strictEqual(obj.localPubkey.toLowerCase(), fabric.pubkey.toLowerCase());
    const v = verifyCrossSignObject(obj);
    assert.strictEqual(v.ok, true);
  });

  it('rejects an unknown kind and missing fields', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    assert.throws(() => signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() }, 'ChatMessage'), /unknown cross-sign type/i);
    assert.throws(() => signCrossSign(ident, null, SIGN_TYPE), /fields required/i);
  });
});
