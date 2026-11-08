'use strict';

const assert = require('assert');

const fixtures = require('../fixtures');
const config = require('../settings/test');

const Key = require('../types/key');
const Token = require('../types/token');

describe('@fabric/core/types/token', function () {
  describe('Token', function () {
    it('should expose a constructor', function () {
      assert.equal(Token instanceof Function, true);
    });

    it('can instantiate', async function () {
      const token = new Token();
      assert.ok(token);
    });

    it('can follow common form', async function () {
      const token = new Token({
        capability: 'OP_IDENTITY',
        issuer: null,
        subject: 1
      });

      assert.ok(token);
    });

    it('can create a capability token', async function () {
      const issuer = new Key();
      const subject = new Key();
      const token = new Token({
        capability: 'OP_IDENTITY',
        issuer: issuer,
        subject: subject
      });

      assert.ok(token);
    });

    it('can be added to another', async function () {
      const token = new Token();
      const other = new Token();

      const combined = token.add(other);

      assert.ok(combined);
    });

    it('sign/verify round-trips Schnorr over capability hash (Key + noble)', function () {
      const issuer = new Key();
      const token = new Token({
        capability: 'OP_CUSTOM',
        issuer,
        subject: 'x'
      });
      token.sign();
      assert.ok(Buffer.isBuffer(token.signature));
      assert.strictEqual(token.verify(), true);
    });

    it('can create and verify a signed token', async function () {
      const issuer = new Key();
      const token = new Token({
        capability: 'OP_IDENTITY',
        issuer,
        subject: 'admin'
      });
      const signed = token.toSignedString();
      assert.ok(signed);
      assert.ok(signed.includes('.'));
      const payload = Token.verifySigned(signed, issuer);
      assert.ok(payload);
      assert.strictEqual(payload.cap, 'OP_IDENTITY');
      assert.strictEqual(payload.sub, 'admin');
      assert.ok(payload.iat);
      assert.ok(payload.exp > payload.iat);
      assert.strictEqual(Token.verifySigned(signed, new Key()), null);
    });

    it('explicit ctx: null suppresses settings.ctx on signed payload', function () {
      const issuer = new Key();
      const token = new Token({
        capability: 'OP_CONTRACT_READ',
        issuer,
        subject: 'sub',
        ctx: { contractId: 'aa'.repeat(32) }
      });
      const withCtx = Token.verifySigned(token.toSignedString(), issuer);
      assert.ok(withCtx.ctx);
      assert.strictEqual(withCtx.ctx.contractId, 'aa'.repeat(32));
      const without = Token.verifySigned(token.toSignedString({ ctx: null }), issuer);
      assert.ok(without);
      assert.strictEqual(without.ctx, undefined);
    });

    it('base64Url helpers round-trip string and buffer', function () {
      const raw = '{"a":1}';
      const enc = Token.base64UrlEncode(raw);
      assert.strictEqual(Token.base64UrlDecode(enc), raw);
      const buf = Buffer.from('deadbeef', 'hex');
      const encB = Token.base64UrlEncodeBuffer(buf);
      assert.ok(encB.includes('-') || encB.length > 0);
      assert.deepStrictEqual(Token.base64UrlDecodeToBuffer(encB), buf);
    });

    it('base64UrlEncode replaces every + and /', function () {
      // UTF-8 is encoded first, so the fixture must be chosen for its base64
      // output: '++++////' becomes 'KysrKy8vLy8=' and substitutes nothing.
      const raw = '௿௿';
      const enc = Token.base64UrlEncode(raw);
      assert.strictEqual(Buffer.from(raw, 'utf8').toString('base64'), '4K+/4K+/');
      assert.strictEqual(enc, '4K-_4K-_');
      assert.ok(!enc.includes('+'));
      assert.ok(!enc.includes('/'));
      assert.strictEqual(Token.base64UrlDecode(enc), raw);
    });

    it('verifySigned rejects expired, malformed, and empty tokens', function () {
      const issuer = new Key();
      const token = new Token({ capability: 'C', issuer, subject: 's' });
      const expired = token.toSignedString({ expiresInSeconds: -7200 });
      assert.strictEqual(Token.verifySigned(expired, issuer), null);
      assert.strictEqual(Token.verifySigned('', issuer), null);
      assert.strictEqual(Token.verifySigned('no-dot', issuer), null);
      assert.strictEqual(Token.verifySigned('a.b.c', issuer), null);
    });

    it('verifySigned returns null when signature segment is invalid base64url', function () {
      const issuer = new Key();
      const token = new Token({ capability: 'C', issuer, subject: 's' });
      const signed = token.toSignedString();
      const [payload] = signed.split('.');
      assert.strictEqual(Token.verifySigned(`${payload}.!!!`, issuer), null);
    });

    it('sign throws and verify returns false without Schnorr-capable issuer', function () {
      const bare = new Token({ capability: 'X', issuer: {}, subject: 'y' });
      assert.throws(() => bare.sign(), /requires issuer Key/);
      assert.strictEqual(bare.verify(), false);
    });

    it('toString is not a signed token (verifySigned rejects it)', function () {
      const issuer = new Key();
      const token = new Token({ capability: 'OP_X', issuer, subject: 'subj' });
      assert.strictEqual(Token.verifySigned(token.toString(), issuer), null);
    });

    it('fromString parses three-segment token from toString', function () {
      const issuer = new Key();
      const token = new Token({ capability: 'OP_Y', issuer, subject: 'z' });
      const s = token.toString();
      const parsed = Token.fromString(s);
      assert.ok(parsed instanceof Token);
      assert.strictEqual(parsed.capability, 'OP_Y');
      assert.strictEqual(parsed.subject, 'z');
    });

    it('fromString rejects two-segment signed tokens', function () {
      const issuer = new Key();
      const signed = new Token({ capability: 'OP_Z', issuer, subject: 'q' }).toSignedString();
      assert.throws(() => Token.fromString(signed), /three-segment/);
    });

    it('fromString rejects short and non-JSON payloads', function () {
      assert.throws(() => Token.fromString('a.b'), /three-segment/);
      assert.throws(() => Token.fromString(''), /three-segment/);
      const badJson = [
        Token.base64UrlEncode(JSON.stringify({ alg: 'none' })),
        Token.base64UrlEncode('not-json'),
        'sig'
      ].join('.');
      assert.throws(() => Token.fromString(badJson), /not JSON/);
      const arrayPayload = [
        Token.base64UrlEncode(JSON.stringify({ alg: 'none' })),
        Token.base64UrlEncode(JSON.stringify([1, 2])),
        'sig'
      ].join('.');
      assert.throws(() => Token.fromString(arrayPayload), /not JSON/);
    });

    it('base64UrlEncode maps plus/slash and strips padding', function () {
      const encBuf = Token.base64UrlEncodeBuffer(Buffer.from([0xfb, 0xff, 0xfe]));
      assert.ok(!/\+/.test(encBuf));
      assert.ok(!/\//.test(encBuf));
      assert.ok(!/=/.test(encBuf));
      assert.deepStrictEqual(Token.base64UrlDecodeToBuffer(encBuf), Buffer.from([0xfb, 0xff, 0xfe]));
      // utf8 path also strips padding (=)
      const enc = Token.base64UrlEncode('a');
      assert.ok(!/=/.test(enc));
      assert.strictEqual(Token.base64UrlDecode(enc), 'a');
    });
  });
});
