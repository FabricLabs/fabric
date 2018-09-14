'use strict';

const assert = require('assert');
const expect = require('chai').expect;
const crypto = require('crypto');

const Message = require('../lib/message');
const sample = require('../data/message');

const MESSAGE_VERSION = 0x01;

describe('Message', function () {
  it('should expose a constructor', function () {
    assert.equal(Message instanceof Function, true);
  });

  it('should be able to compose an empty message', function () {
    let magic = Buffer.alloc(4);
    let message = new Message();

    magic.writeUInt32BE(0xC0D3F33D);

    assert.equal(message.magic.toString('ascii'), magic.toString('ascii'));
    assert.equal(message.version, MESSAGE_VERSION);
  });

  it('should match a sample message', function () {
    let script = sample['@data'];
    let payload = Buffer.from(script);
    let hash = crypto.createHash('sha256').update(script).digest('hex');

    let magic = Buffer.alloc(4);
    let version = Buffer.alloc(4);
    let type = Buffer.alloc(4);
    let length = Buffer.alloc(4);
    let checksum = Buffer.alloc(32);

    magic.writeUInt32BE(0xC0D3F33D);
    version.writeUInt32BE(0x01);
    type.writeUInt32BE(0x00000020);
    length.writeUInt32BE(payload.byteLength);

    checksum.write(hash, 'hex');

    let header = Buffer.concat([
      magic,
      version,
      type,
      length,
      checksum
    ]);

    let raw = Buffer.concat([ header, payload ]);
    let message = Message.fromRaw(raw);

    assert.equal(message.magic.toString('ascii'), magic.toString('ascii'));
    assert.equal(message.version, MESSAGE_VERSION);
    assert.equal(message.size, script.length);
    assert.equal(message.data, script);
    assert.equal(message.asRaw().toString('hex'), raw.toString('hex'));
  });
});
