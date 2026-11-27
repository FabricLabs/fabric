'use strict';

/**
 * Offline smoke for directed onion nesting (P2P_FORWARD).
 * Run: node examples/onion-forward.js
 *
 * Network path: Peer#sendOnion / Hub SendOnion — see docs/P2P_FORWARD.md
 */

const Key = require('../types/key');
const Message = require('../types/message');
const {
  wrapOnionPath,
  tryDecodeForward,
  xOnlyFromKey
} = require('../functions/fabricOnion');

const origin = new Key();
const relay = new Key();
const dest = new Key();

const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello via onion']);
payload.signWithKey(origin);

const outer = wrapOnionPath({
  path: [xOnlyFromKey(relay), xOnlyFromKey(dest)],
  payload,
  key: origin
});

let layer = tryDecodeForward(outer);
console.log('hop1 nextPeer', layer.nextPeer.toString('hex').slice(0, 16) + '…', 'ttl=', layer.ttl);
layer = tryDecodeForward(Message.fromBuffer(layer.inner));
console.log('hop2 nextPeer', layer.nextPeer.toString('hex').slice(0, 16) + '…', 'ttl=', layer.ttl);
const inner = Message.fromBuffer(layer.inner);
console.log('payload', inner.type, inner.data.toString('utf8'));
console.log('ok — nested P2P_FORWARD layers round-trip');
