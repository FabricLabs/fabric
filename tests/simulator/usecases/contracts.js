'use strict';

const Actor = require('../../../types/actor');
const Message = require('../../../types/message');

/** Application-namespace publish + CONTRACT_MESSAGE traffic. */
module.exports = {
  name: 'contracts',
  weights: {
    'contract.publish': 2,
    'contract.message': 8,
    'peer.ping': 1
  },
  /**
   * Seed one shared contract so messages have a namespace from step 0.
   * @param {object} ctx
   */
  async setup (ctx) {
    const peer = ctx.network.peers[0];
    if (!peer) return;
    const definition = {
      name: 'SimulatorBootstrap',
      version: 1,
      state: { value: 0, origin: 'setup' }
    };
    const id = (new Actor(definition)).id;
    ctx.contractIds.push(id);
    ctx.network.contractIds.push(id);
    const msg = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]);
    msg.signWithKey(peer.key);
    ctx.network.broadcast(peer, msg.toBuffer());
    await new Promise((r) => setImmediate(r));
  }
};
