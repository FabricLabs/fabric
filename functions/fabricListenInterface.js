'use strict';

/**
 * Resolve Fabric Peer (TCP/NOISE) listen interface.
 *
 * Default is all interfaces (`0.0.0.0`). Operators pin a public NIC with:
 *   FABRIC_INTERFACE=65.21.231.149
 *   # alias:
 *   FABRIC_PEER_INTERFACE=65.21.231.149
 *
 * Used by Hub / LiveRelay / bare Peer so `relay.goon.vc` can bind only the
 * address published for that hostname.
 *
 * @param {Object} [opts]
 * @param {string} [opts.interface] Settings fallback when env unset
 * @param {string} [opts.host] Alias for `interface`
 * @param {string} [opts.fallback='0.0.0.0']
 * @param {string[]} [opts.envKeys]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {string}
 *
 * Precedence: environment (`FABRIC_INTERFACE` / `FABRIC_PEER_INTERFACE`) →
 * `opts.interface` / `opts.host` → `opts.fallback`. Operators pin the NIC via
 * env so process settings cannot silently override a host-specific bind.
 */
function resolveFabricPeerInterface (opts = {}) {
  const env = opts.env || process.env;
  const keys = Array.isArray(opts.envKeys) && opts.envKeys.length
    ? opts.envKeys
    : ['FABRIC_INTERFACE', 'FABRIC_PEER_INTERFACE'];
  for (const key of keys) {
    const v = String(env[key] || '').trim();
    if (v) return v;
  }
  const explicit = String(opts.interface || opts.host || '').trim();
  if (explicit) return explicit;
  return opts.fallback != null ? String(opts.fallback) : '0.0.0.0';
}

module.exports = {
  resolveFabricPeerInterface
};
