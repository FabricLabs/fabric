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

const Message = require('../types/message');
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
      assert.strictEqual(Message instanceof Function, true);
    });

    it('can compose from a vector', async function prove () {
      const message = Message.fromVector(['Call', JSON.stringify(example.data)]);
      const literal = message.toObject();

      assert.ok(message);
      assert.ok(literal);
      assert.ok(literal.headers);

      assert.strictEqual(literal.headers.magic, MAGIC_BYTES);
      assert.strictEqual(literal.headers.version, VERSION_NUMBER);
      assert.strictEqual(literal.headers.type, P2P_CALL);
      assert.strictEqual(literal.headers.size, 29);
      assert.strictEqual(literal.headers.hash, '29ef07455d1e3ab5f0b5ad485d4bb85a00a4dd4003dabd43cab0f43199fc316e');
      assert.strictEqual(message.type, 'Call');
    });

    it('can compose from an object literal', async function prove () {
      const message = new Message(example);
      const literal = message.toObject();

      assert.ok(message);
      assert.ok(literal);
      assert.ok(literal.headers);

      assert.strictEqual(literal.headers.magic, MAGIC_BYTES);
      assert.strictEqual(literal.headers.version, VERSION_NUMBER);
      assert.strictEqual(literal.headers.type, P2P_CALL);
      assert.strictEqual(literal.headers.size, 29);
      assert.strictEqual(literal.headers.hash, '29ef07455d1e3ab5f0b5ad485d4bb85a00a4dd4003dabd43cab0f43199fc316e');
      assert.strictEqual(message.type, 'Call');
    });
  });

  describe('parseRawMessage()', function () {
    it('should parse a known header', async function () {
      const message = Message.fromVector(['ChatMessage', 'Hello, world!']);
      const format = {
        magic: Buffer.from('c0def33d', 'hex'),
        version: Buffer.from('00000001', 'hex'),
        parent: Buffer.alloc(32),
        type: Buffer.from('00000067', 'hex'),
        size: Buffer.from('00000015', 'hex'),
        hash: Buffer.alloc(32),
        signature: Buffer.alloc(64),
        data: Buffer.from('"Hello, world!"', 'utf8')
      };

      const known = Buffer.concat([
        format.magic,
        format.version,
        format.parent,
        format.type,
        format.size,
        format.hash,
        format.signature,
        format.data
      ]);

      const parsed = Message.parseRawMessage(known);

      assert.strictEqual(format.magic.toString('hex'), parsed.magic.toString('hex'));
      assert.strictEqual(format.version.toString('hex'), parsed.version.toString('hex'));
      assert.strictEqual(format.parent.toString('hex'), parsed.parent.toString('hex'));
      assert.strictEqual(format.type.toString('hex'), parsed.type.toString('hex'));
      assert.strictEqual(format.size.toString('hex'), parsed.size.toString('hex'));
      assert.strictEqual(format.hash.toString('hex'), parsed.hash.toString('hex'));
      assert.strictEqual(format.signature.toString('hex'), parsed.signature.toString('hex'));
      assert.strictEqual(format.data.toString('hex'), parsed.data.toString('hex'));
    });
  });

  describe('toBuffer()', function () {
    xit('should generate a restorable buffer', async function prove () {
      const data = JSON.stringify({
        actor: 'deadbeefbabe',
        object: {
          content: 'Hello, world!'
        },
        target: '/messages'
      });

      const message = Message.fromVector(['ChatMessage', data]);
      const buffer = message.toBuffer();
      const restored = Message.fromBuffer(buffer);

      assert.strictEqual(restored.data, '{"content":"Hello, world!"},"target":"/messages"}');
      assert.ok(message);
      assert.strictEqual(message.id, '9df866854b4e8bf23c7e9e3db0121e35ecb75ff001489c8a839545c98c67f722');
    });
  });
});
