'use strict';

const assert = require('assert');
const Bitcoin = require('../services/bitcoin');
const State = require('../types/state');
const Store = require('../types/store');

describe('Hub crash-report follow-ups (core)', function () {
  it('State.serialize does not throw on null', function () {
    const state = new State({ ok: true });
    const serialized = state.serialize(null);
    assert.ok(serialized);
    assert.doesNotThrow(() => new State(null));
  });

  it('Store._POST rejects a null body', async function () {
    const store = new Store({ persistent: false });
    await assert.rejects(() => store._POST('/widgets', null), /JSON body/);
  });

  it('applyP2pAddNodes treats RPC -23 already-added as success', async function () {
    const btc = Object.create(Bitcoin.prototype);
    btc.settings = { debug: false, network: 'regtest' };
    btc._makeRPCRequest = async function () {
      throw new Error('addnode failed hub.fabric.pub:18444: [-23] Node already added');
    };
    const warnings = [];
    btc.emit = function (ev, msg) {
      if (ev === 'warning') warnings.push(msg);
    };
    const done = await Bitcoin.prototype.applyP2pAddNodes.call(btc, ['hub.fabric.pub:18444']);
    assert.deepStrictEqual(done, ['hub.fabric.pub:18444']);
    assert.strictEqual(warnings.length, 0);
  });
});
