'use strict';

const Identity = require('../types/identity');
const assert = require('assert');
const bip39 = require('../functions/bip39');
const BIP32 = require('../functions/bip32').default;
const ecc = require('../types/ecc');
const { FABRIC_KEY_DERIVATION_PATH, bitcoinReceiveDerivationPath, fabricIdentityDerivationPath, fabricIdentityAccountPath, fabricCoinTypeForNetwork, resolveFabricIdentityCoinType, FABRIC_COIN_TYPE_MAINNET, FABRIC_COIN_TYPE_TESTNET } = require('../constants');
let nobleSecp256k1 = null;
try {
  nobleSecp256k1 = require('@noble/curves/secp256k1.js');
} catch (error) {
  // Support older noble-curves subpath exports used in some CI environments.
  nobleSecp256k1 = require('@noble/curves/secp256k1');
}
const { secp256k1, schnorr: nobleSchnorr } = nobleSecp256k1;
const crypto = require('crypto');

const SAMPLE = {
  seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
};

describe('@fabric/core/types/identity', function () {
  describe('Identity', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Identity instanceof Function, true);
    });

    it('can create a new ECDSA identity', function () {
      const identity = new Identity();
      assert.ok(identity);
    });

    it('provides the Fabric-path public key for a known seed phrase', function () {
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const actualPubkey = identity.pubkey;

      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const child = root.derivePath(FABRIC_KEY_DERIVATION_PATH);
      const expectedPubkey = Buffer.from(
        secp256k1.getPublicKey(child.privateKey, true)
      ).toString('hex');

      assert.ok(identity);
      assert.equal(identity.derivation, FABRIC_KEY_DERIVATION_PATH);
      assert.equal(actualPubkey, expectedPubkey);
      // Master pubkey must differ from Fabric identity pubkey.
      const masterPubkey = Buffer.from(
        secp256k1.getPublicKey(root.privateKey, true)
      ).toString('hex');
      assert.notEqual(actualPubkey, masterPubkey);
    });

    it('keeps Bitcoin fund paths on coin type 0 from the master', function () {
      const identity = new Identity({ seed: SAMPLE.seed });
      const fundPath = bitcoinReceiveDerivationPath(0, 0);
      const fund = identity.master.derive(fundPath);
      assert.ok(fund.pubkey);
      assert.notEqual(fund.pubkey, identity.pubkey);
      assert.match(fundPath, /^m\/84'\/0'\//);
    });

    it('uses coin type 7778 by default and 7777 on mainnet', function () {
      assert.strictEqual(fabricCoinTypeForNetwork('regtest'), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricCoinTypeForNetwork('testnet'), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricCoinTypeForNetwork('signet'), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricCoinTypeForNetwork('mainnet'), FABRIC_COIN_TYPE_MAINNET);
      assert.strictEqual(resolveFabricIdentityCoinType('regtest'), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(resolveFabricIdentityCoinType('mainnet'), FABRIC_COIN_TYPE_MAINNET);
      assert.strictEqual(resolveFabricIdentityCoinType(7777), FABRIC_COIN_TYPE_MAINNET);
      assert.strictEqual(resolveFabricIdentityCoinType(), FABRIC_COIN_TYPE_TESTNET);
      assert.strictEqual(fabricIdentityDerivationPath(0, 0), FABRIC_KEY_DERIVATION_PATH);
      assert.strictEqual(fabricIdentityDerivationPath(0, 0, 'mainnet'), "m/7777'/7777'/0'/0/0");
      assert.strictEqual(fabricIdentityAccountPath(0), "m/7777'/7778'/0'");
      assert.strictEqual(fabricIdentityAccountPath(0, 'mainnet'), "m/7777'/7777'/0'");
      assert.strictEqual(
        fabricIdentityDerivationPath(2, 3, 'regtest'),
        fabricIdentityAccountPath(2, 'regtest') + '/0/3'
      );

      const reg = new Identity({ seed: SAMPLE.seed, network: 'regtest' });
      const main = new Identity({ seed: SAMPLE.seed, network: 'mainnet' });
      assert.strictEqual(reg.derivation, "m/7777'/7778'/0'/0/0");
      assert.strictEqual(main.derivation, "m/7777'/7777'/0'/0/0");
      assert.notEqual(reg.pubkey, main.pubkey);
    });

    it('can derive child keys from the master', function () {
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const actualChild = identity.key.derive('m/0');
      const actualChildPubkey = actualChild.pubkey;

      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const child = root.derivePath('m/0');
      const expectedChildPubkey = Buffer.from(
        secp256k1.getPublicKey(child.privateKey, true)
      ).toString('hex');

      assert.ok(actualChild);
      assert.equal(actualChildPubkey, expectedChildPubkey);
      assert.notEqual(actualChildPubkey, identity.pubkey);
    });

    it('can sign and verify messages with the Fabric key', function () {
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const message = 'Hello, Fabric!';
      const actualSignature = identity.sign(message);
      const actualVerified = identity.fabricKey.verify(message, actualSignature);

      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const fabricNode = root.derivePath(FABRIC_KEY_DERIVATION_PATH);
      const msgHash = require('../functions/taggedHash')('Fabric/Sign', Buffer.from(message));
      const expectedSig = nobleSchnorr.sign(msgHash, fabricNode.privateKey, Buffer.alloc(32));
      const xOnlyPubkey = Buffer.from(
        secp256k1.getPublicKey(fabricNode.privateKey, true)
      ).slice(1); // drop prefix for x-only
      const expectedVerified = nobleSchnorr.verify(expectedSig, msgHash, xOnlyPubkey);
      const actualBytes = Buffer.isBuffer(actualSignature)
        ? actualSignature
        : Buffer.from(actualSignature);

      assert.ok(actualSignature);
      assert.equal(actualVerified, true);
      assert.equal(actualVerified, expectedVerified);
      assert.ok(actualBytes.equals(Buffer.from(expectedSig)),
        'Identity.sign must match noble BIP340 over taggedHash("Fabric/Sign") with zero auxRand');
    });
  });
});

const {
  IdentityLock,
  clampLockTimeoutMinutes,
  lockTimeoutMinutesToMs,
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  MAX_LOCK_TIMEOUT_MINUTES
} = require('../functions/identityLock');

function fakeClock () {
  let now = 1_000_000;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => now,
    advance (ms) {
      now += ms;
      for (const [id, t] of [...timers.entries()]) {
        if (t.fireAt <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    setTimeout (fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, fireAt: now + ms });
      return id;
    },
    clearTimeout (id) {
      timers.delete(id);
    }
  };
}

describe('@fabric/core/functions/identityLock', function () {
  it('clamps timeout minutes (0 disables)', function () {
    assert.strictEqual(clampLockTimeoutMinutes(0), 0);
    assert.strictEqual(clampLockTimeoutMinutes(-3), DEFAULT_LOCK_TIMEOUT_MINUTES);
    assert.strictEqual(clampLockTimeoutMinutes(99999), MAX_LOCK_TIMEOUT_MINUTES);
    assert.strictEqual(lockTimeoutMinutesToMs(0), 0);
    assert.strictEqual(lockTimeoutMinutesToMs(1), 60 * 1000);
  });

  it('holds a payload only while unlocked', function () {
    const lock = new IdentityLock({ timeoutMinutes: 0 });
    assert.strictEqual(lock.locked, true);
    lock.unlock({ xprv: 'secret' });
    assert.strictEqual(lock.locked, false);
    assert.deepStrictEqual(lock.peek(), { xprv: 'secret' });
    lock.lock();
    assert.strictEqual(lock.locked, true);
    assert.strictEqual(lock.peek(), null);
  });

  it('auto-locks after idle timeout and resets on touch', function () {
    const clock = fakeClock();
    const lock = new IdentityLock({
      timeoutMs: 50,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout
    });
    const events = [];
    lock.on('lock', () => events.push('lock'));
    lock.on('unlock', () => events.push('unlock'));
    lock.on('touch', () => events.push('touch'));

    lock.unlock({ ok: true });
    clock.advance(40);
    assert.strictEqual(lock.locked, false);
    lock.touch();
    clock.advance(40);
    assert.strictEqual(lock.locked, false, 'touch should reset the idle timer');
    clock.advance(20);
    assert.strictEqual(lock.locked, true);
    assert.deepStrictEqual(events, ['unlock', 'touch', 'lock']);
  });

  it('setTimeoutMinutes(0) disables auto-lock', function () {
    const clock = fakeClock();
    const lock = new IdentityLock({
      timeoutMs: 10,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout
    });
    lock.unlock({ ok: true });
    lock.setTimeoutMinutes(0);
    clock.advance(1000);
    assert.strictEqual(lock.locked, false);
    assert.strictEqual(lock.timeoutMinutes, 0);
  });

  it('unref()s the idle timer so Node can exit', function () {
    const lock = new IdentityLock({ timeoutMinutes: 30 });
    lock.unlock({ ok: true });
    assert.ok(lock._timer);
    assert.strictEqual(typeof lock._timer.unref, 'function');
    assert.strictEqual(lock._timer.hasRef(), false);
    lock.lock();
  });
});

const Key = require('../types/key');
const {
  CROSS_SIGN_PREFIX,
  REVOKE_PREFIX,
  CROSS_SIGN_TAG,
  REVOKE_TAG,
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage,
  parseCrossSignMessage,
  parseRevokeMessage,
  buildCrossSignObject,
  buildRevokeObject,
  coerceCrossSignObject,
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

function sessionId () {
  return crypto.randomBytes(24).toString('hex');
}

const ORIGIN = 'https://hub.fabric.pub';
const TEST_TAG = 'Fabric/Test';

function linkFields (peer, extra = {}) {
  return Object.assign({ peerPubkey: peer.pubkey, nonce: nonce(), sessionId: sessionId(), origin: ORIGIN }, extra);
}

describe('@fabric/core/types/key tagged Schnorr', function () {
  it('signs and verifies only under the same tag', function () {
    const key = new Key();
    const sig = key.signSchnorr('hello', 'Fabric/One');
    assert.strictEqual(key.verifySchnorr('hello', sig, 'Fabric/One'), true);
    assert.strictEqual(key.verifySchnorr('hello', sig, 'Fabric/Two'), false);
  });

  it('refuses to sign or verify without a Fabric purpose tag', function () {
    const key = new Key();
    assert.throws(() => key.signSchnorr('hello'), /tag required/);
    assert.throws(() => key.signSchnorr('hello', 'Nostr'), /tag required/);
    const sig = key.signSchnorr('hello', 'Fabric/One');
    assert.throws(() => key.verifySchnorr('hello', sig), /tag required/);
  });

  it('a signature over plain sha256 (Nostr, legacy) does not verify', function () {
    const priv = crypto.randomBytes(32);
    const key = new Key({ private: priv.toString('hex') });
    const untagged = nobleSchnorr.sign(crypto.createHash('sha256').update('hello').digest(), priv, Buffer.alloc(32));
    assert.strictEqual(key.verifySchnorr('hello', Buffer.from(untagged), 'Fabric/One'), false);
  });

  it('Key#sign uses the generic Fabric/Sign tag', function () {
    const key = new Key();
    const sig = key.sign('hello');
    assert.strictEqual(key.verify('hello', sig), true);
    assert.strictEqual(key.verifySchnorr('hello', sig, Key.SIGN_TAG), true);
    assert.strictEqual(key.verifySchnorr('hello', sig, 'Fabric/Other'), false);
  });
});

describe('@fabric/core/functions/identityCrossSign', function () {
  const a = '02' + 'aa'.repeat(32);
  const b = '03' + 'bb'.repeat(32);

  it('round-trips the canonical cross-sign string with session and origin', function () {
    const n = 'ab'.repeat(32);
    const sid = 'cd'.repeat(24);
    const msg = buildCrossSignMessage({ sessionId: sid, nonce: n, localPubkey: a, peerPubkey: b, origin: 'http://127.0.0.1:8080/x' });
    assert.strictEqual(msg, `${CROSS_SIGN_PREFIX}:${sid}:${n}:${a}:${b}:http://127.0.0.1:8080`);
    assert.ok(CROSS_SIGN_PREFIX.endsWith(':2'));
    const parsed = parseCrossSignMessage(msg);
    assert.deepStrictEqual(parsed, { sessionId: sid, nonce: n, localPubkey: a, peerPubkey: b, origin: 'http://127.0.0.1:8080' });
  });

  it('round-trips revoke messages, which sign their time', function () {
    const n = 'cd'.repeat(32);
    const sid = 'ef'.repeat(24);
    const msg = buildRevokeMessage({ sessionId: sid, nonce: n, localPubkey: a, peerPubkey: b, origin: ORIGIN, revokedAt: 1700000000000 });
    assert.ok(msg.startsWith(REVOKE_PREFIX + ':'));
    const parsed = parseRevokeMessage(msg);
    assert.strictEqual(parsed.revokedAt, 1700000000000);
    assert.strictEqual(parsed.origin, ORIGIN);
    assert.strictEqual(buildRevokeMessage({ sessionId: sid, nonce: n, localPubkey: a, peerPubkey: b, origin: ORIGIN }), null);
  });

  it('refuses fields that could shift the string', function () {
    const n = 'ab'.repeat(32);
    const sid = 'cd'.repeat(24);
    const base = { sessionId: sid, nonce: n, localPubkey: a, peerPubkey: b, origin: ORIGIN };
    assert.strictEqual(buildCrossSignMessage(Object.assign({}, base, { nonce: 'short' })), null);
    assert.strictEqual(buildCrossSignMessage(Object.assign({}, base, { sessionId: sid + ':x' })), null);
    assert.strictEqual(buildCrossSignMessage(Object.assign({}, base, { localPubkey: a + ':' + b })), null);
    assert.strictEqual(buildCrossSignMessage(Object.assign({}, base, { localPubkey: 'aa'.repeat(32) })), null, 'x-only keys are refused');
    assert.strictEqual(buildCrossSignMessage(Object.assign({}, base, { origin: 'fabric:evil' })), null);
    assert.strictEqual(buildCrossSignMessage(Object.assign({}, base, { origin: '' })), null);
    assert.strictEqual(buildCrossSignMessage(Object.assign({}, base, { peerPubkey: a })), null, 'self link refused');
    assert.strictEqual(isCrossSignType(SIGN_TYPE), true);
    assert.strictEqual(isCrossSignType(REVOKE_TYPE), true);
    assert.strictEqual(isCrossSignType('ChatMessage'), false);
  });

  it('refuses the v1 string', function () {
    const n = 'ab'.repeat(32);
    assert.strictEqual(parseCrossSignMessage(`fabric:identity-cross-sign:1:${n}:${a}:${b}`), null);
    assert.strictEqual(parseRevokeMessage(`fabric:identity-cross-sign-revoke:1:${n}:${a}:${b}`), null);
  });

  it('object builders drop invalid fields instead of keeping the raw string', function () {
    const sign = buildCrossSignObject({ localPubkey: a, peerPubkey: b, nonce: 'not-64-hex', sessionId: 'x' });
    const revoke = buildRevokeObject({ localPubkey: a, peerPubkey: b, nonce: 'bad:colon' });
    assert.strictEqual(sign.nonce, '');
    assert.strictEqual(sign.sessionId, '');
    assert.strictEqual(revoke.nonce, '');
    assert.strictEqual(sign.type, SIGN_TYPE);
    assert.strictEqual(revoke.type, REVOKE_TYPE);
  });

  it('unwraps CONTRACT_MESSAGE bodies', function () {
    const inner = buildCrossSignObject({ localPubkey: a, peerPubkey: b, nonce: 'ab'.repeat(32) });
    const coerced = coerceCrossSignObject({ contract: 'c', type: SIGN_TYPE, actor: {}, object: inner });
    assert.strictEqual(coerced.localPubkey, a);
    assert.strictEqual(coerced.type, SIGN_TYPE);
  });
});

describe('@fabric/core/functions/fabricIdentitySchnorr', function () {
  it('signs and verifies with Identity.fabricKey under a tag', function () {
    const ident = new Identity(new Key());
    const message = 'fabric:test:1';
    const payload = buildFabricIdentitySignedPayload(ident, message, TEST_TAG);
    assert.strictEqual(payload.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(payload.identity.id, ident.id);
    const verified = verifyIdentitySchnorr(
      message,
      payload.signature,
      payload.pubkeyHex,
      payload.identity,
      TEST_TAG
    );
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.identityId, ident.id);
    assert.strictEqual(fabricIdentityIdFromPubkeyHex(payload.pubkeyHex), ident.id);
    const otherTag = verifyIdentitySchnorr(message, payload.signature, payload.pubkeyHex, payload.identity, 'Fabric/Other');
    assert.strictEqual(otherTag.ok, false);
    const noTag = verifyIdentitySchnorr(message, payload.signature, payload.pubkeyHex, payload.identity);
    assert.strictEqual(noTag.ok, false);
    assert.throws(() => buildFabricIdentitySignedPayload(ident, message), /tag required/);
  });

  it('signs Passport-style leaf private + fabric-path xpub', function () {
    const ident = new Identity(new Key());
    const fabric = ident.fabricKey;
    const priv = Buffer.isBuffer(fabric.private)
      ? fabric.private.toString('hex')
      : String(fabric.private);
    const message = 'fabric:test:leaf';
    const payload = buildFabricIdentitySignedPayload({
      privateKeyHex: priv,
      xpub: fabric.xpub
    }, message, TEST_TAG);
    assert.strictEqual(payload.pubkeyHex, fabric.pubkey);
    const verified = verifyIdentitySchnorr(
      message,
      payload.signature,
      payload.pubkeyHex,
      payload.identity,
      TEST_TAG
    );
    assert.strictEqual(verified.ok, true);
  });

  it('rejects a tampered signature', function () {
    const ident = new Identity(new Key());
    const message = 'fabric:test:1';
    const payload = buildFabricIdentitySignedPayload(ident, message, TEST_TAG);
    const flipped = payload.signature.replace(/[0-9a-f]$/, (c) => (c === '0' ? '1' : '0'));
    const verified = verifyIdentitySchnorr(
      message,
      flipped,
      payload.pubkeyHex,
      payload.identity,
      TEST_TAG
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
    const obj = signCrossSign(ident, linkFields(peer));
    assert.strictEqual(obj.type, SIGN_TYPE);
    assert.strictEqual(obj.origin, ORIGIN);
    const v = verifyCrossSignObject(obj, ident.fabricKey.pubkey);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.kind, SIGN_TYPE);
    assert.strictEqual(v.record.sessionId, obj.sessionId);
    assert.strictEqual(v.record.origin, ORIGIN);
  });

  it('signs over the IdentityCrossSign tag', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, linkFields(peer));
    const message = buildCrossSignMessage(obj);
    const key = new Key({ xpub: obj.identity.xpub });
    assert.strictEqual(key.verifySchnorr(message, Buffer.from(obj.signature, 'hex'), CROSS_SIGN_TAG), true);
    assert.strictEqual(key.verifySchnorr(message, Buffer.from(obj.signature, 'hex'), REVOKE_TAG), false);
  });

  it('rejects a tampered peer pubkey, session, or origin', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, linkFields(peer));
    assert.strictEqual(verifyCrossSignObject(Object.assign({}, obj, { peerPubkey: new Identity(new Key()).pubkey })).ok, false);
    assert.strictEqual(verifyCrossSignObject(Object.assign({}, obj, { sessionId: sessionId() })).ok, false);
    assert.strictEqual(verifyCrossSignObject(Object.assign({}, obj, { origin: 'https://evil.example' })).ok, false);
  });

  it('a cross-sign signature does not verify as a revoke', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, linkFields(peer));
    const asRevoke = Object.assign({}, obj, { type: REVOKE_TYPE, '@type': REVOKE_TYPE, revokedAt: Date.now() });
    assert.strictEqual(verifyCrossSignObject(asRevoke).ok, false);
  });

  it('refuses a v1 body', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, linkFields(peer));
    const v1 = Object.assign({}, obj, { sessionId: undefined, origin: undefined });
    assert.strictEqual(verifyCrossSignObject(v1).ok, false);
  });

  it('verifies a CONTRACT_MESSAGE-wrapped body', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, linkFields(peer));
    const v = verifyCrossSignObject({ contract: 'x', type: SIGN_TYPE, actor: { publicKey: 'y' }, object: obj });
    assert.strictEqual(v.ok, true);
  });

  it('signs revoke bodies', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const obj = signCrossSign(ident, linkFields(peer), REVOKE_TYPE);
    assert.strictEqual(obj.type, REVOKE_TYPE);
    assert.ok(obj.revokedAt > 0);
    const v = verifyCrossSignObject(obj);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.kind, REVOKE_TYPE);
    assert.strictEqual(verifyCrossSignObject(Object.assign({}, obj, { revokedAt: obj.revokedAt + 1 })).ok, false);
  });

  it('reports the canonical signed fields for an aliased body, so a revoke still names it', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    for (const kind of [SIGN_TYPE, REVOKE_TYPE]) {
      const obj = signCrossSign(ident, linkFields(peer), kind);
      const canonical = verifyCrossSignObject(obj);
      assert.strictEqual(canonical.ok, true);
      const alias = Object.assign({}, obj, {
        sessionId: ` 0x${obj.sessionId.toUpperCase()} `,
        nonce: `0x${obj.nonce}`,
        localPubkey: `0x${obj.localPubkey}`,
        peerPubkey: ` ${obj.peerPubkey.toUpperCase()}`
      });
      const v = verifyCrossSignObject(alias);
      assert.strictEqual(v.ok, true, kind);
      assert.deepStrictEqual(v.record, canonical.record, kind);
    }
  });

  it('signs a raw HD Key with fabricKey pubkey, not the master', function () {
    const master = new Key();
    const ident = new Identity(master);
    const peer = new Identity(new Key());
    const obj = signCrossSign(master, linkFields(peer));
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
    }, linkFields(peer));
    assert.strictEqual(obj.localPubkey.toLowerCase(), fabric.pubkey.toLowerCase());
    const v = verifyCrossSignObject(obj);
    assert.strictEqual(v.ok, true);
  });

  it('rejects an unknown kind and missing fields', function () {
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    assert.throws(() => signCrossSign(ident, linkFields(peer), 'ChatMessage'), /unknown cross-sign type/i);
    assert.throws(() => signCrossSign(ident, null, SIGN_TYPE), /fields required/i);
    assert.throws(() => signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() }), /invalid cross-sign fields/i);
  });
});
