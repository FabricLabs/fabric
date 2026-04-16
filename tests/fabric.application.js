'use strict';

const { FabricShell } = require('../types/service');

const assert = require('assert');
const expect = require('chai').expect;

describe('@fabric/core/types/service (FabricShell)', function () {
  describe('FabricShell', function () {
    // Full suite load can push start/stop over 5s; keep CI stable.
    this.timeout(30000);

    it('is available from @fabric/core', function () {
      assert.equal(FabricShell instanceof Function, true);
    });

    it('should expose a constructor', function () {
      assert.equal(typeof FabricShell, 'function');
    });

    it('has a normal lifecycle', async function () {
      const app = new FabricShell();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('allow a Resource to be defined', async function () {
      const app = new FabricShell();
      app.define('Example', {
        components: {
          list: 'fabric-example-list',
          view: 'fabric-example-view'
        }
      });

      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('should create an application smoothly', async function () {
      const app = new FabricShell();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('should defer to an oracle authority', async function () {
      const app = new FabricShell();
      const oracle = { id: 'test-oracle' };
      app.attach({});

      await app.start();
      await app.defer(oracle);

      await app.stop();

      assert.ok(oracle);
      assert.ok(app);
    });

    it('render writes attached element markup', function () {
      const app = new FabricShell();
      const element = {
        attrs: {},
        setAttribute: function (k, v) { this.attrs[k] = v; },
        innerHTML: ''
      };
      app.attach(element);
      const out = app.render();
      assert.strictEqual(typeof out, 'string');
      assert.ok(out.includes('fabric-application'));
      assert.ok(typeof element.attrs.integrity === 'string');
      assert.ok(element.innerHTML.includes('fabric-state-json'));
    });

    it('use currently throws when superclass has no use()', function () {
      const app = new FabricShell();
      assert.throws(() => app.use('demo', { enabled: true }), /use is not a function/);
    });

    it('registerCommand binds method to shell instance', function () {
      const app = new FabricShell();
      app._registerCommand('echoSelf', function () {
        return this.id;
      });
      assert.strictEqual(typeof app.commands.echoSelf, 'function');
      assert.strictEqual(app.commands.echoSelf(), app.id);
    });

    it('envelop returns null and logs when selector is missing', function () {
      const app = new FabricShell();
      const logs = [];
      app.log = function () { logs.push(Array.from(arguments).join(' ')); };
      const origDocument = global.document;
      global.document = {
        querySelector: function () { return null; }
      };
      try {
        const out = app.envelop('#missing');
        assert.strictEqual(out, null);
        assert.ok(logs.some((x) => x.includes('could not find element')));
      } finally {
        global.document = origDocument;
      }
    });

    it('registerService relays ChatMessage payloads to node relay', async function () {
      const app = new FabricShell();
      app.settings.services = ['relay'];
      const relayed = [];
      app.node = {
        id: 'node-1',
        relayFrom: function (id, msg) {
          relayed.push({ id, msg });
        }
      };
      class RelayService extends require('../types/service') {}
      const service = app._registerService('relay', RelayService);
      service.emit('message', { '@type': 'ChatMessage', body: 'hello' });
      assert.strictEqual(relayed.length, 1);
      assert.strictEqual(relayed[0].id, 'node-1');
    });

    it('registerService forwards warning/error and exercises default message branch', function () {
      const app = new FabricShell();
      app.settings.services = ['relay'];
      const warnings = [];
      const errors = [];
      app._appendWarning = async function (m) { warnings.push(String(m)); };
      app._appendError = async function (m) { errors.push(String(m)); };
      app._appendMessage = async function () {};
      app.node = { id: 'node-1', relayFrom: function () {} };
      class RelayService extends require('../types/service') {}
      const service = app._registerService('relay', RelayService);
      service.emit('warning', { kind: 'warn' });
      service.emit('error', { kind: 'err' });
      service.emit('message', { '@type': 'NotChat', body: 'noop' }); // default switch path
      assert.ok(warnings.some((x) => x.includes('Service warning from relay')));
      assert.ok(errors.some((x) => x.includes('Service "relay" emitted error')));
    });

    it('registerService identity handler invokes _registerActor and handles exceptions', function () {
      const app = new FabricShell();
      app.settings.services = ['relay'];
      const messages = [];
      const errors = [];
      app._appendMessage = async function (m) { messages.push(String(m)); };
      app._appendError = async function (m) { errors.push(String(m)); };
      app.node = { id: 'node-1', relayFrom: function () {} };

      class RelayService extends require('../types/service') {
        _registerActor () {
          throw new Error('actor register failed');
        }
      }

      app._registerService('relay', RelayService);
      app.emit('identity', { id: 'actor-1' });
      assert.ok(messages.some((x) => x.includes('Registering actor on service "relay"')));
      assert.ok(errors.some((x) => x.includes('actor register failed')));
    });

    it('registerService duplicate returns warning path', function () {
      const app = new FabricShell();
      app.settings.services = ['dup'];
      const warnings = [];
      app._appendWarning = async function (m) { warnings.push(String(m)); };
      app.node = { id: 'node-1', relayFrom: function () {} };
      class DupService extends require('../types/service') {}
      app._registerService('dup', DupService);
      app._registerService('dup', DupService);
      assert.ok(warnings.some((x) => x.includes('Service already registered: dup')));
    });
  });
});
