'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Hash256 = require('../types/hash256');
const {
  encodeBody,
  decodeBody,
  getBodySchema,
  registerBodySchema,
  SCHEMA_P2P_PING,
  SCHEMA_P2P_CHAT,
  SCHEMA_PROGRAM_RUN,
  MAX_MESSAGE_SIZE
} = require('../functions/messageBodyCodec');

describe('@fabric/core/functions/messageBodyCodec', function () {
  it('round-trips P2P_PING schema', function () {
    const fields = { nonce: '1710000000000' };
    const buf = encodeBody(SCHEMA_P2P_PING, fields);
    const back = decodeBody(SCHEMA_P2P_PING, buf);
    assert.deepStrictEqual(back, fields);
  });

  it('round-trips P2P_CHAT schema', function () {
    const fields = {
      channel: 'global',
      content: 'hello',
      timestamp: '2026-07-24T00:00:00Z'
    };
    const buf = encodeBody(SCHEMA_P2P_CHAT, fields);
    const back = decodeBody(SCHEMA_P2P_CHAT, buf);
    assert.deepStrictEqual(back, fields);
  });

  it('round-trips FabricProgramRun bytes32 fields', function () {
    const programHash = crypto.randomBytes(32);
    const runCommitment = crypto.randomBytes(32);
    const fields = {
      programHash,
      runCommitment,
      resultHint: 'ok'
    };
    const buf = encodeBody(SCHEMA_PROGRAM_RUN, fields);
    const back = decodeBody(SCHEMA_PROGRAM_RUN, buf);
    assert.ok(Buffer.compare(back.programHash, programHash) === 0);
    assert.ok(Buffer.compare(back.runCommitment, runCommitment) === 0);
    assert.strictEqual(back.resultHint, 'ok');
  });

  it('body hash is stable for same fields', function () {
    const fields = { nonce: '1' };
    const a = encodeBody(SCHEMA_P2P_PING, fields);
    const b = encodeBody(SCHEMA_P2P_PING, fields);
    assert.strictEqual(Hash256.doubleDigest(a), Hash256.doubleDigest(b));
  });

  it('rejects oversized length-prefixed payloads', function () {
    const schema = [{ name: 'blob', type: 'bytes' }];
    const huge = Buffer.alloc(MAX_MESSAGE_SIZE);
    assert.throws(() => encodeBody(schema, { blob: huge }), /MAX_MESSAGE_SIZE/);
  });

  it('getBodySchema resolves Ping / P2P_PING', function () {
    assert.ok(getBodySchema('Ping'));
    assert.ok(getBodySchema('P2P_PING'));
    assert.strictEqual(getBodySchema('Ping').length, 1);
  });

  it('registerBodySchema accepts custom schemas', function () {
    registerBodySchema('TestCustomBody', [{ name: 'x', type: 'u32' }]);
    const buf = encodeBody(getBodySchema('TestCustomBody'), { x: 42 });
    assert.strictEqual(decodeBody(getBodySchema('TestCustomBody'), buf).x, 42);
  });
});
