'use strict';

const { getFreePort } = require('./peer');

/**
 * True when an RPC probe failed because no compatible bitcoind answered
 * (connection refused, HTTP 401 from the wrong daemon, etc.).
 * @param {*} error
 * @returns {boolean}
 */
function rpcProbeLooksUnavailable (error) {
  if (!error) return false;
  const code = error.code;
  const msg = String(error.message || error);
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  ) {
    return true;
  }
  const numeric = typeof code === 'number' ? code : Number(code);
  if (Number.isFinite(numeric) && (numeric === 401 || numeric === 403 || numeric === 404 || numeric >= 500)) {
    return true;
  }
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|Unauthorized|Forbidden|\b401\b|\b403\b/i.test(msg);
}

/**
 * Settings for a managed regtest bitcoind that must not collide with Hub,
 * Polar, or another suite (unique ports + datadir; skip external RPC probe).
 * @param {Object} [overrides]
 * @returns {Promise<Object>}
 */
async function isolatedManagedRegtestSettings (overrides = {}) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const p2pPort = await getFreePort();
  const rpcPort = await getFreePort();
  const zmqPort = await getFreePort();
  return Object.assign({
    network: 'regtest',
    mode: 'fabric',
    host: '127.0.0.1',
    port: p2pPort,
    rpcport: rpcPort,
    zmqport: zmqPort,
    zmq: { host: '127.0.0.1', port: zmqPort },
    managed: true,
    listen: 0,
    enforceIsolatedRegtest: true,
    debug: false,
    username: 'bitcoinrpc',
    password: 'password',
    datadir: `./stores/bitcoin-regtest-test-${stamp}`,
    bitcoinExtraParams: ['-dnsseed=0']
  }, overrides);
}

module.exports = {
  rpcProbeLooksUnavailable,
  isolatedManagedRegtestSettings
};
