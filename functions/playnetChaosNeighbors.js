'use strict';

/**
 * Playnet noisy-neighbor / chaos planning + crash-report shape.
 *
 * Operator desktop keys (Hub + GoonCitizen) stay dominant for registry /
 * CONTRACT_PUBLISH. Chaos peers always use ephemeral keys so floods never
 * mint Accept tokens or impersonate the suite operator.
 *
 * Does not send P2P_FLUSH_CHAIN, P2P_FILE_SEND, or GHSA advisory documents.
 */

const crypto = require('crypto');

const DEFAULT_PLAYNET_PEERS = Object.freeze([
  'hub.fabric.pub:7777',
  'relay.goon.vc:7777'
]);

const DEFAULT_LOCAL_PEERS = Object.freeze([
  '127.0.0.1:7777',
  '127.0.0.1:7778'
]);

/**
 * Network conditions blasted at outdated / unupgraded peers.
 * Each condition is a signed or raw wire pattern intended to stress parsers
 * and session handling so crash / disconnect reports can be captured.
 *
 * @returns {Array<object>}
 */
function listPlaynetChaosConditions () {
  return [
    {
      id: 'signed-typed-storm',
      description: 'Signed first-class opcodes (ping, chat, gossip, alias, peering offer, inventory, base)',
      types: [
        'P2P_PING',
        'P2P_CHAT_MESSAGE',
        'P2P_PEER_GOSSIP',
        'P2P_PEERING_OFFER',
        'P2P_PEER_ALIAS',
        'P2P_INVENTORY_REQUEST',
        'P2P_BASE_MESSAGE'
      ],
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'oversized-chat-burst',
      description: 'Large UTF-8 P2P_CHAT_MESSAGE bodies to stress chat ingest',
      types: ['P2P_CHAT_MESSAGE'],
      chatBytes: 4096,
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'unknown-opcode-spray',
      description: 'Signed unknown / generic chaos type labels via P2P_BASE_MESSAGE',
      types: ['P2P_BASE_MESSAGE'],
      unknownLabels: true,
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'raw-amp-noise',
      description: 'Unparsed AMP-sized random frames (parser crash surface)',
      types: [],
      rawAmp: true,
      reconnect: false
    },
    {
      id: 'concurrent-noisy-neighbors',
      description: 'N ephemeral peers dialing the same target and writing in parallel',
      types: ['P2P_PING', 'P2P_CHAT_MESSAGE', 'P2P_PEER_GOSSIP'],
      concurrent: true,
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'reconnect-flap',
      description: 'Connect → short storm → stop → re-dial (session flap)',
      types: ['P2P_PING', 'P2P_CHAT_MESSAGE'],
      rawAmp: false,
      reconnect: true
    },
    {
      id: 'inventory-shape-noise',
      description: 'Signed inventory-shaped BASE messages (no file bytes)',
      types: ['P2P_BASE_MESSAGE'],
      inventoryShape: true,
      rawAmp: false,
      reconnect: false
    }
  ];
}

/**
 * Local Hub desktop + GoonCitizen desktop as dominant playnet clients.
 * Chaos never uses the operator FABRIC_XPRV.
 *
 * @param {object} [opts]
 * @returns {object}
 */
function planDominantDesktopClients (opts = {}) {
  const hubHttp = String(opts.hubHttp || process.env.FABRIC_HUB_RPC_URL || 'http://127.0.0.1:8080')
    .trim().replace(/\/$/, '');
  const hubPeer = String(opts.hubPeer || process.env.FABRIC_LOCAL_HUB_PEER || '127.0.0.1:7777').trim();
  const gcHttp = String(opts.goonCitizenHttp || process.env.SC_HTTP || 'http://127.0.0.1:3041')
    .trim().replace(/\/$/, '');
  const gcPeer = String(opts.goonCitizenPeer || process.env.SC_FABRIC_PEER || '127.0.0.1:7778').trim();
  const playnetPeers = Array.isArray(opts.playnetPeers) && opts.playnetPeers.length
    ? opts.playnetPeers.slice()
    : DEFAULT_PLAYNET_PEERS.slice();

  return {
    role: 'dominant-desktop-clients',
    operatorKeySource: 'FABRIC_XPRV',
    sharedIdentity: true,
    // A Fabric network always exists: local desktop mesh and/or public playnet.
    networkAlwaysExists: true,
    management: {
      shortTerm: 'local-lead',
      longTerm: 'hub.fabric.pub',
      shortTermRegistry: hubPeer,
      longTermRegistry: 'hub.fabric.pub:7777',
      longTermHttp: 'https://hub.fabric.pub'
    },
    note: 'Hub desktop and GoonCitizen desktop must load the same suite FABRIC_XPRV; chaos peers use ephemeral keys only. Short-term playnet lead = local Hub; long-term management = hub.fabric.pub.',
    hubDesktop: {
      app: '@fabric/hub',
      role: 'playnet-registry',
      http: hubHttp,
      fabricPeer: hubPeer,
      acceptMethod: 'AcceptTrackedApplicationContract',
      readiness: [
        'GetNetworkStatus',
        'ListTrackedApplicationContracts',
        '/services/peering',
        '/services/distributed/epoch'
      ]
    },
    goonCitizenDesktop: {
      app: 'GoonCitizen',
      role: 'application-publisher',
      http: gcHttp,
      fabricPeer: gcPeer,
      dial: [hubPeer].concat(playnetPeers.filter((p) => p !== hubPeer)),
      publish: 'CONTRACT_PUBLISH',
      deployFlags: ['--local-registry', '--accept']
    },
    noisyNeighbors: {
      keySource: 'ephemeral',
      neverOperatorKey: true,
      conditions: listPlaynetChaosConditions().map((c) => c.id),
      crashReportFields: [
        'disconnects',
        'hardErrors',
        'econnreset',
        'writes',
        'reconnectCycles',
        'targets'
      ]
    },
    playnetPeers,
    safe: true
  };
}

/**
 * Playnet lead capture: short-term local Hub registry, long-term hub.fabric.pub.
 * Tests and deploy scripts assume a Fabric network always exists (local and/or global).
 *
 * @param {object} [opts]
 * @param {'local-lead'|'hub.fabric.pub'} [opts.horizon]
 * @returns {object}
 */
function planPlaynetLeadCapture (opts = {}) {
  const horizon = opts.horizon === 'hub.fabric.pub' ? 'hub.fabric.pub' : 'local-lead';
  const dominant = planDominantDesktopClients(opts);
  const local = {
    horizon: 'local-lead',
    registryHttp: dominant.hubDesktop.http,
    registryPeer: dominant.hubDesktop.fabricPeer,
    omitProductionHubPeer: true,
    acceptOn: 'loopback',
    deployFlags: ['--local-registry', '--accept'],
    steps: [
      'start-local-hub-desktop-with-FABRIC_XPRV',
      'confirm-fabric-beacon-accepted',
      'point-gooncitizen-peers-at-local-hub-first',
      'CONTRACT_PUBLISH-and-Accept-on-loopback',
      'optional-dial-relay-for-mesh-visibility'
    ]
  };
  const longTerm = {
    horizon: 'hub.fabric.pub',
    registryHttp: 'https://hub.fabric.pub',
    registryPeer: 'hub.fabric.pub:7777',
    omitProductionHubPeer: false,
    acceptOn: 'hub.fabric.pub',
    deployFlags: ['--production', '--accept'],
    steps: [
      'align-FABRIC_XPRV-with-hub.fabric.pub-_rootKey',
      'publish-CONTRACT_PUBLISH-to-hub.fabric.pub:7777',
      'AcceptTracked-on-https://hub.fabric.pub',
      'repoint-client-seeds-to-hub.fabric.pub',
      'retire-local-lead-as-authoritative-registry'
    ]
  };
  const active = horizon === 'hub.fabric.pub' ? longTerm : local;
  return {
    role: 'playnet-lead-capture',
    networkAlwaysExists: true,
    horizon: active.horizon,
    active,
    shortTerm: local,
    longTerm,
    dominant,
    safe: horizon === 'local-lead'
      ? !/hub\.fabric\.pub/i.test(active.registryHttp)
      : /hub\.fabric\.pub/i.test(active.registryHttp)
  };
}

/**
 * Plan a chaos / noisy-neighbor blast for crash-report capture.
 *
 * @param {object} [opts]
 * @returns {object}
 */
function planPlaynetChaosBlast (opts = {}) {
  const isolated = opts.isolated === true ||
    process.env.FABRIC_CHAOS_ISOLATED === '1' ||
    process.env.FABRIC_CHAOS_ISOLATED === 'true';
  const production = !isolated && (opts.production === true ||
    process.env.FABRIC_PLAYNET_CHAOS === '1' ||
    process.env.FABRIC_PLAYNET_CHAOS === 'true' ||
    process.env.ADV_PRODUCTION === '1');
  const explicitPeers = Array.isArray(opts.peers) && opts.peers.length
    ? opts.peers.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const envPeers = String(process.env.FABRIC_PLAYNET_PEERS || process.env.ADV_FABRIC || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const peers = explicitPeers.length ? explicitPeers : (isolated ? [] : envPeers);
  const targets = peers.length
    ? peers
    : (isolated ? [] : (production ? DEFAULT_PLAYNET_PEERS.slice() : DEFAULT_LOCAL_PEERS.slice()));

  const conditions = listPlaynetChaosConditions();
  const selected = Array.isArray(opts.conditions) && opts.conditions.length
    ? conditions.filter((c) => opts.conditions.includes(c.id))
    : conditions;

  const neighborCount = Math.max(1, Math.min(Number(opts.neighbors) ||
    Number(process.env.FABRIC_CHAOS_NEIGHBORS) || 3, 16));
  const iterations = Math.max(8, Math.min(Number(opts.iterations) ||
    Number(process.env.FABRIC_FUZZ_PEER_CHAOS_ITERATIONS) || 48, 500));

  return {
    role: 'playnet-chaos-blast',
    production: !!production,
    isolated: !!isolated,
    targets,
    neighborCount,
    iterations,
    conditions: selected,
    useOperatorKey: false,
    forbiddenWire: ['P2P_FLUSH_CHAIN', 'P2P_FILE_SEND'],
    reportName: String(opts.reportName || process.env.FABRIC_CHAOS_REPORT ||
      (isolated
        ? 'playnet-chaos-neighbors-isolated.json'
        : (production ? 'playnet-chaos-neighbors.json' : 'playnet-chaos-neighbors-local.json'))),
    dominant: planDominantDesktopClients(opts.dominant || {})
  };
}

/**
 * Empty crash-report skeleton filled by the runner.
 * @param {object} plan
 * @returns {object}
 */
function emptyChaosCrashReport (plan) {
  return {
    at: new Date().toISOString(),
    role: plan && plan.role,
    production: !!(plan && plan.production),
    isolated: !!(plan && plan.isolated),
    targets: (plan && plan.targets) || [],
    conditions: [],
    disconnects: [],
    hardErrors: [],
    econnreset: 0,
    writes: { ok: 0, fail: 0, types: {} },
    reconnectCycles: 0,
    neighborPubkeys: [],
    operatorKeyUsed: false,
    notes: []
  };
}

/**
 * Classify a peer error string for crash reporting.
 * @param {string} msg
 * @returns {'soft'|'hard'|'reset'}
 */
function classifyChaosPeerError (msg) {
  const s = String(msg || '');
  if (/ECONNRESET|EPIPE|socket hang up/i.test(s)) return 'reset';
  if (/Attempted to write to a closed|write after end|not connected/i.test(s)) return 'soft';
  return 'hard';
}

/**
 * Build a signed message body for a condition + type.
 * @param {object} condition
 * @param {string} type
 * @param {number} i
 * @returns {string}
 */
function chaosMessageBody (condition, type, i) {
  if (type === 'P2P_CHAT_MESSAGE') {
    const n = Math.max(16, Number(condition.chatBytes) || 48);
    const pad = crypto.randomBytes(Math.min(n, 8192)).toString('base64').slice(0, n);
    return `playnet-chaos-${condition.id}-${i}-${pad}`;
  }
  if (type === 'P2P_PEER_ALIAS') {
    return `chaos-${i}`.slice(0, 24);
  }
  if (type === 'P2P_INVENTORY_REQUEST') {
    return JSON.stringify({
      type: 'INVENTORY_REQUEST',
      object: {
        kind: 'documents',
        maxSats: 1,
        nonce: `playnet-chaos-${condition.id}-${i}`
      }
    });
  }
  const object = {
    type: condition.unknownLabels ? 'UNKNOWN_CHAOS' : type,
    nonce: `playnet-chaos-${condition.id}-${i}`,
    created: new Date().toISOString()
  };
  if (condition.inventoryShape) {
    object.type = 'INVENTORY_REQUEST';
    object.object = { documents: [], noise: crypto.randomBytes(32).toString('hex') };
  }
  return JSON.stringify(object);
}

module.exports = {
  DEFAULT_PLAYNET_PEERS,
  DEFAULT_LOCAL_PEERS,
  listPlaynetChaosConditions,
  planDominantDesktopClients,
  planPlaynetLeadCapture,
  planPlaynetChaosBlast,
  emptyChaosCrashReport,
  classifyChaosPeerError,
  chaosMessageBody
};
