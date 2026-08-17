'use strict';

const assert = require('assert');
const {
  chatTextOf,
  chatActorIdOf,
  formatChatLogLine,
  sanitizeChatDisplayField
} = require('../functions/fabricChatText');

describe('fabricChatText', function () {
  it('reads Peer { text } first, then Hub object.content / application body', function () {
    assert.strictEqual(chatTextOf({ text: 'mesh' }), 'mesh');
    assert.strictEqual(chatTextOf({ object: { content: 'hub' } }), 'hub');
    assert.strictEqual(chatTextOf({ object: { body: 'app' } }), 'app');
    assert.strictEqual(chatTextOf('plain'), 'plain');
    assert.strictEqual(chatTextOf({ text: '  ' }), '');
  });

  it('prefers AMP signer over actor.id and x-only-normalizes compressed keys', function () {
    const compressed = '02' + 'aa'.repeat(32);
    const xonly = 'aa'.repeat(32);
    assert.strictEqual(
      chatActorIdOf({ actor: { id: 'other' } }, { signer: compressed }),
      xonly
    );
    assert.strictEqual(chatActorIdOf({ actor: { id: xonly } }), xonly);
  });

  it('formats TUI/Hub-style log lines with alias or truncated id', function () {
    assert.strictEqual(formatChatLogLine('aa'.repeat(32), 'neorion', 'hi'), '[neorion]: hi');
    assert.strictEqual(
      formatChatLogLine('abcdefghij', null, 'yo'),
      '[@abcdefghij]: yo'
    );
    assert.strictEqual(
      formatChatLogLine('abcdefghijklmnop', null, 'z', (id) => id.slice(0, 4)),
      '[@abcd]: z'
    );
    assert.strictEqual(formatChatLogLine(null, '  ', 'plain'), '[@]: plain');
  });

  it('strips Blessed tags and control characters from alias/text', function () {
    assert.strictEqual(sanitizeChatDisplayField('hi{bold}x{/bold}'), 'hiboldx/bold');
    assert.strictEqual(
      formatChatLogLine('aa'.repeat(32), '{red-fg}evil{/red-fg}', 'ok\u0007{tag}'),
      '[red-fgevil/red-fg]: oktag'
    );
  });
});

const {
  CHAT_SURFACE,
  classifyChatSurface,
  isPublicMeshShoutbox,
  isConfidentialChatSurface,
  chatSurfaceLabel
} = require('../functions/fabricChatKind');
const { sealOnionChatText } = require('../functions/onionChatSeal');
const Key = require('../types/key');

describe('fabricChatKind', function () {
  it('classifies cleartext UTF-8 as public shoutbox', function () {
    assert.strictEqual(classifyChatSurface('hello mesh'), CHAT_SURFACE.SHOUTBOX);
    assert.ok(isPublicMeshShoutbox('hello mesh'));
    assert.ok(!isConfidentialChatSurface('hello mesh'));
    assert.match(chatSurfaceLabel(CHAT_SURFACE.SHOUTBOX), /Public/i);
  });

  it('classifies a missing body as unknown, not shoutbox', function () {
    assert.strictEqual(classifyChatSurface(null), CHAT_SURFACE.UNKNOWN);
    assert.strictEqual(classifyChatSurface(undefined), CHAT_SURFACE.UNKNOWN);
    assert.ok(!isPublicMeshShoutbox(null));
    assert.ok(!isPublicMeshShoutbox(undefined));
  });

  it('classifies onion-sealed bodies as confidential', function () {
    const tip = new Key();
    const sealed = sealOnionChatText('secret', tip.pubkey);
    assert.strictEqual(classifyChatSurface(sealed), CHAT_SURFACE.ONION_SEAL);
    assert.ok(isConfidentialChatSurface(sealed));
    assert.ok(!isPublicMeshShoutbox(sealed));
  });

  it('classifies GroupChat objects with and without seals', function () {
    assert.strictEqual(
      classifyChatSurface({ body: 'hi' }, { appType: 'GroupChat' }),
      CHAT_SURFACE.CONTRACT_CLEARTEXT
    );
    assert.strictEqual(
      classifyChatSurface({
        type: 'GroupChat',
        seal: {
          scheme: 'aes-256-gcm-participant-v1',
          ephemeralPub: 'aa',
          wraps: [],
          nonce: 'bb',
          ciphertext: 'cc'
        },
        body: ''
      }),
      CHAT_SURFACE.GROUP_SEAL
    );
  });
});
