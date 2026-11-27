'use strict';

/**
 * End-to-end protocol flow weights: session → chat → contracts → docs →
 * peering → state → bitcoin tip (light chaos).
 */
module.exports = {
  name: 'protocol',
  weights: {
    'peer.ping': 3,
    'peer.alias': 2,
    'chat.send': 8,
    'contract.publish': 2,
    'contract.message': 6,
    'contract.proposal': 1,
    'document.publish': 3,
    'document.request': 2,
    'inventory.request': 3,
    'inventory.response': 2,
    'gossip.peer': 3,
    'peering.offer': 2,
    'state.root': 2,
    'state.change': 3,
    'bitcoin.block': 2,
    'peer.reconnect': 1
  }
};
