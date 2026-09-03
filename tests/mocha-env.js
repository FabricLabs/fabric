'use strict';

/**
 * noise-protocol-stream keeps one shared WASM bridge EventEmitter; each in-flight
 * handshake adds three `noise_stream_handshake_*` listeners until split/destroy.
 * Peer tests can still exceed the default cap (10) during concurrent dials.
 * Must run before the package is first required (see `package.json` test script).
 */
const { EventEmitter } = require('events');
EventEmitter.defaultMaxListeners = Math.max(EventEmitter.defaultMaxListeners || 10, 96);
