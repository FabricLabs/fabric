'use strict';

const assert = require('assert');
const crypto = require('crypto');
const EncryptedPromise = require('../types/promise');
const Secret = require('../types/secret');

const PASSWORD = 'correct horse battery';

describe('@fabric/core/types/promise', function () {
  this.timeout(20000);

  describe('EncryptedPromise', function () {
    it('holds plaintext unsealed without a password', function () {
      const p = new EncryptedPromise({ value: 'hello' });
      assert.strictEqual(p._state.state, 'UNSAFE');
      assert.strictEqual(p.state.seal, null);
      assert.match(p.id, /^[0-9a-f]{64}$/);
    });

    it('never derives the id from the plaintext', function () {
      const a = new EncryptedPromise({ value: 'hello' });
      const b = new EncryptedPromise({ value: 'hello' });
      const plainHash = crypto.createHash('sha256').update('hello').digest('hex');
      assert.notStrictEqual(a.id, plainHash);
      assert.notStrictEqual(a.id, b.id);
      assert.strictEqual(a.id, a.id);
    });

    it('derives the id from the ciphertext once sealed', function () {
      const p = new EncryptedPromise({ value: 'hello' });
      const before = p.id;
      p.encrypt(PASSWORD);
      assert.notStrictEqual(p.id, before);
      assert.strictEqual(p.id, crypto.createHash('sha256').update(p.state.seal.ciphertext).digest('hex'));
      p.decrypt(PASSWORD);
      assert.strictEqual(p.id, crypto.createHash('sha256').update(p.state.seal.ciphertext).digest('hex'));
    });

    it('drops the plaintext after encrypting', function () {
      const p = new EncryptedPromise({ value: 'drop me', password: PASSWORD });
      assert.strictEqual(p._state.data, null);
      assert.throws(() => p.encrypt(PASSWORD), /Nothing to encrypt/);
      assert.strictEqual(p.decrypt(PASSWORD), 'drop me');
    });

    it('drops the settings the plaintext came from when sealing', function () {
      const p = new EncryptedPromise({ value: 'drop me too' });
      p.encrypt(PASSWORD);
      assert.ok(!JSON.stringify(p.settings).includes('drop me too'));
      const q = new EncryptedPromise({ secret: 'implicit plaintext', password: PASSWORD });
      assert.ok(!JSON.stringify(q.settings).includes('implicit plaintext'));
      assert.match(q.decrypt(PASSWORD), /implicit plaintext/);
    });

    it('applies the size limit to a restored plaintext', function () {
      const { sealJson } = require('../functions/sealedBlob');
      const seal = sealJson('x'.repeat(Math.pow(2, 21) + (64 * 1000) + 1), PASSWORD, { type: 'EncryptedPromise' });
      const restored = new EncryptedPromise({ seal });
      assert.throws(() => restored.decrypt(PASSWORD), /input too large/);
      assert.strictEqual(restored._state.data, null);
    });

    it('rejects envelopes over the PBKDF2 iteration cap', function () {
      const p = new EncryptedPromise({ value: 'x', password: PASSWORD });
      const kdf = Object.assign({}, p.state.seal.kdf, { iterations: EncryptedPromise.MAX_PBKDF2_ITERATIONS + 1 });
      const seal = Object.assign({}, p.state.seal, { kdf });
      assert.throws(() => new EncryptedPromise({ seal }), /iteration count/);
      const restored = new EncryptedPromise({ seal: p.state.seal });
      restored._state.seal = seal;
      assert.throws(() => restored.decrypt(PASSWORD), /iteration count/);
    });

    it('accepts envelopes at the PBKDF2 iteration cap', function () {
      const { sealJson } = require('../functions/sealedBlob');
      const seal = sealJson('at cap', PASSWORD, { type: 'EncryptedPromise', iterations: EncryptedPromise.MAX_PBKDF2_ITERATIONS });
      assert.strictEqual(new EncryptedPromise({ seal }).decrypt(PASSWORD), 'at cap');
    });

    it('resolve returns id and message', function () {
      const p = new EncryptedPromise({ value: 'x' });
      const out = p.resolve({ ok: true });
      assert.strictEqual(out.id, p.id);
      assert.deepStrictEqual(out.msg, { ok: true });
    });

    it('round-trips through encrypt and decrypt', function () {
      const p = new EncryptedPromise({ value: 'attack at dawn', password: PASSWORD });
      assert.strictEqual(p._state.state, 'ENCRYPTED');
      assert.strictEqual(p.decrypt(PASSWORD), 'attack at dawn');
      assert.strictEqual(p._state.state, 'DECRYPTED');
    });

    it('restores from a persisted envelope and decrypts it', function () {
      const sealed = new EncryptedPromise({ value: 'persist me', password: PASSWORD });
      const persisted = JSON.parse(sealed.toString());
      const restored = new EncryptedPromise({ seal: persisted.seal });
      assert.strictEqual(restored._state.state, 'ENCRYPTED');
      assert.strictEqual(restored.decrypt(PASSWORD), 'persist me');
      assert.strictEqual(restored.id, sealed.id);
    });

    it('uses a fresh salt and IV for every seal', function () {
      const a = new EncryptedPromise({ value: 'same', password: PASSWORD });
      const b = new EncryptedPromise({ value: 'same', password: PASSWORD });
      assert.notStrictEqual(a.state.seal.ciphertext, b.state.seal.ciphertext);
      assert.notStrictEqual(a.state.seal.iv, b.state.seal.iv);
      assert.notStrictEqual(a.state.seal.kdf.salt, b.state.seal.kdf.salt);
    });

    it('rejects a wrong password', function () {
      const p = new EncryptedPromise({ value: 'secret stuff', password: PASSWORD });
      assert.throws(() => p.decrypt('not the password'), { code: 'FABRIC_SEAL_DECRYPT' });
    });

    it('rejects a tampered ciphertext', function () {
      const p = new EncryptedPromise({ value: 'secret stuff', password: PASSWORD });
      const raw = Buffer.from(p.state.seal.ciphertext, 'base64');
      raw[0] ^= 0x01;
      const restored = new EncryptedPromise({ seal: Object.assign({}, p.state.seal, { ciphertext: raw.toString('base64') }) });
      assert.throws(() => restored.decrypt(PASSWORD), { code: 'FABRIC_SEAL_DECRYPT' });
    });

    it('requires passwords of at least 8 characters', function () {
      assert.throws(() => new EncryptedPromise({ value: 'x', password: 'short' }), { code: 'FABRIC_PASSWORD_POLICY' });
    });

    it('never exposes the plaintext or password in state or toString', function () {
      const p = new EncryptedPromise({ value: 'top secret plaintext', password: PASSWORD });
      const out = p.toString();
      assert.strictEqual(p.state.type, 'EncryptedPromise');
      assert.ok(!out.includes('top secret plaintext'));
      assert.ok(!out.includes(PASSWORD));
    });

    it('does not put the password into the default plaintext', function () {
      const p = new EncryptedPromise({ label: 'wallet', password: PASSWORD });
      const plain = p.decrypt(PASSWORD);
      assert.ok(plain.includes('wallet'));
      assert.ok(!plain.includes(PASSWORD));
    });

    it('_assignState replaces the plaintext and drops the stale seal', async function () {
      const p = new EncryptedPromise({ value: 'old', password: PASSWORD });
      await p._assignState({ n: 1 });
      assert.strictEqual(p.status, 'assigned');
      assert.strictEqual(p._state.state, 'UNSAFE');
      assert.strictEqual(p.state.seal, null);
      assert.deepStrictEqual(JSON.parse(p._state.data), { n: 1 });
    });

    it('rejects input over the size limit', function () {
      assert.throws(() => new EncryptedPromise({ value: 'a'.repeat(Math.pow(2, 21) + 64001) }), /input too large/);
    });

    it('rejects an invalid envelope', function () {
      assert.throws(() => new EncryptedPromise({ seal: { ciphertext: 'abc' } }), /Invalid sealed envelope/);
    });
  });

  describe('Secret', function () {
    it('generates 32 random bytes by default', function () {
      const a = new Secret();
      const b = new Secret();
      assert.match(a.data.content, /^[0-9a-f]{64}$/);
      assert.notStrictEqual(a.data.content, b.data.content);
    });

    it('hash is SHA-256 of the secret', function () {
      const s = new Secret('preimage');
      assert.strictEqual(s.data.content, 'preimage');
      assert.strictEqual(s.hash, crypto.createHash('sha256').update('preimage').digest('hex'));
    });

    it('ignores unrelated settings when generating', function () {
      const s = new Secret({ script: '(1)', type: 'javascript' });
      assert.match(s.data.content, /^[0-9a-f]{64}$/);
    });

    it('seals and restores the secret', function () {
      const s = new Secret({ password: PASSWORD });
      assert.strictEqual(s.hash, null);
      const restored = new Secret({ seal: s.state.seal });
      assert.strictEqual(restored.hash, null);
      restored.decrypt(PASSWORD);
      s.decrypt(PASSWORD);
      assert.match(restored.hash, /^[0-9a-f]{64}$/);
      assert.strictEqual(restored.hash, s.hash);
    });
  });
});
