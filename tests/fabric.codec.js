'use strict';

const assert = require('assert');
const playnet = require('../settings/playnet');

const Codec = require('../types/codec');
const Hash256 = require('../types/hash256');

describe('@fabric/core/types/codec', function () {
  describe('Codec', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(Codec instanceof Function, true);
    });

    it('can instantiate smoothly', async function () {
      const codec = new Codec();
      assert.ok(codec);
    });

    it('has the correct pubkey', async function () {
      const codec = new Codec(playnet);
      assert.ok(codec);
      assert.strictEqual(codec.key.pubkey, '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can encode data', async function () {
      const codec = new Codec(playnet);
      const blob = codec.encode('Hello, world!');
      assert.ok(blob);
    });

    it('can decode data', async function () {
      const encoder = new Codec(playnet);
      const decoder = new Codec(playnet);

      const blob = encoder.encode('Hello, world!');
      const data = decoder.decode(blob);

      assert.ok(data);
      assert.strictEqual(data, 'Hello, world!');
    });
  });
});
