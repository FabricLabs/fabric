'use strict';

/** Bitcoin tip gossip (BITCOIN_BLOCK relay-as-is). */
module.exports = {
  name: 'bitcoin',
  weights: {
    'bitcoin.block': 6,
    'peer.ping': 1
  }
};
