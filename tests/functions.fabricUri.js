'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const { MAX_FRAME_BYTES } = require('../constants');
const {
  encodeFabricUri,
  decodeFabricUri,
  parseFabricUriBytes,
  isFabricUri
} = require('../functions/fabricUri');

function signedChat (text = 'hello') {
  const key = new Key();
  const message = Message.fromVector(['P2P_CHAT_MESSAGE', text]);
  message.signWithKey(key);
  return { key, message };
}

describe('@fabric/core/functions/fabricUri', function () {
  it('round-trips a signed frame as base64url by default', function () {
    const { key, message } = signedChat();
    const uri = encodeFabricUri(message);
    assert.ok(uri.startsWith('fabric:'));
    assert.ok(!/[+/=]/.test(uri.slice(7)), 'base64url without padding');
    const decoded = decodeFabricUri(uri);
    assert.strictEqual(decoded.ok, true, decoded.error);
    assert.strictEqual(decoded.type, 'P2P_CHAT_MESSAGE');
    assert.strictEqual(decoded.encoding, 'base64url');
    assert.strictEqual(decoded.author, key.pubkey.slice(2));
    assert.strictEqual(decoded.signed, true);
    assert.ok(decoded.buffer.equals(message.toBuffer()));
    assert.strictEqual(decoded.message.body, 'hello');
  });

  it('accepts hex, 0x hex, standard base64, and the legacy prefixes', function () {
    const { message } = signedChat();
    const buffer = message.toBuffer();
    const forms = [
      `fabric:${buffer.toString('hex')}`,
      `fabric:0x${buffer.toString('hex')}`,
      `fabric:${buffer.toString('base64')}`,
      `fabric:base64,${buffer.toString('base64')}`,
      `fabric:b64,${buffer.toString('base64url')}`,
      `fabric:hex,${buffer.toString('hex')}`,
      `FABRIC:${buffer.toString('base64url')}`,
      `fabric:${encodeURIComponent(buffer.toString('base64'))}`
    ];
    for (const form of forms) {
      const decoded = decodeFabricUri(form);
      assert.strictEqual(decoded.ok, true, `${form.slice(0, 20)}: ${decoded.error}`);
      assert.ok(decoded.buffer.equals(buffer));
    }
    assert.strictEqual(decodeFabricUri(encodeFabricUri(message, { encoding: 'hex' })).encoding, 'hex');
  });

  it('refuses hierarchical fabric:// URLs and other schemes', function () {
    assert.strictEqual(decodeFabricUri('fabric://login?sessionId=ab&hub=https://hub.fabric.pub').ok, false);
    assert.strictEqual(decodeFabricUri('https://example.com').ok, false);
    assert.strictEqual(decodeFabricUri('fabric:').ok, false);
    assert.strictEqual(isFabricUri('fabric://link?x=1'), false);
    assert.strictEqual(isFabricUri('fabric:abcd'), true);
  });

  it('refuses short frames, bad magic, and frames over the cap', function () {
    assert.match(decodeFabricUri(`fabric:${'00'.repeat(100)}`).error, /shorter/);
    assert.match(decodeFabricUri(`fabric:${'00'.repeat(300)}`).error, /magic/);
    const { message } = signedChat('x'.repeat(2000));
    assert.match(decodeFabricUri(encodeFabricUri(message), { maxBytes: 1024 }).error, /exceeds|too long/);
    assert.match(decodeFabricUri(encodeFabricUri(message), { maxBytes: 2100 }).error, /exceeds/);
    const tooLong = 'fabric:' + 'A'.repeat((MAX_FRAME_BYTES * 2) + 100);
    assert.match(parseFabricUriBytes(tooLong).error, /too long/);
  });

  it('refuses a tampered body, a broken size field, and a forged signature', function () {
    const { message } = signedChat('payload');
    const body = Buffer.from(message.toBuffer());
    body[body.length - 1] ^= 0x01;
    assert.match(decodeFabricUri(encodeFabricUri(body)).error, /hash/);

    const sized = Buffer.from(message.toBuffer());
    sized.writeUInt32BE(1, 76);
    assert.match(decodeFabricUri(encodeFabricUri(sized)).error, /size/);

    const forged = Buffer.from(message.toBuffer());
    forged[150] ^= 0x01;
    assert.match(decodeFabricUri(encodeFabricUri(forged)).error, /signature/);

    const otherAuthor = Buffer.from(message.toBuffer());
    Buffer.from(new Key().pubkey.slice(2), 'hex').copy(otherAuthor, 40);
    assert.strictEqual(decodeFabricUri(encodeFabricUri(otherAuthor)).ok, false);
  });

  it('refuses unsigned frames unless allowed', function () {
    const message = Message.fromVector(['P2P_CHAT_MESSAGE', 'unsigned']);
    const uri = encodeFabricUri(message);
    assert.match(decodeFabricUri(uri).error, /unsigned/);
    const decoded = decodeFabricUri(uri, { allowUnsigned: true });
    assert.strictEqual(decoded.ok, true);
    assert.strictEqual(decoded.author, null);
    assert.strictEqual(decoded.signed, false);
  });

  it('enforces allowedTypes by wire name, friendly name, or opcode', function () {
    const { message } = signedChat();
    const uri = encodeFabricUri(message);
    assert.strictEqual(decodeFabricUri(uri, { allowedTypes: ['P2P_CHAT_MESSAGE'] }).ok, true);
    assert.strictEqual(decodeFabricUri(uri, { allowedTypes: [0x68] }).ok, true);
    assert.match(decodeFabricUri(uri, { allowedTypes: ['SiteLoginResponse'] }).error, /not allowed/);
  });

  it('refuses opcodes this build does not know', function () {
    const { message } = signedChat();
    const buffer = Buffer.from(message.toBuffer());
    buffer.writeUInt32BE(0x7ffffff0, 72);
    assert.match(decodeFabricUri(encodeFabricUri(buffer), { allowUnsigned: true }).error, /unknown message type/);
  });
});
