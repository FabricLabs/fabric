'use strict';

/** Disconnect/reconnect and bounded adversarial wire noise. */
module.exports = {
  name: 'chaos',
  weights: {
    'peer.disconnect': 2,
    'peer.reconnect': 3,
    'chaos.raw': 1,
    'peer.ping': 2
  }
};
