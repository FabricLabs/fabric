'use strict';

/**
 * Long Beacon registry campaign: many L1 seals with document exchanges and
 * connectivity perturbations between broadcasts.
 */

const crypto = require('crypto');
const sidechainState = require('../../../functions/sidechainState');

const DOC_SIZES = Object.freeze([
  64,
  256,
  1024,
  4096,
  16384,
  65536,
  262144,
  524288
]);

/** Keep peer document maps bounded across long campaigns. */
const MAX_PEER_DOCS = 48;

const CONNECTIVITY_CYCLE = Object.freeze([
  'full',
  'degraded',
  'sparse',
  'full',
  'partitioned',
  'full'
]);

function envInt (name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function beaconEpochTarget () {
  return envInt('FABRIC_SIM_BEACON_EPOCHS', 1000);
}

function fillBody (size) {
  const n = Math.max(1, Number(size) || 1);
  return Buffer.alloc(n, 0x41 + (n % 26)).toString('utf8');
}

/**
 * @param {import('./network').NetworkHarness} network
 * @param {string} mode
 * @param {{ pick: Function }} rng
 */
async function applyConnectivity (network, mode, rng) {
  const nodes = network.nodes || [];
  if (nodes.length < 2) return { mode, disconnected: 0, reconnected: 0 };
  const hub = nodes[0];
  const leaves = nodes.slice(1);
  let disconnected = 0;
  let reconnected = 0;

  const disconnectLeaf = (leaf) => {
    const keys = Object.keys(leaf.peer.connections || {});
    for (const k of keys) {
      if (typeof leaf.peer._disconnect === 'function') {
        leaf.peer._disconnect(k);
        disconnected += 1;
      } else if (leaf.peer.connections[k] && leaf.peer.connections[k].destroy) {
        leaf.peer.connections[k].destroy();
        disconnected += 1;
      }
    }
  };

  const reconnectLeaf = (leaf) => {
    const target = `${hub.peer.key.pubkey}@127.0.0.1:${hub.port}`;
    const live = Object.keys(leaf.peer.connections || {}).length;
    if (live > 0) return;
    leaf.peer._connect(target);
    reconnected += 1;
  };

  if (mode === 'full') {
    for (const leaf of leaves) reconnectLeaf(leaf);
  } else if (mode === 'degraded') {
    const victim = rng.pick(leaves);
    disconnectLeaf(victim);
    for (const leaf of leaves) {
      if (leaf !== victim) reconnectLeaf(leaf);
    }
  } else if (mode === 'sparse') {
    const half = Math.max(1, Math.floor(leaves.length / 2));
    const shuffled = leaves.slice().sort(() => rng.chance(0.5) ? -1 : 1);
    for (let i = 0; i < shuffled.length; i++) {
      if (i < half) disconnectLeaf(shuffled[i]);
      else reconnectLeaf(shuffled[i]);
    }
  } else if (mode === 'partitioned') {
    for (const leaf of leaves) disconnectLeaf(leaf);
    // Keep hub alone; one leaf may stay linked for inventory probes if peers>=3
    if (leaves.length >= 2 && rng.chance(0.5)) {
      reconnectLeaf(leaves[0]);
    }
  }

  await new Promise((r) => setTimeout(r, 40));
  return { mode, disconnected, reconnected, edges: network.connectionCount() };
}

function prunePeerDocuments (peer, keep = MAX_PEER_DOCS) {
  const content = peer && peer._state && peer._state.content;
  if (!content || !content.documents) return;
  const ids = Object.keys(content.documents);
  if (ids.length <= keep) return;
  const drop = ids.slice(0, ids.length - keep);
  for (const id of drop) {
    delete content.documents[id];
    if (content.documentRates) delete content.documentRates[id];
  }
}

/**
 * Publish / request documents of mixed sizes on currently connected peers.
 * @returns {{ published: number, requested: number, bytes: number, sizes: number[] }}
 */
async function documentExchangeBurst (ctx, rng, tag) {
  const peers = (ctx.network.peers || []).filter((p) =>
    Object.keys(p.connections || {}).length > 0
  );
  const pool = peers.length ? peers : (ctx.network.peers || []);
  const out = { published: 0, requested: 0, bytes: 0, sizes: [] };
  if (!pool.length) return out;

  const burst = 2 + rng.int(0, 5);
  for (let i = 0; i < burst; i++) {
    const peer = rng.pick(pool);
    if (!peer || typeof peer._publishDocument !== 'function') continue;
    // Prefer a mix; occasionally hit the large end of the ladder.
    const size = rng.chance(0.15) ? rng.pick(DOC_SIZES.slice(-3)) : rng.pick(DOC_SIZES.slice(0, 5));
    const id = `d/${tag}/${i}-${rng.int(0, 1e6).toString(36)}`;
    const body = fillBody(size);
    const rate = rng.chance(0.6) ? rng.int(1, 5000) : 0;
    peer._publishDocument(id, body, rate);
    prunePeerDocuments(peer);
    out.published += 1;
    out.bytes += size;
    out.sizes.push(size);

    const remote = ctx.network.randomRemoteKey(peer, rng);
    if (remote && typeof peer.requestDocument === 'function' && rng.chance(0.7)) {
      const docs = (peer._state && peer._state.content && peer._state.content.documents) || {};
      const ids = Object.keys(docs);
      const docId = ids.length ? rng.pick(ids) : id;
      const opts = rng.chance(0.4)
        ? { maxSats: rng.int(50, 8000), relayHop: rng.int(1, 3) }
        : {};
      peer.requestDocument(docId, remote, opts);
      out.requested += 1;
    }

    if (typeof peer.requestPeerInventory === 'function' && remote && rng.chance(0.5)) {
      peer.requestPeerInventory(remote, rng.chance(0.5)
        ? { offerBtc: true, maxSats: rng.int(1000, 1e7) }
        : { kind: 'documents' });
    }
  }

  await new Promise((r) => setImmediate(r));
  return out;
}

/**
 * Run epochTarget seals with exchanges + connectivity changes between them.
 *
 * @param {object} ctx
 * @param {object} harness
 * @param {object} opts
 * @param {number} opts.epochTarget
 * @param {Function} [opts.onProgress]
 */
async function runBeaconCampaign (ctx, harness, opts = {}) {
  const rng = ctx.rng;
  const epochTarget = opts.epochTarget != null ? opts.epochTarget : beaconEpochTarget();
  const exchangeEvery = opts.exchangeEvery != null ? opts.exchangeEvery : envInt('FABRIC_SIM_BEACON_EXCHANGE_EVERY', 5);
  const connectEvery = opts.connectEvery != null ? opts.connectEvery : envInt('FABRIC_SIM_BEACON_CONNECT_EVERY', 15);
  const registryEvery = opts.registryEvery != null ? opts.registryEvery : envInt('FABRIC_SIM_BEACON_REGISTRY_EVERY', 25);

  const br = ctx.state.beaconRegistry;
  const catalogItems = [];
  const epochs = [];
  const connectivityLog = [];
  const exchangeLog = [];

  const metrics = {
    sealed: 0,
    registryDocs: 0,
    registryUpdates: 0,
    documentsPublished: 0,
    documentsRequested: 0,
    bytesPublished: 0,
    connectivityChanges: 0,
    sizeHistogram: Object.create(null)
  };

  let connectivityIdx = 0;
  let currentMode = 'full';
  await applyConnectivity(ctx.network, 'full', rng);

  for (let i = 1; i <= epochTarget; i++) {
    if (i === 1 || (i % exchangeEvery) === 0) {
      const burst = await documentExchangeBurst(ctx, rng, `e${i}`);
      metrics.documentsPublished += burst.published;
      metrics.documentsRequested += burst.requested;
      metrics.bytesPublished += burst.bytes;
      for (const s of burst.sizes) {
        metrics.sizeHistogram[s] = (metrics.sizeHistogram[s] || 0) + 1;
      }
      if (burst.published) {
        exchangeLog.push({ epoch: i, ...burst, connectivity: currentMode });
      }

      // Fold a sample of new docs into the sealed registry catalog.
      const peers = ctx.network.peers || [];
      for (const peer of peers) {
        const docs = peer._state && peer._state.content && peer._state.content.documents;
        if (!docs) continue;
        const ids = Object.keys(docs);
        if (!ids.length) continue;
        const id = rng.pick(ids);
        const body = docs[id];
        const rates = peer._state.content.documentRates || {};
        catalogItems.push({
          id,
          rateSats: rates[id] != null ? rates[id] : 0,
          contentHash: crypto.createHash('sha256').update(String(body)).digest('hex'),
          sellerId: peer.key && peer.key.pubkey,
          bytes: Buffer.byteLength(String(body), 'utf8')
        });
      }
      // Cap working set; wire SIDECHAIN_STATE_PATCH catalog must stay under MAX_MESSAGE_SIZE.
      while (catalogItems.length > 64) catalogItems.shift();
    }

    if (i === 1 || (i % registryEvery) === 0 || i === epochTarget) {
      // Catalog rows include seller pubkeys + content hashes; keep wire-sized batches.
      const windowSize = 8;
      const start = Math.max(0, catalogItems.length - windowSize - (i % 5));
      const batch = catalogItems.slice(start, start + windowSize);
      const applied = await harness.applyRegistryItems(batch.length ? batch : catalogItems.slice(-6));
      metrics.registryUpdates += 1;
      metrics.registryDocs = Object.keys(
        (applied.catalog && applied.catalog.documents) || {}
      ).length;
      if (applied.bodyError) {
        // Should be rare with the window above; keep campaign going on local STATE.
        metrics.registryBodyOverflow = (metrics.registryBodyOverflow || 0) + 1;
      }
    }

    if (i > 1 && (i % connectEvery) === 0) {
      currentMode = CONNECTIVITY_CYCLE[connectivityIdx % CONNECTIVITY_CYCLE.length];
      connectivityIdx += 1;
      const snap = await applyConnectivity(ctx.network, currentMode, rng);
      metrics.connectivityChanges += 1;
      connectivityLog.push({ epoch: i, ...snap });
    }

    const payload = await harness.sealEpoch();
    if (payload && !payload.pending) {
      epochs.push(payload);
      metrics.sealed += 1;
    }

    if (typeof opts.onProgress === 'function' && (i === 1 || i === epochTarget || i % 50 === 0)) {
      opts.onProgress({
        i,
        epochTarget,
        sealed: metrics.sealed,
        height: payload && payload.height,
        connectivity: currentMode,
        docs: metrics.documentsPublished,
        bytes: metrics.bytesPublished
      });
    }

    // Yield so TCP/NOISE can settle after disconnect storms.
    if (i % 10 === 0) await new Promise((r) => setImmediate(r));
  }

  // Restore full mesh for clean shutdown / final inventory.
  await applyConnectivity(ctx.network, 'full', rng);

  const st = harness.state;
  return {
    epochs,
    metrics,
    connectivityLog,
    exchangeLog,
    expectedDigest: sidechainState.stateDigest(st),
    sidechainClock: st.clock,
    epochTarget,
    finalConnectivity: 'full'
  };
}

module.exports = {
  DOC_SIZES,
  CONNECTIVITY_CYCLE,
  beaconEpochTarget,
  envInt,
  applyConnectivity,
  documentExchangeBurst,
  runBeaconCampaign
};
