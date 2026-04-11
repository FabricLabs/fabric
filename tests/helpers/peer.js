'use strict';

const net = require('net');

let NODEA;
let NODEB;
try {
  NODEA = require('../../settings/node-a');
} catch (e) {
  NODEA = { key: {} };
}
try {
  NODEB = require('../../settings/node-b');
} catch (e) {
  NODEB = { key: {} };
}

function offlinePeerSettings (overrides = {}) {
  return Object.assign({
    listen: false,
    networking: false,
    peersDb: null,
    upnp: false,
    peers: [],
    debug: false,
    reconnectToKnownPeers: false
  }, overrides);
}

function hubBaseSettings (port, overrides = {}) {
  return Object.assign(
    { verbosity: 1 },
    NODEA,
    {
      listen: true,
      port,
      interface: '127.0.0.1',
      upnp: false,
      peers: [],
      networking: false,
      peersDb: null,
      constraints: { peers: { max: 32, shuffle: 8 } }
    },
    overrides
  );
}

function memberBaseSettings (hub, keySettings, overrides = {}) {
  return Object.assign(
    { verbosity: 1 },
    keySettings,
    {
      listen: false,
      port: 0,
      upnp: false,
      peersDb: null,
      networking: true,
      peers: [`${hub.key.pubkey}@127.0.0.1:${hub.settings.port}`]
    },
    overrides
  );
}

async function waitUntil (predicate, timeoutMs = 15000, intervalMs = 40) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout after ${timeoutMs}ms waiting for condition`);
}

async function getFreePort () {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      s.close(() => {
        if (!port) return reject(new Error('Could not allocate a free port'));
        resolve(port);
      });
    });
  });
}

module.exports = {
  NODEA,
  NODEB,
  offlinePeerSettings,
  hubBaseSettings,
  memberBaseSettings,
  waitUntil,
  getFreePort
};
