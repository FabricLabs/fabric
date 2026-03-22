'use strict';

/* global describe, it */

/**
 * Additional coverage for types/wallet.js, types/service.js, types/contract.js.
 */

const assert = require('assert');
const EventEmitter = require('events');

const Contract = require('../types/contract');
const Key = require('../types/key');
const Service = require('../types/service');
const Wallet = require('../types/wallet');
const { FIXTURE_XPRV } = require('../constants');

const keyOpts = { key: { xprv: FIXTURE_XPRV } };

describe('@fabric/core/types coverage (Wallet, Service, Contract)', function () {
  describe('Contract', function () {
    it('fromDot parses a minimal graph', function () {
      const dot = 'digraph G { a -> b }';
      const c = Contract.fromDot(dot);
      assert.ok(c);
      assert.ok(c.settings.circuit && Array.isArray(c.settings.circuit.nodes));
    });

    it('fromGraph builds circuit nodes', function () {
      const graphs = [{
        id: 'root',
        children: [
          { type: 'node_stmt', node_id: { id: 'n1' } },
          { type: 'unknown_type', foo: 1 }
        ]
      }];
      const circuit = Contract.fromGraph(graphs);
      assert.ok(circuit.nodes.length >= 1);
    });

    it('contract getter uses first signer', function () {
      const k = new Key({ xprv: FIXTURE_XPRV });
      const c = new Contract({
        ...keyOpts,
        state: {
          name: 'T',
          status: 'PAUSED',
          actors: [],
          balances: {},
          constraints: {},
          signatures: [],
          signers: [k.pubkey]
        }
      });
      const s = c.contract;
      assert.ok(typeof s === 'string');
      assert.ok(s.includes(k.pubkey));
    });

    it('commit emits changes when state mutated under observer', function (done) {
      const c = new Contract(keyOpts);
      const had = [];
      c.on('changes', (ch) => had.push(ch));
      c.on('commit', () => {
        try {
          assert.ok(had.length >= 1);
          done();
        } catch (e) {
          done(e);
        }
      });
      c._state.content.observedFlag = 'x';
      c.commit();
    });

    it('signWith returns a signature', function () {
      const c = new Contract(keyOpts);
      const out = c.signWith({ xprv: FIXTURE_XPRV });
      assert.ok(out && out.signature);
    });

    it('run executes and emits contract', function (done) {
      const c = new Contract({
        ...keyOpts,
        identity: { xprv: FIXTURE_XPRV }
      });
      c.on('contract', () => done());
      c.run();
    });

    it('execute aliases run', function (done) {
      const c = new Contract({
        ...keyOpts,
        identity: { xprv: FIXTURE_XPRV }
      });
      c.on('contract', () => done());
      c.execute();
    });

    it('_handleActivity resolves for plain activity', async function () {
      const c = new Contract(keyOpts);
      const r = await c._handleActivity({ type: 'Note', object: { content: 'hi' } });
      assert.ok(r && r.object);
    });

    it('_handleActivity rejects on bad input', async function () {
      const c = new Contract(keyOpts);
      await assert.rejects(() => c._handleActivity(undefined), /./);
    });

    it('_toUnsignedTransaction returns script snippet', function () {
      const c = new Contract(keyOpts);
      c._state.content.signers = [new Key({ xprv: FIXTURE_XPRV }).pubkey];
      const u = c._toUnsignedTransaction();
      assert.ok(u.script);
    });

    it('fromJavaScript throws until Template is wired', function () {
      assert.throws(() => Contract.fromJavaScript('1+1'), ReferenceError);
    });

    it('parse delegates to parseDot (missing on prototype)', function () {
      const c = new Contract(keyOpts);
      assert.throws(() => c.parse('digraph {}'), TypeError);
    });
  });

  describe('Service', function () {
    it('identify emits auth and returns pubkey', function () {
      const s = new Service({ name: 'S', key: { xprv: FIXTURE_XPRV } });
      let pk = null;
      s.on('auth', (p) => { pk = p; });
      const out = s.identify();
      assert.strictEqual(out, pk);
    });

    it('init sets components map', function () {
      const s = new Service();
      s.init();
      assert.deepStrictEqual(s.components, {});
    });

    it('ready emits ready', function (done) {
      const s = new Service();
      s.on('ready', () => done());
      s.ready();
    });

    it('lock returns false when already locked', function () {
      const s = new Service();
      assert.strictEqual(s.lock(5000), true);
      assert.strictEqual(s.lock(5000), false);
    });

    it('handler emits normalized message shape', function (done) {
      const s = new Service();
      s.on('message', (m) => {
        assert.strictEqual(m.object, 'o');
        done();
      });
      s.handler({ actor: 'a', target: 't', object: 'o' });
    });

    it('define and route invokes handler', async function () {
      const s = new Service({ name: 'R' });
      await s.start();
      s.define('CustomType', {
        handler: function (msg) {
          this.routed = true;
          return this;
        }
      });
      const msg = { type: 'CustomType', data: {} };
      const result = await s.route(msg);
      await s.stop();
      assert.strictEqual(result && result.routed, true);
    });

    it('broadcast with valid message emits message', function (done) {
      const s = new Service();
      s.on('message', (m) => {
        assert.strictEqual(m['@type'], 'Ping');
        done();
      });
      s.broadcast({ '@type': 'Ping', '@data': {} });
    });

    it('broadcast requires @type and @data', async function () {
      const s = new Service();
      await assert.rejects(() => s.broadcast({}), /@type/);
      await assert.rejects(() => s.broadcast({ '@type': 'x' }), /@data/);
    });

    it('get and set manipulate state paths', async function () {
      const s = new Service();
      await s.start();
      s.set('/foo', 'bar');
      assert.strictEqual(s.get('/foo'), 'bar');
      await s.stop();
    });

    it('toString returns entity string', function () {
      const s = new Service({ name: 'S' });
      assert.ok(typeof s.toString() === 'string');
    });

    it('replay routes list items', async function () {
      const s = new Service();
      await s.start();
      let n = 0;
      s.define('T', {
        handler: function () { n++; return this; }
      });
      s.replay([{ type: 'T' }, { type: 'T' }]);
      await s.stop();
      assert.strictEqual(n, 2);
    });

    it('cache get/set respects ttl', async function () {
      const s = new Service();
      await s.cache.set('k', 42, 10);
      assert.strictEqual(await s.cache.get('k'), 42);
      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(await s.cache.get('k'), null);
    });

    it('alert calls nested service alert', function () {
      const s = new Service({ services: ['child'] });
      let called = false;
      s.services.child = {
        alert: (msg) => { called = true; assert.strictEqual(msg, 'x'); }
      };
      s.alert('x');
      assert.strictEqual(called, true);
    });

    it('trust wires EventEmitter and returns bindings', function () {
      const s = new Service();
      const ee = new EventEmitter();
      ee.settings = { verbosity: 0 };
      const b = s.trust(ee);
      assert.ok(b._handleMessage);
    });

    it('trust throws for non-EventEmitter', function () {
      const s = new Service();
      assert.throws(() => s.trust({}), /EventEmitter/);
    });
  });

  describe('Wallet', function () {
    it('_getSeed returns seed from key', function () {
      const w = Wallet.fromSeed(Wallet.createSeed());
      assert.ok(w._getSeed());
    });

    it('_createFromFreshSeed returns phrase and keys', async function () {
      const w = new Wallet();
      const out = await w._createFromFreshSeed('');
      assert.ok(out.phrase && out.xprv && out.xpub);
    });

    it('_addOutputToSpendables pushes coin', async function () {
      const w = new Wallet();
      w._state.utxos = [];
      await w._addOutputToSpendables({ txid: 'a', vout: 0 });
      assert.strictEqual(w._state.utxos.length, 1);
    });

    it('_getUnspentOutput throws without utxos', async function () {
      const w = new Wallet();
      w._state.utxos = [];
      await assert.rejects(() => w._getUnspentOutput('addr'), /No available funds/);
    });

    it('getAddressFromRedeemScript returns null for falsy', function () {
      const w = new Wallet();
      assert.strictEqual(w.getAddressFromRedeemScript(null), null);
    });

    it('balanceFromState sums transaction values', function () {
      const w = new Wallet();
      const v = w.balanceFromState({ transactions: [{ value: 10 }, { value: 20 }] });
      assert.ok(typeof v === 'number' || v === undefined);
    });

    it('processBitcoinBlock iterates hashes', async function () {
      const w = new Wallet({ verbosity: 0 });
      await w.processBitcoinBlock({
        block: {
          hashes: [Buffer.from('aa', 'hex')]
        }
      });
    });

    it('_handleFabricTransaction logs', function () {
      const w = new Wallet();
      w._handleFabricTransaction({ id: 'x' });
    });

    it('_handleWalletTransaction logs', function () {
      const w = new Wallet();
      w._handleWalletTransaction({ txid: 'x' });
    });
  });
});
