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
  port: process.env.FABRIC_PORT || 7777,
  network: process.env.FABRIC_NETWORK || 'regtest',
  debug: process.env.FABRIC_DEBUG === '1' || process.env.FABRIC_DEBUG === 'true',
  fullnode: true,
  listen: true
};
