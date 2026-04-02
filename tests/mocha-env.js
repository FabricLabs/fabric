'use strict';

/**
 * noise-protocol-stream keeps one shared WASM bridge EventEmitter; each session adds
 * three `noise_stream_handshake_*` listeners. Peer tests exceed the default cap (10).
 * Must run before the package is first required (see `package.json` test script).
 */
const { EventEmitter } = require('events');
EventEmitter.defaultMaxListeners = Math.max(EventEmitter.defaultMaxListeners || 10, 96);
