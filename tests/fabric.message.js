'use strict';

const {
  MAGIC_BYTES,
  VERSION_NUMBER,
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  OP_CYCLE,
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_ROOT,
  P2P_PING,
  P2P_PONG,
  P2P_INSTRUCTION,
  P2P_BASE_MESSAGE,
  P2P_STATE_ROOT,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_TRANSACTION,
  P2P_CALL
} = require('../constants');

const Fabric = require('../');
const assert = require('assert');

const example = {
  type: 'Call',
  data: {
    method: 'test',
    params: []
  }
};

describe('@fabric/core/types/message', function () {
  describe('Message', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Message instanceof Function, true);
    });

    it('can compose using fromVector()', async function prove () {
      const message = Fabric.Message.fromVector(['Call', JSON.stringify(example.data)]);
      const literal = message.toObject();

      assert.ok(message);
      assert.ok(literal);
      assert.ok(literal.headers);

      assert.equal(literal.headers.magic, MAGIC_BYTES);
      assert.equal(literal.headers.version, VERSION_NUMBER);
      assert.equal(literal.headers.type, P2P_CALL);
      assert.equal(literal.headers.size, 29);
      assert.equal(literal.headers.hash, '29ef07455d1e3ab5f0b5ad485d4bb85a00a4dd4003dabd43cab0f43199fc316e');
      assert.equal(message.type, 'Call');
    });

    it('can compose from an object literal', async function prove () {
      const message = new Fabric.Message(example);
      const literal = message.toObject();

      assert.ok(message);
      assert.ok(literal);
      assert.ok(literal.headers);

      assert.equal(literal.headers.magic, MAGIC_BYTES);
      assert.equal(literal.headers.version, VERSION_NUMBER);
      assert.equal(literal.headers.type, P2P_CALL);
      assert.equal(literal.headers.size, 29);
      assert.equal(literal.headers.hash, '29ef07455d1e3ab5f0b5ad485d4bb85a00a4dd4003dabd43cab0f43199fc316e');
      assert.equal(message.type, 'Call');
    });
  });
});
