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
      assert.match(fundPath, /^m\/44'\/0'\//);
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
      assert.strictEqual(fabricIdentityDerivationPath(0, 0, 'mainnet'), "m/44'/7777'/0'/0/0");
      assert.strictEqual(fabricIdentityAccountPath(0), "m/44'/7778'/0'");
      assert.strictEqual(fabricIdentityAccountPath(0, 'mainnet'), "m/44'/7777'/0'");
      assert.strictEqual(
        fabricIdentityDerivationPath(2, 3, 'regtest'),
        fabricIdentityAccountPath(2, 'regtest') + '/0/3'
      );

      const reg = new Identity({ seed: SAMPLE.seed, network: 'regtest' });
      const main = new Identity({ seed: SAMPLE.seed, network: 'mainnet' });
      assert.strictEqual(reg.derivation, "m/44'/7778'/0'/0/0");
      assert.strictEqual(main.derivation, "m/44'/7777'/0'/0/0");
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
      const msgHash = crypto.createHash('sha256').update(Buffer.from(message)).digest();
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
        'Identity.sign must match noble BIP340 with zero auxRand');
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
