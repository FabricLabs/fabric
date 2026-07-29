'use strict';

/** Global shoutbox traffic (first-class P2P_CHAT_MESSAGE). */
module.exports = {
  name: 'chat',
  weights: {
    'chat.send': 10,
    'peer.ping': 2
  }
};
