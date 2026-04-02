'use strict';

const assert = require('assert');
const Message = require('../../types/message');
const {
  fuzzIterations,
  randomAmpFrame,
  randomBuffer,
  HEADER_SIZE
} = require('./helpers');

describe('fuzz: Message wire decode', function () {
  this.timeout(120000);

  it('fromRaw + common getters survive random AMP-sized buffers', function () {
    const n = fuzzIterations(500);
    for (let i = 0; i < n; i++) {
      const buf = randomAmpFrame();
      const m = Message.fromRaw(buf);
      assert.ok(m);
      void m.type;
      void m.wireType;
      void m.friendlyType;
      void m.data;
      void m.author;
      void m.toObject();
      void m.toVector();
    }
  });

  it('fromRaw survives random small/large buffers (including sub-header)', function () {
    const n = fuzzIterations(300);
    for (let i = 0; i < n; i++) {
      const buf = randomBuffer(HEADER_SIZE + 64);
      const m = Message.fromRaw(buf);
      assert.ok(m);
      void m.type;
      void m.data;
    }
  });

  it('toBuffer only throws for known bad preimage length (documented wire invariant)', function () {
    const n = fuzzIterations(200);
    for (let i = 0; i < n; i++) {
      const buf = randomAmpFrame();
      const m = Message.fromRaw(buf);
      try {
        void m.toBuffer();
      } catch (e) {
        assert.ok(e instanceof Error);
        assert.ok(
          /preimage|Message raw/.test(e.message),
          `unexpected throw: ${e.message}`
        );
      }
    }
  });
});
