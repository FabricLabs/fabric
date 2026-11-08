'use strict';

const assert = require('assert');
const {
  CHAT_SURFACE,
  classifyChatSurface,
  isPublicMeshShoutbox,
  isConfidentialChatSurface,
  chatSurfaceLabel
} = require('../functions/fabricChatKind');
const { sealOnionChatText, isOnionChatSeal } = require('../functions/onionChatSeal');
const Key = require('../types/key');

describe('fabricChatKind', function () {
  it('classifies cleartext UTF-8 as public shoutbox', function () {
    assert.strictEqual(classifyChatSurface('hello citizen'), CHAT_SURFACE.SHOUTBOX);
    assert.strictEqual(isPublicMeshShoutbox('hello citizen'), true);
    assert.strictEqual(isConfidentialChatSurface('hello citizen'), false);
    assert.strictEqual(chatSurfaceLabel(CHAT_SURFACE.SHOUTBOX), 'Public mesh shoutbox');
  });

  it('classifies onion-sealed bodies as confidential', function () {
    this.timeout(10000);
    const tip = new Key();
    const body = sealOnionChatText('secret wave', tip.pubkey);
    assert.strictEqual(isOnionChatSeal(body), true);
    assert.strictEqual(classifyChatSurface(body), CHAT_SURFACE.ONION_SEAL);
    assert.strictEqual(isConfidentialChatSurface(body), true);
    assert.strictEqual(isPublicMeshShoutbox(body), false);
  });

  it('classifies GroupChat objects with and without seals', function () {
    assert.strictEqual(
      classifyChatSurface({ type: 'GroupChat', body: 'hi' }, { appType: 'GroupChat' }),
      CHAT_SURFACE.CONTRACT_CLEARTEXT
    );
    const sealed = {
      type: 'GroupChat',
      seal: {
        scheme: 'aes-256-gcm-participant-v1',
        wraps: [{ pubkey: 'aa'.repeat(32), wrap: 'bb' }]
      }
    };
    assert.strictEqual(
      classifyChatSurface(sealed, { appType: 'GroupChat' }),
      CHAT_SURFACE.GROUP_SEAL
    );
    assert.strictEqual(isConfidentialChatSurface(sealed, { appType: 'GroupChat' }), true);
  });
});
