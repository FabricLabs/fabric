'use strict';

/**
 * Document market pack: multi-seller catalog + private relay settings.
 * `document-swarm` assert covers verified blob reassembly + payment-hash binding;
 * ranking / fee math also covered in `tests/functions.documentOfferBook.js (documentMarket)`.
 */
module.exports = {
  name: 'document-market',
  weights: {
    'document.publish': 3,
    'inventory.request': 4,
    'document.request': 3,
    'document.offer.lie_hash': 1,
    'document.offer.sybil_cheap': 1,
    'document.relay.inflate_fee': 1,
    'document.relay.leak_buyer': 1,
    'peer.ping': 1
  },

  async setup (ctx) {
    const peers = ctx.network.peers || [];
    const payload = Buffer.alloc(1200, 0x41).toString('utf8');
    ctx.state = ctx.state || {};
    ctx.state.documentMarket = {
      documentId: 'sim/large',
      sellerCount: 0,
      metrics: {
        sellersSeeded: 0,
        relayEnabled: 0
      }
    };

    for (let i = 0; i < Math.min(3, peers.length); i++) {
      const peer = peers[i];
      if (!peer || typeof peer._publishDocument !== 'function') continue;
      peer.settings.serveLocalDocumentInventory = true;
      peer.settings.relayPrivateDocumentRequests = true;
      peer.settings.relayInventoryRequest = true;
      peer.settings.relayInventoryResponse = true;
      peer.settings.documentRelayFeeSats = 5;
      peer.settings.autoFulfillDocumentRequests = true;
      peer._publishDocument('sim/large', payload, 100 + i * 10);
      peer._publishDocument(`sim/seed/p${i}`, `seller-${i}`, 10 + i);
      ctx.state.documentMarket.sellerCount += 1;
      ctx.state.documentMarket.metrics.sellersSeeded += 1;
      ctx.state.documentMarket.metrics.relayEnabled += 1;
    }

    // Line topology probe: buyer → middle hop rewrites a budgeted request (re-signs).
    if (peers.length >= 3 && ctx.network.topology === 'line') {
      const buyer = peers[0];
      const relay = peers[1];
      let relayed = 0;
      const onRelayed = (ev) => {
        relayed += 1;
        if (ev && Number.isFinite(Number(ev.feeSats))) {
          ctx.state.documentMarket.metrics.relayFeesPaid =
            (ctx.state.documentMarket.metrics.relayFeesPaid || 0) + Number(ev.feeSats);
        }
      };
      relay.on('documentRequestRelayed', onRelayed);
      try {
        const nextHop = Object.keys(buyer.connections || {})[0];
        if (nextHop && typeof buyer.requestDocument === 'function') {
          buyer.requestDocument('sim/missing-budget', nextHop, {
            maxSats: 100,
            relayHop: 3
          });
        }
        await new Promise((r) => setTimeout(r, 80));
      } finally {
        relay.removeListener('documentRequestRelayed', onRelayed);
      }
      ctx.state.documentMarket.metrics.relayHops = relayed;
      ctx.state.documentMarket.metrics.buyerUnlinkable = relayed > 0 ? 1 : 0;
      if (!ctx.state.documentMarket.metrics.relayFeesPaid) {
        ctx.state.documentMarket.metrics.relayFeesPaid = relayed > 0 ? 5 : 0;
      }
    }

    await new Promise((r) => setImmediate(r));
  }
};
