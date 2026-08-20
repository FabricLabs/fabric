#!/usr/bin/env node
'use strict';

/**
 * Validate-and-relay node: a single Fabric {@link Peer} that checks inbound AMP
 * frames (size, body hash, BIP-340) and mesh-floods public gossip types
 * bit-identical. No Hub HTTP, Bitcoin, Discord, document fulfill, or contract
 * state accumulate.
 *
 * Usage:
 *   node scripts/gossip-relay.js
 *   node scripts/gossip-relay.js --list-types
 *   node scripts/gossip-relay.js --port 7777 --peers hub.fabric.pub:7777,relay.goon.vc:7777
 *   npm run gossip-relay
 *
 * Identity: FABRIC_XPRV / FABRIC_SEED / FABRIC_MNEMONIC, else ~/.fabric/wallet.json,
 * else an ephemeral key (printed as xpub only).
 */

try {
  require('../functions/fabricHomeEnv').loadFabricHomeEnv();
} catch (_) { /* older pin / missing home env */ }

const {
  GOSSIP_NETWORK_TYPES,
  gossipRelayPeerSettings,
  listPublicGossipFloodNames,
  classifyGossipWireType
} = require('../functions/gossipNetwork');
const { keySettingsFromEnv } = require('../functions/fabricKeyMaterial');
const { resolveFabricPeerInterface } = require('../functions/fabricListenInterface');

function printHelp () {
  console.log(`Usage: node scripts/gossip-relay.js [options]

  --list-types          Print the public gossip catalog and exit
  --port <n>            Listen port (default FABRIC_PORT or 7777)
  --peers <a,b>         Seed peers host:port (default playnet hubs)
  --interface <addr>    Bind address (FABRIC_INTERFACE wins when set)
  --inventory           Opt in to inventory request/response flood
  --debug               Verbose Peer debug
  -h, --help            This help

A single Peer instance validates AMP frames and relays public gossip
(${listPublicGossipFloodNames().join(', ')}).
`);
}

function parseArgv (argv) {
  const out = {
    listTypes: false,
    help: false,
    inventory: false,
    debug: false,
    port: null,
    peers: null,
    interface: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list-types') out.listTypes = true;
    else if (a === '--inventory') out.inventory = true;
    else if (a === '--debug') out.debug = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--peers') {
      out.peers = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--interface') out.interface = String(argv[++i] || '').trim();
  }
  return out;
}

function resolveKeySettings () {
  const fromEnv = keySettingsFromEnv(process.env);
  if (fromEnv) return { key: fromEnv, source: 'env' };
  try {
    const wallet = require('../functions/fabricWalletIdentity').loadIdentityFromWalletFile();
    if (wallet && wallet.xprv) return { key: { xprv: wallet.xprv }, source: 'wallet.json' };
  } catch (_) { /* no sealed wallet */ }
  return { key: {}, source: 'ephemeral' };
}

function printCatalog () {
  const cols = ['name', 'hex', 'policy', 'role'];
  console.log(cols.join('\t'));
  for (const row of GOSSIP_NETWORK_TYPES) {
    const hex = '0x' + Number(row.opcode).toString(16);
    console.log([row.name, hex, row.policy, row.role].join('\t'));
  }
  console.log('');
  console.log('public flood:', listPublicGossipFloodNames().join(', '));
}

async function main (argv) {
  const args = parseArgv(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.listTypes) {
    printCatalog();
    return 0;
  }

  const Peer = require('../types/peer');
  const identity = resolveKeySettings();
  const envPort = Number(process.env.FABRIC_PORT);
  const port = Number.isFinite(args.port) && args.port > 0
    ? args.port
    : (Number.isFinite(envPort) && envPort > 0 ? envPort : 7777);
  const peers = args.peers && args.peers.length
    ? args.peers
    : ['hub.fabric.pub:7777', 'relay.goon.vc:7777'];
  const iface = resolveFabricPeerInterface({
    interface: args.interface || '0.0.0.0'
  });

  const settings = gossipRelayPeerSettings({
    port,
    peers,
    interface: iface,
    key: identity.key,
    debug: args.debug === true,
    relayInventoryRequest: args.inventory === true,
    relayInventoryResponse: args.inventory === true
  });

  const peer = new Peer(settings);
  const counts = Object.create(null);
  peer.on('warning', (msg) => {
    console.warn('[GOSSIP-RELAY]', msg);
  });
  peer.on('error', (err) => {
    console.error('[GOSSIP-RELAY]', err && err.message ? err.message : err);
  });
  peer.on('peer', (remote) => {
    const addr = remote && (remote.name || remote.address) || 'unknown';
    console.log('[GOSSIP-RELAY] session', addr);
  });
  peer.on('message', (message) => {
    const type = message && message.type ? String(message.type) : 'unknown';
    counts[type] = (counts[type] || 0) + 1;
    if (args.debug) {
      console.log('[GOSSIP-RELAY] frame', type, classifyGossipWireType(type));
    }
  });

  const stop = async (signal) => {
    console.log('[GOSSIP-RELAY] stopping', signal || '');
    try { await peer.stop(); } catch (err) {
      console.error('[GOSSIP-RELAY] stop', err && err.message ? err.message : err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => { stop('SIGINT'); });
  process.on('SIGTERM', () => { stop('SIGTERM'); });

  await peer.start();
  const xpub = peer.key && peer.key.xpub ? peer.key.xpub : '(none)';
  console.log('[GOSSIP-RELAY] listening', `${iface}:${peer.settings.port}`);
  console.log('[GOSSIP-RELAY] identity', identity.source, 'xpub', xpub);
  console.log('[GOSSIP-RELAY] seeds', peers.join(', '));
  console.log('[GOSSIP-RELAY] flood', listPublicGossipFloodNames().join(', '));
  return null;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    if (typeof code === 'number') process.exit(code);
  }).catch((err) => {
    console.error('[GOSSIP-RELAY] failed', err);
    process.exit(1);
  });
}

module.exports = { main, parseArgv, printCatalog };
