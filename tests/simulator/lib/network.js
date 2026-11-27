'use strict';

/**
 * NetworkHarness — spin up Fabric Peer meshes on loopback (TCP + NOISE).
 */

const Peer = require('../../../types/peer');
const { getFreePort, waitUntil } = require('../../helpers/peer');
const { Metrics } = require('./metrics');

const TRANSIENT_ERR = /Attempted to write to a closed|ECONNRESET|EPIPE|ECONNREFUSED|ERR_STREAM_DESTROYED/i;

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function listenPeerSettings (port, keySettings, overrides = {}) {
  return Object.assign(
    { verbosity: 0 },
    keySettings,
    {
      listen: true,
      port,
      interface: '127.0.0.1',
      upnp: false,
      peers: [],
      networking: false,
      peersDb: null,
      debug: false,
      reconnectToKnownPeers: false,
      constraints: { peers: { max: 64, shuffle: 16 } },
      serveLocalDocumentInventory: true,
      relayInventoryRequest: true,
      relayInventoryResponse: true
    },
    overrides
  );
}

class NetworkHarness {
  /**
   * @param {object} [opts]
   * @param {number} [opts.peerCount=3]
   * @param {'star'|'line'|'mesh'} [opts.topology='star']
   * @param {import('./metrics').Metrics} [opts.metrics]
   * @param {number} [opts.connectTimeoutMs=30000]
   */
  constructor (opts = {}) {
    this.peerCount = Math.max(2, Number(opts.peerCount) || 3);
    this.topology = opts.topology || 'star';
    this.connectTimeoutMs = opts.connectTimeoutMs || 30000;
    this.metrics = opts.metrics || new Metrics();
    /** @type {import('../../../types/peer')[]} */
    this.peers = [];
    /** @type {{ id: string, peer: import('../../../types/peer'), port: number, address: string }[]} */
    this.nodes = [];
    this.contractIds = [];
    this._started = false;
  }

  connectionCount () {
    let n = 0;
    for (const p of this.peers) {
      n += Object.keys(p.connections || {}).length;
    }
    return n;
  }

  /**
   * Pick a peer that currently has at least one Fabric edge.
   * @param {*} rng
   */
  pickConnectedPeer (rng) {
    const live = this.peers.filter((p) => Object.keys(p.connections || {}).length > 0);
    if (!live.length) return rng.pick(this.peers);
    return rng.pick(live);
  }

  /**
   * @param {import('../../../types/peer')} peer
   * @returns {string|null}
   */
  randomRemoteKey (peer, rng) {
    const keys = Object.keys(peer.connections || {});
    if (!keys.length) return null;
    return rng.pick(keys);
  }

  /**
   * Write a signed Message buffer to one edge (or broadcast if no remoteKey).
   * @param {import('../../../types/peer')} peer
   * @param {Buffer} buf
   * @param {string|null} [remoteKey]
   */
  writeFabric (peer, buf, remoteKey = null) {
    if (remoteKey && peer.connections[remoteKey] && peer.connections[remoteKey]._writeFabric) {
      peer.connections[remoteKey]._writeFabric(buf);
      return true;
    }
    const keys = Object.keys(peer.connections || {});
    if (!keys.length) return false;
    const k = keys[0];
    if (peer.connections[k] && peer.connections[k]._writeFabric) {
      peer.connections[k]._writeFabric(buf);
      return true;
    }
    return false;
  }

  /**
   * Broadcast buffer to all edges (uses Peer#broadcast).
   * @param {import('../../../types/peer')} peer
   * @param {Buffer} buf
   */
  broadcast (peer, buf) {
    if (typeof peer.broadcast === 'function') {
      peer.broadcast(buf);
      return true;
    }
    return false;
  }

  _attachPeerListeners (peer, label) {
    peer.on('chat', () => this.metrics.recordEvent('chat'));
    peer.on('contract:message', () => this.metrics.recordEvent('contract:message'));
    peer.on('contract:publish', (e) => {
      this.metrics.recordEvent('contract:publish');
      if (e && e.contract && !this.contractIds.includes(e.contract)) {
        this.contractIds.push(e.contract);
      }
    });
    peer.on('contract:proposal', () => this.metrics.recordEvent('contract:proposal'));
    peer.on('inventory', () => this.metrics.recordEvent('inventory'));
    peer.on('inventoryResponse', () => this.metrics.recordEvent('inventoryResponse'));
    peer.on('peeringGossip', () => this.metrics.recordEvent('peeringGossip'));
    peer.on('peeringOffer', () => this.metrics.recordEvent('peeringOffer'));
    peer.on('bitcoinBlock', () => this.metrics.recordEvent('bitcoinBlock'));
    // Prefer camelCase Peer events (PascalCase aliases are transitional).
    peer.on('documentPublish', () => this.metrics.recordEvent('documentPublish'));
    peer.on('documentRequest', () => this.metrics.recordEvent('documentRequest'));
    peer.on('documentRequestRelayed', () => this.metrics.recordEvent('documentRequestRelayed'));
    peer.on('file', () => this.metrics.recordEvent('file'));
    peer.on('warning', () => this.metrics.recordEvent('warning'));
    peer.on('error', (err) => {
      const msg = err && (err.message || String(err));
      if (msg && TRANSIENT_ERR.test(msg)) {
        this.metrics.recordEvent('transientError');
        return;
      }
      this.metrics.recordHardError({ peer: label, msg: String(msg) });
    });
  }

  async _allocatePorts (n) {
    const ports = [];
    for (let i = 0; i < n; i++) {
      ports.push(await getFreePort());
    }
    return ports;
  }

  /**
   * Build dial target string for peer settings / _connect.
   * @param {{ peer: import('../../../types/peer'), port: number }} node
   */
  _dialTarget (node) {
    return `${node.peer.key.pubkey}@127.0.0.1:${node.port}`;
  }

  async start () {
    if (this._started) return this;
    const ports = await this._allocatePorts(this.peerCount);
    const t0 = Date.now();

    for (let i = 0; i < this.peerCount; i++) {
      // Empty key settings → Peer generates a unique ephemeral identity.
      const peer = new Peer(listenPeerSettings(ports[i], {}));
      const label = `peer${i}`;
      this._attachPeerListeners(peer, label);
      this.peers.push(peer);
      this.nodes.push({
        id: label,
        peer,
        port: ports[i],
        address: `127.0.0.1:${ports[i]}`
      });
    }

    // Start listeners first
    for (const node of this.nodes) {
      await node.peer.start();
    }

    // Wire topology
    if (this.topology === 'star') {
      const hub = this.nodes[0];
      for (let i = 1; i < this.nodes.length; i++) {
        this.nodes[i].peer._connect(this._dialTarget(hub));
      }
      await waitUntil(
        () => Object.keys(hub.peer.connections || {}).length >= this.peerCount - 1,
        this.connectTimeoutMs
      );
    } else if (this.topology === 'line') {
      for (let i = 1; i < this.nodes.length; i++) {
        this.nodes[i].peer._connect(this._dialTarget(this.nodes[i - 1]));
      }
      await waitUntil(
        () => this.connectionCount() >= (this.peerCount - 1) * 2 ||
          this.connectionCount() >= this.peerCount - 1,
        this.connectTimeoutMs
      );
    } else {
      // mesh: dial each undirected edge once (i → j for j > i) to avoid double-handshake races
      for (let i = 0; i < this.nodes.length; i++) {
        for (let j = i + 1; j < this.nodes.length; j++) {
          this.nodes[i].peer._connect(this._dialTarget(this.nodes[j]));
        }
      }
      // NOISE sessions usually appear on both ends → expect roughly 2*(n-1) for a connected mesh;
      // require at least one edge per non-isolated peer count.
      const minConnections = Math.max(this.peerCount - 1, 2);
      await waitUntil(
        () => this.connectionCount() >= minConnections,
        this.connectTimeoutMs
      );
    }

    // Allow NOISE / SESSION_OFFER exchange to finish before traffic.
    await new Promise((r) => setTimeout(r, 75));

    this.metrics.recordConnectMs(Date.now() - t0);
    this.metrics.observeConnections(this.connectionCount());
    this._started = true;
    return this;
  }

  async stop () {
    const list = this.peers.splice(0);
    this.nodes.length = 0;
    this._started = false;
    for (const p of list) {
      try {
        if (p && typeof p.stop === 'function') await p.stop();
      } catch (err) {
        this.metrics.note(`stop error: ${err && err.message}`);
      }
    }
  }
}

module.exports = {
  NetworkHarness,
  listenPeerSettings,
  TRANSIENT_ERR
};
