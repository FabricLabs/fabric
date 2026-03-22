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

    it('base64Url helpers round-trip string and buffer', function () {
      const raw = '{"a":1}';
      const enc = Token.base64UrlEncode(raw);
      assert.strictEqual(Token.base64UrlDecode(enc), raw);
      const buf = Buffer.from('deadbeef', 'hex');
      const encB = Token.base64UrlEncodeBuffer(buf);
      assert.ok(encB.includes('-') || encB.length > 0);
      assert.deepStrictEqual(Token.base64UrlDecodeToBuffer(encB), buf);
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

    it('toString yields three JWT-like segments', function () {
      const issuer = new Key();
      const token = new Token({ capability: 'OP_X', issuer, subject: 'subj' });
      const s = token.toString();
      const parts = s.split('.');
      assert.strictEqual(parts.length, 3);
    });

    it('fromString parses three-segment token from toString', function () {
      const issuer = new Key();
      const token = new Token({ capability: 'OP_Y', issuer, subject: 'z' });
      const s = token.toString();
      const parsed = Token.fromString(s);
      assert.ok(parsed instanceof Token);
    });
  });
});
