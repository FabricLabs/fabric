'use strict';

const assert = require('assert');
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
