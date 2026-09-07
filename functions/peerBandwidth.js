'use strict';

const {
  BITCOIN_L1_BLOCK_BYTES,
  BITCOIN_L1_BLOCK_INTERVAL_MS,
  MAX_PEERS
} = require('../constants');

/**
 * Fair-share byte budget for one Fabric peer in the L1 window.
 * Default: 1 MiB / 10 min / {@link MAX_PEERS} (32) = 32768 bytes per peer.
 * @param {number} [windowBytes] node-wide window (default Bitcoin L1 1 MiB)
 * @param {number} [maxPeers] slot count (default {@link MAX_PEERS})
 * @returns {number}
 */
function perPeerBandwidthBudgetBytes (windowBytes, maxPeers) {
  const total = Number(windowBytes);
  const n = Number(maxPeers);
  const bytes = Number.isFinite(total) && total > 0 ? total : BITCOIN_L1_BLOCK_BYTES;
  const peers = Number.isFinite(n) && n > 0 ? Math.floor(n) : MAX_PEERS;
  return Math.floor(bytes / peers);
}

/**
 * Coerce a write/read payload to a non-negative integer byte length.
 * @param {*} msg
 * @returns {number}
 */
function peerBandwidthByteLength (msg) {
  if (msg == null) return 0;
  if (typeof msg === 'number') {
    if (!Number.isFinite(msg) || msg < 0) return 0;
    return Math.floor(msg);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(msg)) return msg.length;
  if (msg instanceof Uint8Array) return msg.byteLength;
  if (typeof msg === 'string') {
    return (typeof Buffer !== 'undefined' && Buffer.byteLength) ? Buffer.byteLength(msg) : msg.length;
  }
  if (typeof msg.length === 'number' && Number.isFinite(msg.length) && msg.length >= 0) {
    return Math.floor(msg.length);
  }
  return 0;
}

/**
 * @param {Object} [slot]
 * @param {number} now
 * @param {number} windowMs
 * @returns {Object}
 */
function rollPeerBandwidthWindow (slot, now, windowMs) {
  const t = Number.isFinite(now) ? now : Date.now();
  const w = Number(windowMs) > 0 ? Number(windowMs) : BITCOIN_L1_BLOCK_INTERVAL_MS;
  if (!slot || typeof slot !== 'object') {
    return {
      bytesIn: 0,
      bytesOut: 0,
      windowBytesIn: 0,
      windowBytesOut: 0,
      windowStart: t,
      windowMs: w
    };
  }
  if ((t - Number(slot.windowStart || 0)) >= w) {
    return {
      bytesIn: Number(slot.bytesIn) || 0,
      bytesOut: Number(slot.bytesOut) || 0,
      windowBytesIn: 0,
      windowBytesOut: 0,
      windowStart: t,
      windowMs: w
    };
  }
  return {
    bytesIn: Number(slot.bytesIn) || 0,
    bytesOut: Number(slot.bytesOut) || 0,
    windowBytesIn: Number(slot.windowBytesIn) || 0,
    windowBytesOut: Number(slot.windowBytesOut) || 0,
    windowStart: Number(slot.windowStart) || t,
    windowMs: w
  };
}

/**
 * Add inbound or outbound bytes onto a rolling L1 window slot.
 * @param {Object} [slot]
 * @param {string} direction `in` or `out`
 * @param {*} n payload or byte count
 * @param {number} [now]
 * @param {number} [windowMs]
 * @returns {Object}
 */
function recordPeerBandwidth (slot, direction, n, now, windowMs) {
  const next = rollPeerBandwidthWindow(slot, now, windowMs);
  const add = peerBandwidthByteLength(n);
  if (direction === 'out') {
    next.bytesOut += add;
    next.windowBytesOut += add;
  } else {
    next.bytesIn += add;
    next.windowBytesIn += add;
  }
  return next;
}

/**
 * Operator-facing snapshot for {@link Peer#knownPeers} / Hub columns.
 * @param {Object} [slot]
 * @param {number} [now]
 * @param {Object} [opts]
 * @param {number} [opts.windowMs]
 * @param {number} [opts.windowBytes]
 * @param {number} [opts.maxPeers]
 * @param {number} [opts.budgetBytes]
 * @returns {Object}
 */
function peerBandwidthSnapshot (slot, now, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : BITCOIN_L1_BLOCK_INTERVAL_MS;
  const budget = Number.isFinite(Number(options.budgetBytes)) && Number(options.budgetBytes) > 0
    ? Math.floor(Number(options.budgetBytes))
    : perPeerBandwidthBudgetBytes(options.windowBytes, options.maxPeers);
  const rolled = rollPeerBandwidthWindow(slot, now, windowMs);
  const windowBytes = rolled.windowBytesIn + rolled.windowBytesOut;
  return {
    bytesIn: rolled.bytesIn,
    bytesOut: rolled.bytesOut,
    windowBytesIn: rolled.windowBytesIn,
    windowBytesOut: rolled.windowBytesOut,
    windowBytes,
    windowMs: rolled.windowMs,
    windowStart: rolled.windowStart,
    budgetBytes: budget,
    budgetShare: budget > 0 ? windowBytes / budget : 0,
    overBudget: budget > 0 && windowBytes > budget
  };
}

/**
 * Sum snapshots for a node-wide GetNetworkStatus strip.
 * @param {Object[]} snapshots
 * @param {Object} [meta]
 * @param {number} [meta.windowMs]
 * @param {number} [meta.windowBytes]
 * @param {number} [meta.maxPeers]
 * @param {number} [meta.peerBudgetBytes]
 * @returns {Object}
 */
function aggregatePeerBandwidth (snapshots, meta) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const m = meta && typeof meta === 'object' ? meta : {};
  let bytesIn = 0;
  let bytesOut = 0;
  let windowBytesIn = 0;
  let windowBytesOut = 0;
  let overBudgetPeers = 0;
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    bytesIn += Number(s.bytesIn) || 0;
    bytesOut += Number(s.bytesOut) || 0;
    windowBytesIn += Number(s.windowBytesIn) || 0;
    windowBytesOut += Number(s.windowBytesOut) || 0;
    if (s.overBudget) overBudgetPeers += 1;
  }
  const windowBytes = windowBytesIn + windowBytesOut;
  const windowMs = Number(m.windowMs) > 0 ? Number(m.windowMs) : BITCOIN_L1_BLOCK_INTERVAL_MS;
  const nodeWindowBytes = Number(m.windowBytes) > 0 ? Number(m.windowBytes) : BITCOIN_L1_BLOCK_BYTES;
  const maxPeers = Number(m.maxPeers) > 0 ? Math.floor(Number(m.maxPeers)) : MAX_PEERS;
  const peerBudgetBytes = Number(m.peerBudgetBytes) > 0
    ? Math.floor(Number(m.peerBudgetBytes))
    : perPeerBandwidthBudgetBytes(nodeWindowBytes, maxPeers);
  return {
    bytesIn,
    bytesOut,
    windowBytesIn,
    windowBytesOut,
    windowBytes,
    windowMs,
    windowBudgetBytes: nodeWindowBytes,
    maxPeers,
    peerBudgetBytes,
    overBudgetPeers,
    overBudget: windowBytes > nodeWindowBytes
  };
}

module.exports = {
  BITCOIN_L1_BLOCK_BYTES,
  BITCOIN_L1_BLOCK_INTERVAL_MS,
  aggregatePeerBandwidth,
  peerBandwidthByteLength,
  peerBandwidthSnapshot,
  perPeerBandwidthBudgetBytes,
  recordPeerBandwidth,
  rollPeerBandwidthWindow
};
