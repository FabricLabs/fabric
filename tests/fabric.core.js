'use strict';

// Core
const Fabric = require('../');

// Modules
const Service = require('../lib/service');

// Testing
const assert = require('assert');
const expect = require('chai').expect;

// Data
const genesis = require('../data/fabric');
const message = require('../data/message');
const samples = require('../data/samples');

// Opcodes
const OPCODES = require('../data/opcodes');

// test our own expectations.  best of luck.
// TODO: write parser for comments
// Some of our GitHub Issues have tables and/or YAML — reading "frontmatter"
// from tables in documents should be standardized.
// @consensus:
// @quest:
describe('Fabric', function () {
  describe('Core', function () {
    it('should expose a constructor', function () {
      assert.equal(Fabric instanceof Function, true);
    });

    it('generates the correct, hard-coded genesis seed', async function provenance () {
      let seed = new Fabric.Vector(genesis['@data'])._sign();

      assert.equal(genesis['@id'], samples.names.fabric);
      assert.equal(seed['@id'], genesis['@id']);
    });

    it('can start and stop smoothly', function (done) {
      let fabric = new Fabric();

      async function main () {
        await fabric.start();
        await fabric.stop();
        done();
      }

      main();
    });

    it('can compute a value', async function prove () {
      // TODO: use Fabric itself
      let machine = new Fabric.Machine(false);

      // TODO: use Fabric instead of Fabric.Machine
      machine.define('OP_TRUE', OPCODES.OP_TRUE);

      // fabric.push('OP_TRUE');
      machine.script.push('OP_TRUE');

      await machine.start();
      await machine.compute();
      await machine.stop();

      assert.equal(machine.state.id, samples.names.stackWithSingleValidFrame);
      assert.equal(machine.state['@data'][0], true);
    });

    it('can sum two values', async function prove () {
      let machine = new Fabric.Machine(false);

      machine.define('OP_ADD', OPCODES.OP_ADD);

      machine.script.push('1');
      machine.script.push('1');
      machine.script.push('OP_ADD');

      await machine.start();
      await machine.compute();
      await machine.stop();

      assert.equal(machine.state['@data'][0], 2);
    });

    it('can sum three values', async function prove () {
      let machine = new Fabric.Machine(false);

      machine.define('OP_ADD', OPCODES.OP_ADD);

      machine.script.push('1');
      machine.script.push('1');
      machine.script.push('OP_ADD');
      machine.script.push('2');
      machine.script.push('OP_ADD');

      await machine.start();
      await machine.compute();
      await machine.stop();

      assert.equal(machine.state['@data'][0], 4);
    });

    it('can store and retrieve a blob', async function datastore () {
      let fabric = new Fabric();

      await fabric.start();

      let put = await fabric._SET('/assets/test', message['@data']);
      let get = await fabric._GET('/assets/test');

      await fabric.stop();

      assert.equal(put, put);
      assert.equal(get, message['@data']);
    });

    xit('can store and retrieve an object', async function datastore () {
      let fabric = new Fabric();

      await fabric.start();

      let put = await fabric._SET('/assets/genesis', genesis);
      let get = await fabric._GET('/assets/genesis');

      await fabric.stop();

      assert.equal(put, put);
      assert.equal(get, message['@data']);
    });
  });

  describe('Crypto', function () {
    it('offers a "Key" type', function () {
      assert.equal(Fabric.Key instanceof Function, true);
    });

    it('can create an ECDSA key', function () {
      let key = new Fabric.Key();
      assert.ok(key);
    });

    it('can sign some data', function () {
      let key = new Fabric.Key();
      let signature = key._sign(message['@data']);

      assert.ok(signature);
    });

    it('produces a valid signature', function () {
      let key = new Fabric.Key();
      let signature = key._sign(message['@data']);
      let valid = key._verify(message['@data'], signature)
      assert.ok(valid);
    });
  });

  describe('Service', function () {
    it('should expose a constructor', function () {
      assert.equal(Service instanceof Function, true);
    });

    it('can create an instance', async function provenance () {
      let service = new Service({
        name: 'Test'
      });

      assert.ok(service);
    });

    it('can start offering service', function (done) {
      let service = new Service();

      async function main () {
        await service.start();
        await service.stop();
        assert.ok(service);
        done();
      }

      main();
    });
  });
});
