'use strict';

/**
 * @fileoverview Offline smoke for directed onion nesting (P2P_FORWARD).
 *
 * Run: `npm run example:onion`
 * Network path: Peer#sendOnion / Hub SendOnion — see docs/P2P_FORWARD.md
 * Live: https://fabriclabs.github.io/fabric/examples/onion-forward.html
 */

const Key = require('../types/key');
const Message = require('../types/message');
const {
  wrapOnionPath,
  tryDecodeForward,
  xOnlyFromKey
} = require('../functions/fabricOnion');

async function main () {
  const origin = new Key();
  const relay = new Key();
  const dest = new Key();

  const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello via onion']);
  payload.signWithKey(origin);

  if (!payload.verifyWithKey(origin)) {
    throw new Error('payload signature invalid before wrap');
  }

  const outer = wrapOnionPath({
    path: [xOnlyFromKey(relay), xOnlyFromKey(dest)],
    payload,
    key: origin
  });

  let layer = tryDecodeForward(outer);
  console.log('[EXAMPLES:ONION] hop1 nextPeer', layer.nextPeer.toString('hex').slice(0, 16) + '…', 'ttl=', layer.ttl);

  layer = tryDecodeForward(Message.fromBuffer(layer.inner));
  console.log('[EXAMPLES:ONION] hop2 nextPeer', layer.nextPeer.toString('hex').slice(0, 16) + '…', 'ttl=', layer.ttl);

  const inner = Message.fromBuffer(layer.inner);
  if (!inner.verifyWithKey(origin)) {
    throw new Error('decoded payload signature invalid');
  }
  console.log('[EXAMPLES:ONION] payload', inner.type, inner.data.toString('utf8'));
  console.log('[EXAMPLES:ONION] ok — nested P2P_FORWARD layers round-trip');
}

main().catch((exception) => {
  console.error('[EXAMPLES:ONION]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
