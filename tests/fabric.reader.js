'use strict';

// Dependencies
const assert = require('assert');

// Fabric Types
const Reader = require('../types/reader');
const Message = require('../types/message');

describe('@fabric/core/types/reader', function () {
  describe('Reader', function () {
    it('is a constructor', function () {
      assert.strictEqual(Reader instanceof Function, true);
    });

    it('can parse a well-formatted message', function (done) {
      const reader = new Reader();
      const message = Message.fromVector(['Generic', 'Hello, world!']);
      const raw = message.toRaw();

      reader.on('message', function (msg) {
        const message = Message.fromBuffer(msg);
        assert.strictEqual(message.body, 'Hello, world!');
        done();
      });

      reader._addData(raw);

      assert.ok(reader);
      assert.strictEqual(message.toObject().headers.hash, '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3');
    });
  });
});
