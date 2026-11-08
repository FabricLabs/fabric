'use strict';

/** P2P state root / change / request frames (feed toward common-state Program). */
module.exports = {
  name: 'state',
  weights: {
    'state.root': 4,
    'state.change': 5,
    'state.request': 2,
    'peer.ping': 1
  }
};
