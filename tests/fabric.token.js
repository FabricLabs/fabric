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
  });
});
