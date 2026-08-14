/**
 * Example local settings for a Fabric node.
 * Copy to `settings/local.js` (gitignored) for operator overrides, or rely on
 * environment variables alone — the example is the packaged fallback when
 * `settings/local.js` is absent.
 */
'use strict';

module.exports = {
  name: process.env.NAME,
  namespace: process.env.NAMESPACE,
  seed: process.env.FABRIC_SEED,
  xprv: process.env.FABRIC_XPRV,
  xpub: process.env.FABRIC_XPUB,
  /** Fabric Peer TCP/NOISE listen port. */
  port: process.env.FABRIC_PORT || 7777,
  /**
   * Fabric Peer bind address. Default all interfaces.
   * For a dedicated public NIC (e.g. relay.goon.vc → 65.21.231.149):
   *   FABRIC_INTERFACE=65.21.231.149
   * Alias: FABRIC_PEER_INTERFACE (same meaning).
   * Resolved in Peer via `@fabric/core/functions/fabricListenInterface`.
   */
  interface: process.env.FABRIC_INTERFACE || process.env.FABRIC_PEER_INTERFACE || '0.0.0.0',
  network: process.env.FABRIC_NETWORK || 'regtest',
  debug: process.env.FABRIC_DEBUG === '1' || process.env.FABRIC_DEBUG === 'true',
  fullnode: true,
  listen: true
};
