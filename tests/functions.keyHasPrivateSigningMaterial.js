'use strict';

const assert = require('assert');
const Key = require('../types/key');
const keyHasPrivateSigningMaterial = require('../functions/keyHasPrivateSigningMaterial');

describe('keyHasPrivateSigningMaterial', function () {
  it('returns false for null / missing private', function () {
    assert.strictEqual(keyHasPrivateSigningMaterial(null), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({}), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({ private: null }), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({ private: '' }), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({ private: Buffer.alloc(0) }), false);
  });

  it('returns true for Key with private material and false for watch-only', function () {
    const full = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const watch = new Key({ public: full.pubkey });
    assert.strictEqual(keyHasPrivateSigningMaterial(full), true);
    assert.strictEqual(keyHasPrivateSigningMaterial(watch), false);
  });
});
