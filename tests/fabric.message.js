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
  P2P_MESSAGE_RECEIPT,
  P2P_GENERIC,
  P2P_START_CHAIN,
  P2P_SESSION_ACK,
  LIGHTNING_WARNING,
  LIGHTNING_INIT,
  LIGHTNING_ERROR,
  LIGHTNING_PING,
  LIGHTNING_PONG,
  LIGHTNING_OPEN_CHANNEL,
  LIGHTNING_ACCEPT_CHANNEL,
  LIGHTNING_UPDATE_ADD_HTLC
} = require('../constants');

const Message = require('../types/message');
const Key = require('../types/key');
const Hash256 = require('../types/hash256');
const assert = require('assert');
const fs = require('fs');
const {
  OUTPUT_PATH,
  CATALOG_BEGIN,
  CATALOG_END,
  collectCatalog,
  catalogBlock
} = require('../scripts/gen-message-type-consolidation');

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

    it('typeEquals / canonicalType* unify opcode, wire name, and friendly alias', function () {
      const { P2P_PEER_GOSSIP, P2P_PEERING_OFFER } = require('../constants');
      assert.strictEqual(Message.canonicalTypeName(P2P_PEER_GOSSIP), 'P2P_PEER_GOSSIP');
      assert.strictEqual(Message.canonicalTypeCode('P2P_PEER_GOSSIP'), P2P_PEER_GOSSIP);
      assert.strictEqual(Message.canonicalTypeCode('PeerGossip'), P2P_PEER_GOSSIP);
      assert.ok(Message.typeEquals(P2P_PEER_GOSSIP, 'P2P_PEER_GOSSIP'));
      assert.ok(Message.typeEquals('PeerGossip', P2P_PEER_GOSSIP));
      assert.ok(Message.typeEquals(P2P_PEERING_OFFER, 'P2P_PEERING_OFFER'));
      assert.ok(!Message.typeEquals(P2P_PEER_GOSSIP, P2P_PEERING_OFFER));
      // Unregistered Hub/WebRTC alias: exact string match only
      assert.ok(Message.typeEquals('webrtc-peer-gossip', 'webrtc-peer-gossip'));
      assert.ok(!Message.typeEquals('webrtc-peer-gossip', P2P_PEER_GOSSIP));
    });

    it('P2P_CHAT_MESSAGE is a first-class opcode (roundtrips distinct from CHAT_MESSAGE)', function () {
      const m = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello world']);
      assert.strictEqual(m.type, 'P2P_CHAT_MESSAGE');
      const restored = Message.fromBuffer(m.toBuffer());
      assert.strictEqual(restored.type, 'P2P_CHAT_MESSAGE');
      assert.strictEqual(String(restored.data || restored.raw.data.toString('utf8')), 'hello world');
      // Not collapsed into P2P_BASE_MESSAGE, and distinct from legacy CHAT_MESSAGE.
      assert.notStrictEqual(restored.type, 'P2P_BASE_MESSAGE');
      assert.notStrictEqual(restored.type, 'CHAT_MESSAGE');
    });

    it('P2P_PEER_GOSSIP and P2P_PEERING_OFFER are first-class opcodes (not P2P_BASE_MESSAGE)', function () {
      const gossip = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify({ host: '1.2.3.4', port: 9000 })]);
      assert.strictEqual(gossip.type, 'P2P_PEER_GOSSIP');
      assert.strictEqual(Message.fromBuffer(gossip.toBuffer()).type, 'P2P_PEER_GOSSIP');

      const offer = Message.fromVector(['PeeringOffer', JSON.stringify({
        host: '5.6.7.8', port: 7777, transport: 'fabric'
      })]);
      assert.strictEqual(offer.type, 'P2P_PEERING_OFFER');
      assert.strictEqual(Message.fromBuffer(offer.toBuffer()).type, 'P2P_PEERING_OFFER');
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

    it('fromRaw copies a Uint8Array view without sibling ArrayBuffer bytes', function () {
      const message = Message.fromVector(['Call', JSON.stringify(example.data)]);
      message.signWithKey(key);
      const raw = message.toBuffer();
      const pad = 24;
      const padded = Buffer.concat([Buffer.alloc(pad, 0xaa), raw, Buffer.alloc(pad, 0xbb)]);
      const view = new Uint8Array(padded.buffer, padded.byteOffset + pad, raw.length);
      const restored = Message.fromRaw(view);
      assert.ok(restored);
      assert.strictEqual(restored.type, message.type);
      assert.ok(restored.verifyWithKey(key));
      const hashOnWire = raw.subarray(80, 112).toString('hex');
      const hashAfter = Buffer.isBuffer(restored.raw.hash)
        ? restored.raw.hash.toString('hex')
        : restored.raw.hash;
      assert.strictEqual(hashAfter, hashOnWire);
      assert.ok(Buffer.from(restored.toBuffer()).equals(raw));

      const dv = new DataView(padded.buffer, padded.byteOffset + pad, raw.length);
      const fromView = Message.fromRaw(dv);
      assert.strictEqual(fromView.type, message.type);
      assert.ok(fromView.verifyWithKey(key));
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

    it('public messages leave preimage zero; sensitive stays zero; explicit HTLC preimage overrides', function () {
      const bodyJson = JSON.stringify(example.data);

      const pub = Message.fromVector(['Call', bodyJson]);
      pub.signWithKey(key);
      assert.strictEqual(pub.preimage, null);
      const lit = pub.toObject();
      assert.strictEqual(lit.headers.preimage, null);
      // Body integrity remains on hash (double-SHA256), not preimage.
      assert.strictEqual(Hash256.doubleDigest(Buffer.from(bodyJson)), lit.headers.hash);

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

      // Setting body after an explicit preimage must not invent SHA256(body).
      const hop = Message.fromVector(['Call', bodyJson]);
      hop.preimage = secret;
      hop.data = JSON.stringify({ ...example.data, n: 2 });
      assert.strictEqual(hop.preimage.toString('hex'), secret.toString('hex'));
      hop.sensitive = true;
      assert.strictEqual(hop.preimage, null);
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

    it('toFields returns null for truncated peer body bytes', function () {
      const m = Message.fromFields('P2P_PING', { nonce: '1710000000000' });
      const full = Buffer.from(m.raw.data);
      m.raw.data = full.subarray(0, Math.max(0, full.length - 1));
      m.raw.size.writeUInt32BE(m.raw.data.length);
      assert.strictEqual(m.toFields(), null);
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

describe('@fabric/core AMP opcode catalog', function () {
  it('every WIRE_TYPE_DECODE_ORDER opcode is unique', function () {
    const seen = Object.create(null);
    for (const pair of Message.WIRE_TYPE_DECODE_ORDER) {
      const code = pair[0];
      const name = pair[1];
      if (typeof code !== 'number' || !Number.isFinite(code)) continue;
      assert.strictEqual(seen[code], undefined, `duplicate opcode ${code}: ${seen[code]} and ${name}`);
      seen[code] = name;
      assert.strictEqual(Message.canonicalTypeName(code), name);
    }
  });

  it('Fabric low numbers are not Lightning AMP opcodes', function () {
    const fabric = [
      [P2P_IDENT_REQUEST, 'P2P_IDENT_REQUEST'],
      [P2P_IDENT_RESPONSE, 'P2P_IDENT_RESPONSE'],
      [P2P_PING, 'P2P_PING'],
      [P2P_PONG, 'P2P_PONG'],
      [P2P_INSTRUCTION, 'P2P_INSTRUCTION'],
      [P2P_START_CHAIN, 'P2P_START_CHAIN'],
      [P2P_GENERIC, 'P2P_GENERIC'],
      [P2P_STATE_COMMITTMENT, 'P2P_STATE_COMMITTMENT'],
      [P2P_SESSION_ACK, 'P2P_SESSION_ACK']
    ];
    for (const row of fabric) {
      assert.strictEqual(Message.canonicalTypeName(row[0]), row[1]);
      assert.ok(row[0] < 0x2000 || row[0] === P2P_SESSION_ACK);
    }
    assert.strictEqual(P2P_SESSION_ACK, 0x4200);
  });

  it('Lightning AMP types occupy 0x2000–0x2013 and round-trip by name', function () {
    const rows = [
      ['LightningInit', LIGHTNING_INIT, 'LIGHTNING_INIT'],
      ['LightningError', LIGHTNING_ERROR, 'LIGHTNING_ERROR'],
      ['OpenChannel', LIGHTNING_OPEN_CHANNEL, 'LIGHTNING_OPEN_CHANNEL'],
      ['AcceptChannel', LIGHTNING_ACCEPT_CHANNEL, 'LIGHTNING_ACCEPT_CHANNEL'],
      ['UpdateAddHTLC', LIGHTNING_UPDATE_ADD_HTLC, 'LIGHTNING_UPDATE_ADD_HTLC'],
      ['LightningWarning', LIGHTNING_WARNING, 'LIGHTNING_WARNING'],
      ['LightningPing', LIGHTNING_PING, 'LIGHTNING_PING'],
      ['LightningPong', LIGHTNING_PONG, 'LIGHTNING_PONG']
    ];
    for (const row of rows) {
      assert.ok(row[1] >= 0x2000 && row[1] <= 0x2013, row[0]);
      const msg = Message.fromVector([row[0], 'x']);
      assert.strictEqual(msg.type, row[2]);
      assert.strictEqual(Message.fromBuffer(msg.toBuffer()).type, row[2]);
      assert.strictEqual(Message.canonicalTypeName(row[1]), row[2]);
    }
  });

  it('PeerInstruction round-trips as P2P_INSTRUCTION, not OpenChannel', function () {
    const msg = Message.fromVector(['PeerInstruction', 'x']);
    assert.strictEqual(msg.type, 'P2P_INSTRUCTION');
    assert.strictEqual(Message.fromBuffer(msg.toBuffer()).type, 'P2P_INSTRUCTION');
    assert.notStrictEqual(P2P_INSTRUCTION, LIGHTNING_OPEN_CHANNEL);
    const open = Message.fromVector(['OpenChannel', 'x']);
    assert.strictEqual(open.type, 'LIGHTNING_OPEN_CHANNEL');
  });
});

describe('MESSAGES.md wire catalog', function () {
  it('matches live WIRE_TYPE_DECODE_ORDER', function () {
    const rows = collectCatalog();
    assert.strictEqual(rows.length, Message.WIRE_TYPE_DECODE_ORDER.length);
    for (let i = 0; i < rows.length; i++) {
      const pair = Message.WIRE_TYPE_DECODE_ORDER[i];
      assert.strictEqual(rows[i].opcode, pair[0], rows[i].name);
      assert.strictEqual(rows[i].name, pair[1]);
    }
    const seen = Object.create(null);
    for (const row of rows) {
      assert.strictEqual(seen[row.opcode], undefined, `duplicate opcode ${row.opcode}`);
      seen[row.opcode] = row.name;
    }
    const ping = rows.find((row) => row.name === 'P2P_PING');
    assert.ok(ping && ping.aliases.indexOf('Ping') !== -1);
    const instruction = rows.find((row) => row.name === 'P2P_INSTRUCTION');
    assert.ok(instruction && instruction.aliases.indexOf('PeerInstruction') !== -1);
    const publish = rows.find((row) => row.name === 'CONTRACT_PUBLISH');
    assert.ok(publish && publish.aliases.indexOf('P2P_CONTRACT_PUBLISH') !== -1);
    const actual = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const start = actual.indexOf(CATALOG_BEGIN);
    const stop = actual.indexOf(CATALOG_END);
    assert.ok(start >= 0 && stop > start, 'MESSAGES.md catalog markers');
    assert.strictEqual(actual.slice(start, stop + CATALOG_END.length), catalogBlock(rows));
  });
});
