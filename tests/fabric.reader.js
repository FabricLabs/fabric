'use strict';

// Dependencies
const assert = require('assert');
const EventEmitter = require('events').EventEmitter;

// Fabric Types
const Reader = require('../types/reader');
const Message = require('../types/message');

describe('@fabric/core/types/reader', function () {
  describe('Reader', function () {
    it('is a constructor', function () {
      assert.equal(Reader instanceof Function, true);
    });

    it('can parse a well-formatted message', function (done) {
      let reader = new Reader();
      let source = new EventEmitter();
      let message = Message.fromVector(['Generic', 'Hello, world!']);

      reader.on('message', function (msg) {
        const message = Message.fromBuffer(msg);
        assert.equal(message.body, 'Hello, world!');
        done();
      });

      reader._addData(message.toRaw());

      assert.ok(reader);
      assert.equal(message.toObject().headers.hash, '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3');
    });
  });
});
