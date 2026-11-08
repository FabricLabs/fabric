'use strict';

/** Session-adjacent identity / announce traffic after NOISE. */
module.exports = {
  name: 'session',
  weights: {
    'peer.alias': 3,
    'peer.announce': 2,
    'peer.ping': 4
  }
};
