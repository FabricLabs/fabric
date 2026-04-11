module.exports = {
  parallel: false,
  recursive: true,
  // CI runs `c8 npm test`; instrumentation + slower runners can push fuzz / integration
  // cases past a 10s budget while they still pass locally without c8.
  timeout: 30000,
  // Some suites leave active handles (ZMQ, Level, timers, NOISE sockets). Without this,
  // Mocha can report "passing" yet the Node process never exits. See `node --test` / `--detect-open-handles` to debug.
  exit: true,
  // Exclude tests that require the native C addon (build/Release/fabric.node).
  // Loading them would run native code that can segfault if the addon is unbuilt
  // or linked against missing libs. Run those tests explicitly when the addon is built.
  ignore: [
    'tests/verify_bip340.js',
    'tests/verify_bip341_p2tr.js',
    'tests/verify_bip341_p2tr_single.js',
    'tests/signet_taproot_integration.js',
    'tests/regtest_taproot_broadcast.js',
    'tests/regtest_asset_issuance.js',
    'tests/regtest.taproot.mocha.js',
    'tests/frost.peer.mocha.js',
    'tests/bitcoin.signet.taproot_p2tr.js',
    'tests/bitcoin.signet.js'
  ]
}; 