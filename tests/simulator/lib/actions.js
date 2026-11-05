'use strict';

/**
 * Built-in simulator actions. Each originates a *new* locally signed frame
 * (never hop-re-signs received traffic).
 */

const crypto = require('crypto');
const Message = require('../../../types/message');
const Actor = require('../../../types/actor');

/**
 * @typedef {object} SimAction
 * @property {string} name
 * @property {number} weight
 * @property {(ctx: object, rng: object) => (void|Promise<void>)} run
 */

/**
 * @param {string} name
 * @param {number} weight
 * @param {Function} run
 * @returns {SimAction}
 */
function action (name, weight, run) {
  return { name, weight, run };
}

function signSend (ctx, peer, type, bodyObj, broadcast = true) {
  const body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  const msg = Message.fromVector([type, body]);
  msg.signWithKey(peer.key);
  const buf = msg.toBuffer();
  if (broadcast) {
    ctx.network.broadcast(peer, buf);
  } else {
    const remote = ctx.network.randomRemoteKey(peer, ctx.rng || { pick: (a) => a[0] });
    ctx.network.writeFabric(peer, buf, remote);
  }
  return true;
}

/** @returns {SimAction[]} */
function builtInActions () {
  return [
    action('chat.send', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const text = `sim-chat-${rng.int(0, 1e9)}-${crypto.randomBytes(4).toString('hex')}`;
      // First-class P2P_CHAT_MESSAGE body = raw UTF-8 text only.
      signSend(ctx, peer, 'P2P_CHAT_MESSAGE', text);
    }),

    action('contract.publish', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const definition = {
        name: `SimContract-${rng.int(0, 1e6)}`,
        version: 1,
        state: { value: rng.int(0, 100), tick: Date.now() }
      };
      const id = (new Actor(definition)).id;
      if (!ctx.contractIds) ctx.contractIds = [];
      if (!ctx.contractIds.includes(id)) ctx.contractIds.push(id);
      if (!ctx.network.contractIds.includes(id)) ctx.network.contractIds.push(id);
      signSend(ctx, peer, 'CONTRACT_PUBLISH', definition);
    }),

    action('contract.message', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const ids = (ctx.contractIds && ctx.contractIds.length)
        ? ctx.contractIds
        : ctx.network.contractIds;
      let contractId = ids && ids.length ? rng.pick(ids) : null;
      if (!contractId) {
        // Publish once then message
        const definition = {
          name: `SimContract-auto-${rng.int(0, 1e6)}`,
          version: 1,
          state: { value: 0 }
        };
        contractId = (new Actor(definition)).id;
        if (!ctx.contractIds) ctx.contractIds = [];
        ctx.contractIds.push(contractId);
        ctx.network.contractIds.push(contractId);
        signSend(ctx, peer, 'CONTRACT_PUBLISH', definition);
        await new Promise((r) => setImmediate(r));
      }
      const body = {
        contract: contractId,
        type: 'SimTick',
        object: { n: rng.int(0, 1000), at: Date.now() }
      };
      signSend(ctx, peer, 'CONTRACT_MESSAGE', body);
    }),

    action('gossip.peer', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const object = {
        host: `10.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
        port: rng.int(1024, 65535),
        gossipHop: rng.int(1, 4)
      };
      signSend(ctx, peer, 'P2P_PEER_GOSSIP', object);
    }),

    action('peering.offer', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const object = {
        host: `10.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
        port: rng.int(1024, 65535),
        transport: 'fabric',
        peeringHop: rng.int(1, 4)
      };
      signSend(ctx, peer, 'P2P_PEERING_OFFER', object);
    }),

    action('inventory.request', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const offerBtc = rng.chance(0.7);
      const object = offerBtc
        ? { offerBtc: true, maxSats: rng.int(1000, 1e7), created: Date.now() }
        : { kind: 'documents', created: Date.now() };
      signSend(ctx, peer, 'P2P_INVENTORY_REQUEST', object);
    }),

    action('inventory.response', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const object = {
        items: [{
          id: `doc-${rng.int(0, 1e6)}`,
          rateSats: rng.int(0, 5000),
          contentHash: crypto.randomBytes(32).toString('hex'),
          network: 'bitcoin'
        }]
      };
      signSend(ctx, peer, 'P2P_INVENTORY_RESPONSE', object);
    }),

    action('document.publish', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const docId = `sim/doc/${rng.int(0, 1e9)}`;
      const body = `simulator document ${docId} ${Date.now()}`;
      const rate = rng.chance(0.4) ? rng.int(1, 1000) : 0;
      if (typeof peer._publishDocument === 'function') {
        peer._publishDocument(docId, body, rate);
      }
    }),

    action('document.request', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const docs = (peer._state && peer._state.content && peer._state.content.documents) || {};
      const ids = Object.keys(docs);
      const documentId = ids.length ? rng.pick(ids) : `sim/doc/missing-${rng.int(0, 1e6)}`;
      const opts = {};
      if (rng.chance(0.5)) {
        opts.maxSats = rng.int(50, 5000);
        opts.relayHop = rng.int(1, 4);
      }
      const remote = ctx.network.randomRemoteKey(peer, rng);
      if (typeof peer.requestDocument === 'function' && remote) {
        peer.requestDocument(documentId, remote, opts);
        return;
      }
      const body = Object.assign({ document: documentId, id: documentId }, opts);
      if (opts.maxSats != null) body.routeId = crypto.randomBytes(4).toString('hex');
      signSend(ctx, peer, 'DOCUMENT_REQUEST', body, false);
    }),

    action('document.offer.lie_hash', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const object = {
        kind: 'documents',
        items: [{
          id: 'sim/lie',
          rateSats: 1,
          contentHash: crypto.randomBytes(32).toString('hex'),
          blobs: [{ index: 0, total: 1, blobHashHex: crypto.randomBytes(32).toString('hex'), rateSats: 1 }]
        }]
      };
      signSend(ctx, peer, 'P2P_INVENTORY_RESPONSE', object);
    }),

    action('document.deliver.wrong_blob', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const object = {
        name: 'sim/wrong',
        body: Buffer.from('not-the-real-blob').toString('base64'),
        part: { transferId: 'bad', index: 0, total: 1 }
      };
      signSend(ctx, peer, 'P2P_FILE_SEND', object);
    }),

    action('document.offer.sybil_cheap', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      signSend(ctx, peer, 'P2P_INVENTORY_RESPONSE', {
        kind: 'documents',
        items: [{ id: 'sim/sybil', rateSats: 1, contentHash: '00'.repeat(32) }]
      });
    }),

    action('document.relay.inflate_fee', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      // Attempt a rewrite that would leave zero budget — Peer should drop.
      signSend(ctx, peer, 'DOCUMENT_REQUEST', {
        document: 'sim/inflate',
        maxSats: 1,
        relayHop: 3,
        routeId: crypto.randomBytes(4).toString('hex')
      });
    }),

    action('document.relay.leak_buyer', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      // Bit-identical style budgeted request; private relay path must rewrite, not echo buyer frame.
      peer.settings.relayPrivateDocumentRequests = true;
      signSend(ctx, peer, 'DOCUMENT_REQUEST', {
        document: 'sim/leak',
        maxSats: 200,
        relayHop: 3,
        routeId: crypto.randomBytes(4).toString('hex'),
        buyerFabricId: 'SHOULD_NOT_FORWARD'
      });
    }),

    action('peer.alias', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const alias = `sim-${rng.int(0, 1e6)}`;
      if (typeof peer._announceAlias === 'function') {
        peer._announceAlias(alias, { name: ctx.network.randomRemoteKey(peer, rng) || 'local' });
      } else {
        signSend(ctx, peer, 'P2P_PEER_ALIAS', alias);
      }
    }),

    action('peer.announce', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      signSend(ctx, peer, 'P2P_PEER_ANNOUNCE', {
        type: 'P2P_PEER_ANNOUNCE',
        object: { id: peer.key.pubkey, host: '127.0.0.1', port: rng.int(1024, 65535) }
      });
    }),

    action('state.root', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const root = crypto.createHash('sha256')
        .update(Buffer.from(`sim-state-${rng.int(0, 1e9)}`))
        .digest('hex');
      signSend(ctx, peer, 'P2P_STATE_ROOT', {
        type: 'P2P_STATE_ROOT',
        object: { root, clock: rng.int(0, 1000), at: Date.now() }
      });
    }),

    action('state.change', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      signSend(ctx, peer, 'P2P_STATE_CHANGE', {
        type: 'P2P_STATE_CHANGE',
        object: {
          ops: [{ op: 'replace', path: '/sim/tick', value: Date.now() }],
          clock: rng.int(0, 1000)
        }
      });
    }),

    action('state.request', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      signSend(ctx, peer, 'P2P_STATE_REQUEST', {
        type: 'P2P_STATE_REQUEST',
        object: { path: '/sim', created: Date.now() }
      }, false);
    }),

    action('bitcoin.block', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const height = rng.int(1, 900000);
      const hash = crypto.randomBytes(32).toString('hex');
      signSend(ctx, peer, 'BITCOIN_BLOCK', {
        type: 'BITCOIN_BLOCK',
        object: { hash, height, time: Math.floor(Date.now() / 1000) }
      });
      if (!ctx.bitcoinTips) ctx.bitcoinTips = [];
      ctx.bitcoinTips.push({ hash, height });
    }),

    action('contract.proposal', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const ids = (ctx.contractIds && ctx.contractIds.length)
        ? ctx.contractIds
        : ctx.network.contractIds;
      const contractId = (ids && ids.length) ? rng.pick(ids) : `sim-proposal-${rng.int(0, 1e6)}`;
      // Minimal proposal body — Peer verifies via verifyContractProposalPayload;
      // invalid proposals are dropped with a warning (still useful fuzz traffic).
      signSend(ctx, peer, 'CONTRACT_PROPOSAL', {
        contractId,
        messages: [],
        merkleRoot: crypto.randomBytes(32).toString('hex'),
        created: Date.now()
      });
    }),

    action('peer.ping', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const object = { created: new Date().toISOString(), nonce: String(Date.now()) };
      signSend(ctx, peer, 'P2P_PING', object, false);
    }),

    action('peer.disconnect', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const remote = ctx.network.randomRemoteKey(peer, rng);
      if (!remote) return;
      if (typeof peer._disconnect === 'function') {
        peer._disconnect(remote);
      } else if (peer.connections[remote] && typeof peer.connections[remote].destroy === 'function') {
        peer.connections[remote].destroy();
      }
      ctx._lastDisconnect = { peer, remote, at: Date.now() };
    }),

    action('peer.reconnect', 0, async (ctx, rng) => {
      // Re-dial a random other node by listen address
      const from = rng.pick(ctx.network.nodes);
      const to = rng.pick(ctx.network.nodes.filter((n) => n !== from));
      if (!from || !to) return;
      const target = `${to.peer.key.pubkey}@127.0.0.1:${to.port}`;
      from.peer._connect(target);
    }),

    action('chaos.raw', 0, async (ctx, rng) => {
      const peer = ctx.network.pickConnectedPeer(rng);
      const len = rng.int(0, 64);
      const buf = crypto.randomBytes(len);
      ctx.network.writeFabric(peer, buf, ctx.network.randomRemoteKey(peer, rng));
    })
  ];
}

/**
 * Merge weight maps onto named built-ins.
 * @param {Record<string, number>} weights
 * @returns {SimAction[]}
 */
function actionsWithWeights (weights = {}) {
  const byName = Object.create(null);
  for (const a of builtInActions()) byName[a.name] = a;
  const out = [];
  for (const [name, weight] of Object.entries(weights)) {
    if (!byName[name]) continue;
    const w = Number(weight);
    if (!(w > 0)) continue;
    out.push(action(name, w, byName[name].run));
  }
  return out;
}

/**
 * Combine multiple weight maps (later keys override).
 * @param {...Record<string, number>} maps
 */
function mergeWeights (...maps) {
  return Object.assign({}, ...maps);
}

module.exports = {
  action,
  builtInActions,
  actionsWithWeights,
  mergeWeights,
  signSend
};
