'use strict';

// Testing
const assert = require('assert');

describe('@fabric/core/services/zmq', function () {
  let ZMQ;
  let zmqPath;
  let originalZeromq;
  let originalSetTimeout;
  let createdSockets;

  beforeEach(function () {
    // Resolve and cache original zeromq module
    zmqPath = require.resolve('zeromq/v5-compat');
    originalZeromq = require(zmqPath);
    createdSockets = [];

    // Lightweight socket stub
    const fakeZeromq = {
      socket: function (type) {
        const handlers = {};
        const sock = {
          type,
          handlers,
          subscribed: [],
          connectCalls: [],
          closed: false,
          on (event, fn) {
            handlers[event] = fn;
          },
          connect (addr) {
            this.connectCalls.push(addr);
            if (handlers.connect) handlers.connect();
          },
          close (msg) {
            this.closed = true;
            if (handlers.close) handlers.close(msg);
          },
          subscribe (topic) {
            this.subscribed.push(topic);
          }
        };
        createdSockets.push(sock);
        return sock;
      }
    };

    // Inject stubbed zeromq before loading service
    require.cache[zmqPath] = { exports: fakeZeromq };
    delete require.cache[require.resolve('../services/zmq')];

    // Make reconnection timer synchronous for tests
    originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn, _ms) => { fn(); };

    // Load service under test
    ZMQ = require('../services/zmq');
  });

  afterEach(function () {
    // Restore zeromq module and ZMQ service
    if (zmqPath && originalZeromq) {
      require.cache[zmqPath] = { exports: originalZeromq };
    }
    delete require.cache[require.resolve('../services/zmq')];

    // Restore timer
    if (originalSetTimeout) global.setTimeout = originalSetTimeout;
  });

  it('is available from @fabric/core', function () {
    assert.strictEqual(typeof ZMQ, 'function');
  });

  it('constructs with sensible defaults', function () {
    const zmq = new ZMQ();
    assert.strictEqual(zmq.settings.host, '127.0.0.1');
    assert.strictEqual(zmq.settings.port, 29000);
    assert.ok(Array.isArray(zmq.settings.subscriptions));
    assert.strictEqual(zmq._state.status, 'STOPPED');
    assert.strictEqual(zmq._state.reconnectAttempts, 0);
  });

  it('connects, subscribes, and emits typed messages', async function () {
    const zmq = new ZMQ({
      subscriptions: ['rawblock', 'rawtx', 'hashtx', 'hashblock'],
      maxReconnectAttempts: 2,
      reconnectInterval: 0
    });

    const received = [];
    zmq.on('message', (msg) => received.push(msg));

    await zmq.start();

    // There should be exactly one created socket
    assert.strictEqual(createdSockets.length, 1);
    const sock = createdSockets[0];

    // Subscriptions should have been applied
    assert.deepStrictEqual(sock.subscribed, ['rawblock', 'rawtx', 'hashtx', 'hashblock']);
    assert.ok(sock.connectCalls[0].startsWith('tcp://'));

    // Exercise all message topic handlers
    const topics = ['rawblock', 'rawtx', 'hashtx', 'hashblock'];
    topics.forEach((topic, i) => {
      const handler = sock.handlers.message;
      assert.ok(handler, 'message handler should be registered');
      handler(Buffer.from(topic), Buffer.from(String(i)));
    });

    assert.strictEqual(received.length, 4);
  });

  it('emits error immediately when maxReconnectAttempts is zero', async function () {
    const zmq = new ZMQ({
      maxReconnectAttempts: 0,
      reconnectInterval: 0
    });

    const errors = [];
    zmq.on('error', (err) => errors.push(err));

    await zmq.connect();
    assert.strictEqual(createdSockets.length, 1);
    const firstSock = createdSockets[0];

    // Close should skip reconnect and emit error
    firstSock.handlers.close('test-close');
    assert.ok(errors.length >= 1);
  });

  it('handles reconnect failures gracefully and updates state', async function () {
    const zmq = new ZMQ({
      maxReconnectAttempts: 1,
      reconnectInterval: 0
    });

    await zmq.connect();
    assert.strictEqual(createdSockets.length, 1);
    const firstSock = createdSockets[0];

    // Exercise disconnect and error event handlers
    if (firstSock.handlers.disconnect) firstSock.handlers.disconnect();
    if (firstSock.handlers.error) firstSock.handlers.error(new Error('boom'));

    // Force the scheduled reconnect to fail to cover catch path
    zmq.start = async function () {
      throw new Error('reconnect failed');
    };

    firstSock.handlers.close('test-close');
    // After a failed reconnect attempt, reconnectAttempts should have been incremented
    assert.ok(zmq._state.reconnectAttempts >= 1);
  });

  it('can be started and stopped cleanly', async function () {
    const zmq = new ZMQ();

    await zmq.start();
    assert.strictEqual(zmq.status, 'STARTED');
    assert.strictEqual(createdSockets.length, 1);

    const sock = createdSockets[0];
    await zmq.stop();
    assert.strictEqual(zmq.status, 'STOPPED');
    assert.strictEqual(sock.closed, true);
  });
});

