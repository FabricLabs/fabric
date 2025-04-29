'use strict';

import assert from 'assert';
import Fabric from '../types/fabric.mjs';

describe('@fabric/core (ESM)', function () {
  describe('Fabric', function () {
    let fabric;

    beforeEach(function () {
      fabric = new Fabric();
    });

    it('should expose a constructor', function () {
      assert.equal(Fabric instanceof Function, true);
    });

    it('should create a new instance', function () {
      assert.equal(fabric instanceof Fabric, true);
    });

    it('should have all static getters', function () {
      assert.equal(Fabric.App instanceof Function, true);
      assert.equal(Fabric.Block instanceof Function, true);
      assert.equal(Fabric.Chain instanceof Function, true);
      assert.equal(Fabric.Circuit instanceof Function, true);
      assert.equal(Fabric.Collection instanceof Function, true);
      assert.equal(Fabric.Entity instanceof Function, true);
      assert.equal(Fabric.Key instanceof Function, true);
      assert.equal(Fabric.Ledger instanceof Function, true);
      assert.equal(Fabric.Machine instanceof Function, true);
      assert.equal(Fabric.Message instanceof Function, true);
      assert.equal(Fabric.Observer instanceof Function, true);
      assert.equal(Fabric.Oracle instanceof Function, true);
      assert.equal(Fabric.Peer instanceof Function, true);
      assert.equal(Fabric.Program instanceof Function, true);
      assert.equal(Fabric.Remote instanceof Function, true);
      assert.equal(Fabric.Resource instanceof Function, true);
      assert.equal(Fabric.Service instanceof Function, true);
      assert.equal(Fabric.Scribe instanceof Function, true);
      assert.equal(Fabric.Script instanceof Function, true);
      assert.equal(Fabric.Stack instanceof Function, true);
      assert.equal(Fabric.State instanceof Function, true);
      assert.equal(Fabric.Store instanceof Function, true);
      assert.equal(Fabric.Vector instanceof Function, true);
      assert.equal(Fabric.Wallet instanceof Function, true);
      assert.equal(Fabric.Worker instanceof Function, true);
    });

    it('should have static utility methods', function () {
      assert.equal(Fabric.sha256 instanceof Function, true);
      assert.equal(Fabric.random instanceof Function, true);
    });

    it('should have instance methods', function () {
      assert.equal(fabric._GET instanceof Function, true);
      assert.equal(fabric._SET instanceof Function, true);
      assert.equal(fabric._PUT instanceof Function, true);
      assert.equal(fabric._POST instanceof Function, true);
      assert.equal(fabric._PATCH instanceof Function, true);
      assert.equal(fabric._DELETE instanceof Function, true);
      assert.equal(fabric.register instanceof Function, true);
      assert.equal(fabric.enable instanceof Function, true);
      assert.equal(fabric.append instanceof Function, true);
      assert.equal(fabric.set instanceof Function, true);
      assert.equal(fabric.get instanceof Function, true);
      assert.equal(fabric.push instanceof Function, true);
      assert.equal(fabric.use instanceof Function, true);
    });

    it('should have initialized components', function () {
      assert.equal(fabric.chain instanceof Fabric.Chain, true);
      assert.equal(fabric.machine instanceof Fabric.Machine, true);
      assert.equal(fabric.store instanceof Fabric.Store, true);
    });

    it('should have initialized maps', function () {
      assert.equal(typeof fabric.agent === 'object', true);
      assert.equal(typeof fabric.modules === 'object', true);
      assert.equal(typeof fabric.opcodes === 'object', true);
      assert.equal(typeof fabric.peers === 'object', true);
      assert.equal(typeof fabric.plugins === 'object', true);
      assert.equal(typeof fabric.services === 'object', true);
    });

    it('can start and stop smoothly', function (done) {
      fabric.on('ready', done);
      async function main () {
        await fabric.start();
        await fabric.stop();
      }
      main();
    });
  });
}); 