'use strict';

/** Peer gossip + peering-offer mesh advertisements. */
module.exports = {
  name: 'gossip',
  weights: {
    'gossip.peer': 6,
    'peering.offer': 4,
    'peer.ping': 1
  }
};
