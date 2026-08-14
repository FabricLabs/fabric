'use strict';

const assert = require('assert');
const {
  chatTextOf,
  chatActorIdOf,
  formatChatLogLine
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
  });
});
