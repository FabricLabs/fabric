'use strict';

const assert = require('assert');
const taggedHash = require('../functions/taggedHash');

describe('functions/taggedHash', function () {
  it('computes BIP-340 tagged hash', function () {
    const tag = 'Fabric/Message';
    const data = Buffer.from('hello');
    const h = taggedHash(tag, data);
    const crypto = require('crypto');
    const tagHash = crypto.createHash('sha256').update(tag, 'utf8').digest();
    const expected = crypto.createHash('sha256')
      .update(Buffer.concat([tagHash, tagHash, data]))
      .digest();
    assert.ok(Buffer.isBuffer(h));
    assert.strictEqual(h.length, 32);
    assert.ok(h.equals(expected));
  });

  it('accepts Buffer tag', function () {
    const tag = Buffer.from('tag', 'utf8');
    const data = Buffer.alloc(1);
    const h = taggedHash(tag, data);
    assert.strictEqual(h.length, 32);
  });

  it('throws without tag or data', function () {
    assert.throws(() => taggedHash('', Buffer.alloc(0)), /Tag is required/);
    assert.throws(() => taggedHash('x', null), /Data is required/);
    assert.throws(() => taggedHash(1, Buffer.alloc(0)), /Tag must be a string or Buffer/);
    assert.throws(() => taggedHash('x', 'not-buffer'), /Data must be a Buffer/);
  });
});
