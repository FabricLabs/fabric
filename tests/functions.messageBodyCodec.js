'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Hash256 = require('../types/hash256');
const Message = require('../types/message');
const {
  encodeBody,
  decodeBody,
  getBodySchema,
  registerBodySchema,
  SCHEMA_P2P_PING,
  SCHEMA_P2P_CHAT,
  SCHEMA_PROGRAM_RUN,
  MAX_MESSAGE_SIZE
} = Message;

describe('@fabric/core/types/message body codec', function () {
  it('round-trips P2P_PING schema', function () {
    const fields = { nonce: '1710000000000' };
    const buf = encodeBody(SCHEMA_P2P_PING, fields);
    const back = decodeBody(SCHEMA_P2P_PING, buf);
    assert.deepStrictEqual(back, fields);
  });

  it('P2P_CHAT_MESSAGE has no multi-field body schema (opaque UTF-8)', function () {
    assert.strictEqual(SCHEMA_P2P_CHAT, null);
    assert.strictEqual(getBodySchema('P2P_CHAT_MESSAGE'), null);
    assert.strictEqual(getBodySchema(require('../constants').P2P_CHAT_MESSAGE), null);
  });

  it('round-trips FabricProgramRun schema', function () {
    const fields = {
      programHash: crypto.randomBytes(32),
      runCommitment: Buffer.from(Hash256.digest(Buffer.from('run')), 'hex'),
      resultHint: 'ok'
    };
    const buf = encodeBody(SCHEMA_PROGRAM_RUN, fields);
    const back = decodeBody(SCHEMA_PROGRAM_RUN, buf);
    assert.strictEqual(back.resultHint, 'ok');
    assert.ok(Buffer.isBuffer(back.programHash));
    assert.strictEqual(back.programHash.length, 32);
  });

  it('registerBodySchema + getBodySchema', function () {
    const name = 'TestBodyCodec_' + Date.now();
    registerBodySchema(name, [{ name: 'x', type: 'u32' }]);
    assert.ok(getBodySchema(name));
    assert.strictEqual(getBodySchema(name)[0].type, 'u32');
  });

  it('encodeBody enforces MAX_MESSAGE_SIZE', function () {
    assert.ok(Number(MAX_MESSAGE_SIZE) > 0);
    const huge = 'x'.repeat(MAX_MESSAGE_SIZE + 64);
    assert.throws(() => encodeBody([{ name: 's', type: 'string' }], { s: huge }), /MAX_MESSAGE_SIZE/);
  });
});
