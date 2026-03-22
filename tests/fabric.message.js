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
  P2P_CALL,
  P2P_MESSAGE_RECEIPT
} = require('../constants');

const Message = require('../types/message');
const Key = require('../types/key');
const Hash256 = require('../types/hash256');
const assert = require('assert');

// Create a key with a private key for signing
const key = new Key({
  private: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
});

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
      assert.strictEqual(literal.headers.hash, 'd3595887441da0b0ac8bdb05c8b85b2e4fbad11c43dbbf4ce8b6ec27d7cd0646');
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
      assert.strictEqual(literal.headers.hash, 'd3595887441da0b0ac8bdb05c8b85b2e4fbad11c43dbbf4ce8b6ec27d7cd0646');
      assert.strictEqual(message.type, 'Call');
    });

    it('round-trips P2P_MESSAGE_RECEIPT with stable type code', function () {
      const payload = {
        '@type': 'Receipt',
        '@actor': 'deadbeef',
        '@data': { ok: true },
        '@version': 1
      };
      const message = Message.fromVector(['P2P_MESSAGE_RECEIPT', payload]);
      assert.strictEqual(message.type, 'P2P_MESSAGE_RECEIPT');

      const literal = message.toObject();
      assert.strictEqual(literal.headers.type, P2P_MESSAGE_RECEIPT);

      const buffer = message.toBuffer();
      const restored = Message.fromBuffer(buffer);
      assert.strictEqual(restored.type, 'P2P_MESSAGE_RECEIPT');
      const body = JSON.parse(restored.body);
      assert.strictEqual(body['@type'], 'Receipt');
      assert.strictEqual(body['@version'], 1);
      assert.strictEqual(body['@actor'], 'deadbeef');
    });

    it('fromBuffer keeps header hash bytes from wire (body integrity field)', function () {
      const message = Message.fromVector(['Call', JSON.stringify(example.data)]);
      message.signWithKey(key);
      const buf = message.toBuffer();
      const hashOnWire = buf.subarray(80, 112).toString('hex');
      const restored = Message.fromBuffer(buf);
      const hashAfterParse = Buffer.isBuffer(restored.raw.hash)
        ? restored.raw.hash.toString('hex')
        : restored.raw.hash;
      assert.strictEqual(hashAfterParse, hashOnWire);
      assert.strictEqual(Hash256.doubleDigest(restored.raw.data), hashOnWire);
    });

    it('optional preimage is null on wire for public messages and round-trips when set', function () {
      const pub = Message.fromVector(['Call', JSON.stringify(example.data)]);
      pub.signWithKey(key);
      assert.strictEqual(pub.preimage, null);
      const lit = pub.toObject();
      assert.strictEqual(lit.headers.preimage, null);

      const secret = Buffer.alloc(32, 0xab);
      const priv = new Message({
        type: 'Call',
        data: JSON.stringify(example.data),
        preimage: secret
      });
      priv.signWithKey(key);
      assert.ok(priv.preimage);
      assert.strictEqual(priv.preimage.toString('hex'), secret.toString('hex'));
      const back = Message.fromBuffer(priv.toBuffer());
      assert.strictEqual(back.preimage.toString('hex'), secret.toString('hex'));
      assert.ok(back.verifyWithKey(key));
    });
  });

  describe('parseRawMessage()', function () {
    it('should parse a known header', async function () {
      const message = Message.fromVector(['ChatMessage', 'Hello, world!']);
      const format = {
        magic: Buffer.from('c0def33d', 'hex'),
        version: Buffer.from('00000001', 'hex'),
        parent: Buffer.alloc(32),
        author: Buffer.alloc(32),
        type: Buffer.from('00000067', 'hex'),
        size: Buffer.from('00000015', 'hex'),
        hash: Buffer.alloc(32),
        preimage: Buffer.alloc(32),
        signature: Buffer.alloc(64),
        data: Buffer.from('"Hello, world!"', 'utf8')
      };

      const known = Buffer.concat([
        format.magic,
        format.version,
        format.parent,
        format.author,
        format.type,
        format.size,
        format.hash,
        format.preimage,
        format.signature,
        format.data
      ]);

      const parsed = Message.parseRawMessage(known);

      assert.strictEqual(format.magic.toString('hex'), parsed.magic.toString('hex'));
      assert.strictEqual(format.version.toString('hex'), parsed.version.toString('hex'));
      assert.strictEqual(format.parent.toString('hex'), parsed.parent.toString('hex'));
      assert.strictEqual(format.author.toString('hex'), parsed.author.toString('hex'));
      assert.strictEqual(format.type.toString('hex'), parsed.type.toString('hex'));
      assert.strictEqual(format.size.toString('hex'), parsed.size.toString('hex'));
      assert.strictEqual(format.hash.toString('hex'), parsed.hash.toString('hex'));
      assert.strictEqual(format.preimage.toString('hex'), parsed.preimage.toString('hex'));
      assert.strictEqual(format.signature.toString('hex'), parsed.signature.toString('hex'));
      assert.strictEqual(format.data.toString('hex'), parsed.data.toString('hex'));
    });
  });

  describe('sign()', function () {
    it('can sign a message', async function prove () {
      const message = Message.fromVector(['Call', JSON.stringify(example.data)]);
      const literal = message.toObject();
      const signed = message.signWithKey(key);

      assert.ok(signed);
      assert.ok(message);
      assert.ok(literal);
      assert.ok(literal.headers);

      assert.strictEqual(literal.headers.magic, MAGIC_BYTES);
      assert.strictEqual(literal.headers.version, VERSION_NUMBER);
      assert.strictEqual(literal.headers.type, P2P_CALL);
      assert.strictEqual(literal.headers.size, 29);
      assert.strictEqual(literal.headers.hash, 'd3595887441da0b0ac8bdb05c8b85b2e4fbad11c43dbbf4ce8b6ec27d7cd0646');
      assert.strictEqual(message.type, 'Call');
    });
  });

  describe('toBuffer()', function () {
    it('round-trips signed wire bytes through fromBuffer', function () {
      const m = Message.fromVector(['GenericMessage', JSON.stringify({ type: 'probe', n: 1 })]);
      m.signWithKey(key);
      const buf = m.toBuffer();
      const restored = Message.fromBuffer(buf);
      assert.strictEqual(restored.type, m.type);
      assert.strictEqual(restored.data, m.data);
      assert.ok(restored.verifyWithKey(key));
    });

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

  describe('verifyWithKey()', function () {
    it('returns false when verifying with a different key than signer', function () {
      const m = Message.fromVector(['Call', JSON.stringify(example.data)]);
      m.signWithKey(key);
      const other = new Key();
      assert.strictEqual(m.verifyWithKey(other), false);
    });

    it('throws when key lacks verify', function () {
      const m = Message.fromVector(['Call', JSON.stringify(example.data)]);
      m.signWithKey(key);
      assert.throws(() => m.verifyWithKey({}), /Key object must implement verify method/);
    });
  });

  describe('verify()', function () {
    it('can verify authorship', async function prove () {
      const message = Message.fromVector(['Generic', JSON.stringify(example.data)]);
      const literal = message.toObject();
      const signed = message.signWithKey(key);
      signed._setSigner(key);
      const verified = signed.verify();

      assert.ok(message);
      assert.ok(literal);
      assert.ok(literal.headers);
      assert.ok(verified);

      assert.strictEqual(literal.headers.magic, MAGIC_BYTES);
      assert.strictEqual(literal.headers.version, VERSION_NUMBER);
      // assert.strictEqual(literal.headers.type, P2P_CALL);
      assert.strictEqual(literal.headers.size, 29);
      assert.strictEqual(literal.headers.hash, 'd3595887441da0b0ac8bdb05c8b85b2e4fbad11c43dbbf4ce8b6ec27d7cd0646');
      assert.strictEqual(message.type, 'Generic');
    });
  });
});
