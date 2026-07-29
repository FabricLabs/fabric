'use strict';

/** Document catalog + inventory request/response (first-class inventory opcodes). */
module.exports = {
  name: 'inventory',
  weights: {
    'document.publish': 4,
    'document.request': 2,
    'inventory.request': 5,
    'inventory.response': 3,
    'peer.ping': 1
  },
  /**
   * Seed a couple of local documents on the hub/first peer.
   * @param {object} ctx
   */
  async setup (ctx) {
    const peer = ctx.network.peers[0];
    if (!peer || typeof peer._publishDocument !== 'function') return;
    peer._publishDocument('sim/seed/readme', 'simulator seed document', 0);
    peer._publishDocument('sim/seed/priced', 'priced catalog item', 42);
    await new Promise((r) => setImmediate(r));
  }
};
