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
      assert.strictEqual(message.type, 'P2P_CALL');
    });

    it('exposes wireType, friendlyType, and JSON-oriented toObject().type', function () {
      const m = Message.fromVector(['Call', JSON.stringify(example.data)]);
      assert.strictEqual(m.wireType, 'P2P_CALL');
      assert.strictEqual(m.type, 'P2P_CALL');
      assert.strictEqual(m.friendlyType, 'Call');
      const o = m.toObject();
      assert.strictEqual(o.type, 'Call');
      assert.strictEqual(o.wireType, 'P2P_CALL');
    });

    it('static helpers convert friendly ↔ wire', function () {
      assert.strictEqual(Message.wireTypeFromFriendly('ChatMessage'), 'CHAT_MESSAGE');
      assert.strictEqual(Message.friendlyTypeFromWire('CHAT_MESSAGE'), 'ChatMessage');
    });

    it('P2P_CHAT_MESSAGE is a first-class opcode (roundtrips distinct from CHAT_MESSAGE)', function () {
      const m = Message.fromVector(['P2P_CHAT_MESSAGE', JSON.stringify({ hello: 'world' })]);
      assert.strictEqual(m.type, 'P2P_CHAT_MESSAGE');
      const restored = Message.fromBuffer(m.toBuffer());
      assert.strictEqual(restored.type, 'P2P_CHAT_MESSAGE');
      // Not collapsed into P2P_BASE_MESSAGE, and distinct from legacy CHAT_MESSAGE.
      assert.notStrictEqual(restored.type, 'P2P_BASE_MESSAGE');
      assert.notStrictEqual(restored.type, 'CHAT_MESSAGE');
    });

    it('GenericMessage encodes as GENERIC_MESSAGE (15103), not P2P_BASE_MESSAGE', function () {
      const body = JSON.stringify({ type: 'Tombstone', object: { documentId: 'd1' } });
      const m = Message.fromVector(['GenericMessage', body]);
      assert.strictEqual(m.type, 'GENERIC_MESSAGE');
      assert.strictEqual(m.friendlyType, 'GenericMessage');
      const restored = Message.fromBuffer(m.toBuffer());
      assert.strictEqual(restored.type, 'GENERIC_MESSAGE');
      assert.notStrictEqual(restored.type, 'P2P_BASE_MESSAGE');
      const code = parseInt(restored.raw.type.toString('hex'), 16);
      assert.strictEqual(code, require('../constants').GENERIC_MESSAGE_TYPE);
    });

    it('P2P_CONTRACT_* names encode to canonical contract opcodes', function () {
      const cases = [
        ['P2P_CONTRACT_PUBLISH', 'CONTRACT_PUBLISH'],
        ['P2P_CONTRACT_MESSAGE', 'CONTRACT_MESSAGE'],
        ['P2P_CONTRACT_PROPOSAL', 'CONTRACT_PROPOSAL']
      ];
      for (const [alias, canonical] of cases) {
        const m = Message.fromVector([alias, JSON.stringify({ contract: 'x' })]);
        assert.strictEqual(m.type, canonical, `${alias} should encode as ${canonical}`);
        const restored = Message.fromBuffer(m.toBuffer());
        assert.strictEqual(restored.type, canonical);
        assert.notStrictEqual(restored.type, 'P2P_BASE_MESSAGE');
      }
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
      assert.strictEqual(message.type, 'P2P_CALL');
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

    it('public messages carry SHA256(body) in preimage; sensitive blanks preimage; explicit preimage overrides', function () {
      const bodyJson = JSON.stringify(example.data);
      const expectedCommit = Hash256.digest(Buffer.from(bodyJson));

      const pub = Message.fromVector(['Call', bodyJson]);
      pub.signWithKey(key);
      assert.ok(pub.preimage);
      assert.strictEqual(pub.preimage.toString('hex'), expectedCommit);
      const lit = pub.toObject();
      assert.strictEqual(lit.headers.preimage, expectedCommit);

      const sens = new Message({
        type: 'Call',
        data: bodyJson,
        sensitive: true
      });
      sens.signWithKey(key);
      assert.strictEqual(sens.preimage, null);

      const secret = Buffer.alloc(32, 0xab);
      const priv = new Message({
        type: 'Call',
        data: bodyJson,
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
      assert.strictEqual(message.type, 'P2P_CALL');
    });
  });

  describe('toBuffer()', function () {
    it('round-trips signed wire bytes through fromBuffer', function () {
      const m = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({ type: 'probe', n: 1 })]);
      m.signWithKey(key);
      const buf = m.toBuffer();
      const restored = Message.fromBuffer(buf);
      assert.strictEqual(restored.type, m.type);
      assert.strictEqual(restored.data, m.data);
      assert.ok(restored.verifyWithKey(key));
    });

    it('should generate a restorable buffer', async function prove () {
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

      assert.strictEqual(restored.data, data);
      assert.ok(message);
      assert.strictEqual(restored.id, message.id);
    });

    it('fromFields / toFields round-trips P2P_PING field body', function () {
      const m = Message.fromFields('P2P_PING', { nonce: '42' });
      assert.strictEqual(m.type, 'P2P_PING');
      assert.ok(Buffer.isBuffer(m.bodyBuffer));
      assert.deepStrictEqual(m.toFields(), { nonce: '42' });
      const restored = Message.fromBuffer(m.toBuffer());
      assert.deepStrictEqual(restored.toFields(), { nonce: '42' });
    });

    it('fromFields throws when no schema is registered', function () {
      assert.throws(() => Message.fromFields('GENERIC_MESSAGE', { x: 1 }), /no body schema/);
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
      assert.strictEqual(message.type, 'P2P_GENERIC');
    });
  });
});
