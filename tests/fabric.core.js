'use strict';

// require('debug-trace')({ always: true });

const {
  LARGE_COLLECTION_SIZE
} = require('../constants');

const config = require('../settings/test');

// Core
const Fabric = require('../');
const Web = require('@fabric/http');

// Modules
const Service = require('../types/service');
// const Schnorr = require('../types/schnorr');

// Services
const Bitcoin = require('../services/bitcoin');
// const Ethereum = require('../services/ethereum');

// Testing
const assert = require('assert');
const crypto = require('crypto');
// const expect = require('chai').expect;

// Data
const genesis = require('../assets/fabric.json');
const message = require('../assets/message');
const samples = require('../assets/samples');

// Opcodes
const OPCODES = require('../assets/opcodes');
const LOCAL_SERVER_CONFIG = {
  host: 'localhost',
  port: 9999,
  secure: false
};

// test our own expectations.  best of luck.
// TODO: write parser for comments
// Some of our GitHub Issues have tables and/or YAML — reading "frontmatter"
// from tables in documents should be standardized.
// @consensus:
// @quest:
describe('@fabric/core', function () {
  describe('Fabric', function () {
    // Everything should be a function...
    it('should expose a constructor', function () {
      assert.equal(Fabric instanceof Function, true);
    });

    // This doubles as an example pattern for running Fabric nodes.
    it('can start and stop smoothly', function (done) {
      let fabric = new Fabric();

      // We'll use Events in this first example, as they're essential to the
      // design of Fabric as a protocol for communication.
      fabric.on('done', done);

      // Define our `main` process.
      async function main () {
        await fabric.start();
        await fabric.stop();
      }

      // Run the `main` process, ().
      main();
    });

    it('generates the correct, hard-coded genesis seed', async function provenance () {
      let seed = new Fabric.Entity(genesis['@data']);

      assert.equal(seed.id, genesis['@id']);
      assert.equal(seed.id, samples.output.fabric);
    });

    it('serializes strings correctly', async function () {
      let state = new Fabric.Entity('Hello, world!');
      let hash = crypto.createHash('sha256').update('"Hello, world!"', 'utf8').digest('hex');
      let rendered = state.serialize();

      assert.equal(rendered.toString(), '"Hello, world!"');
      assert.equal(state.id, samples.output.hello);

      assert.equal(rendered.toString(), samples.input.hello);
      assert.equal(state.id, samples.output.hello);
      assert.equal(state.id, hash);
    });

    it('serializes lists correctly', async function () {
      let state = new Fabric.State(['Hello, world!']);
      let hash = crypto.createHash('sha256').update('["Hello, world!"]', 'utf8').digest('hex');
      let rendered = state.render();

      assert.equal(rendered.toString('utf8'), '["Hello, world!"]');
      assert.equal(state.id, samples.output.collection);
      assert.equal(state['@data'][0], samples.input.bare);
      assert.equal(rendered.toString(), samples.input.collection);
      assert.equal(state.id, samples.output.collection);
      assert.equal(state.id, hash);
    });

    it('manages lists effectively', async function () {
      let state = new Fabric.State(['Hello, world!']);
      let hash = crypto.createHash('sha256').update('["Hello, world!"]', 'utf8').digest('hex');
      let rendered = state.render();

      assert.equal(rendered.toString(), '["Hello, world!"]');
      assert.equal(state.id, samples.output.collection);
      assert.equal(state['@data'][0], samples.input.bare);
      assert.equal(rendered.toString(), samples.input.collection);
      assert.equal(state.id, samples.output.collection);
      assert.equal(state.id, hash);
    });

    it('manages maps effectively', async function () {
      let sample = { entropy: Math.random() };
      let state = new Fabric.State(sample);
      let hash = crypto.createHash('sha256').update(JSON.stringify(sample), 'utf8').digest('hex');
      let rendered = state.render();

      assert.equal(rendered, JSON.stringify(sample));
      assert.equal(state.id, hash);
    });

    xit('implements Schnorr', async function () {
      const p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;
      const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
      const x_G = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
      const y_G = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
      let schnorr = new Schnorr();
      let product = schnorr.multiply(p, n);

      console.log('schnorr:', schnorr);
      console.log('product:', product);

      assert.equal(p, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F);
      assert.equal(n, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141);
    });

    it('can verify a chain of one', async function () {
      let state = new Fabric.State(['Hello, world!']);
      let hash = crypto.createHash('sha256').update('["Hello, world!"]', 'utf8').digest('hex');
      let rendered = state.render();

      assert.equal(rendered, '["Hello, world!"]');
      assert.equal(state.id, samples.output.collection);
      assert.equal(state['@data'][0], samples.input.bare);
      assert.equal(rendered.toString(), samples.input.collection);
      assert.equal(state.id, samples.output.collection);
      assert.equal(state.id, hash);
    });

    it('passes some sanity checks', async function () {
      let buffer = Buffer.from('"Hello, world!"', 'utf8');
      let state = new Fabric.Entity('Hello, world!');
      let hash = crypto.createHash('sha256').update('"Hello, world!"', 'utf8').digest('hex');
      let reconstructed = Fabric.State.fromString('"Hello, world!"');
      assert.equal(state.id, samples.output.hello);
      assert.equal(state.id, hash);
    });

    it('passes longer sanity checks', async function () {
      let buffer = Buffer.from('["Hello, world!"]', 'utf8');
      let state = new Fabric.State(['Hello, world!']);
      let hash = crypto.createHash('sha256').update('["Hello, world!"]', 'utf8').digest('hex');
      let rendered = state.render();

      assert.equal(state.id, samples.output.collection);
      assert.equal(state.id, hash);
      assert.equal(rendered, buffer.toString());
    });

    it('can store and retrieve a buffer', async function () {
      let buffer = Buffer.from(message['@data'], 'utf8');
      let fabric = new Fabric({
        path: './stores/test',
        persistent: false
      });

      await fabric.start();

      let set = await fabric._SET('assets/test', buffer);
      let get = await fabric._GET('assets/test');

      await fabric.stop();

      assert.equal(set.toString('utf8'), buffer.toString('utf8'));
      assert.equal(get.constructor.name, 'Buffer');
      assert.equal(get.toString(), buffer.toString());
      assert.equal(get.toString('hex'), buffer.toString('hex'));
      assert.equal(get.toString(), message['@data']);
    });

    it('can store and retrieve an array', async function () {
      let array = [message['@data']];
      let fabric = new Fabric({
        path: './stores/secondary',
        persistent: false
      });

      await fabric.start();

      let set = await fabric._SET('assets/test', array);
      let get = await fabric._GET('assets/test');

      await fabric.stop();

      assert.equal(JSON.stringify(set), JSON.stringify(array));
      assert.equal(JSON.stringify(get), JSON.stringify(array));
      assert.equal(set.constructor.name, 'Array');
      assert.equal(get.constructor.name, 'Array');
    });

    it('can store and retrieve a string', async function () {
      let string = message['@data'];
      let fabric = new Fabric({
        path: './stores/strings',
        persistent: false
      });

      await fabric.start();

      let set = await fabric._SET('assets/test', string);
      let get = await fabric._GET('assets/test');

      await fabric.stop();

      assert.equal(set, string);
      assert.equal(get.constructor.name, 'String');
      assert.equal(get.toString(), string);
    });

    it('can store and retrieve a blob', async function datastore () {
      let blob = { blob: message['@data'] };
      let fabric = new Fabric({
        path: './stores/blob',
        persistent: false
      });

      await fabric.start();

      let set = await fabric._SET('assets/test', blob);
      let get = await fabric._GET('assets/test');

      await fabric.stop();

      let samples = {
        set: new Fabric.State(set),
        // put: new Fabric.State(put),
        get: new Fabric.State(get)
      };

      assert.equal(JSON.stringify(set), JSON.stringify(blob));
      assert.equal(get.blob, message['@data']);
    });

    it('can store and retrieve an object', async function datastore () {
      let fabric = new Fabric({
        persistent: false
      });

      await fabric.start();

      let put = await fabric._SET('assets/genesis', genesis['@data']);
      let get = await fabric._GET('assets/genesis');

      await fabric.stop();

      assert.equal(JSON.stringify(get), JSON.stringify(put));
      assert.equal(JSON.stringify(get), JSON.stringify(genesis['@data']));

      assert.equal(typeof get, typeof genesis);
    });
  });

  /* Disabled as `fs` polyfill needed for the browser.
  // TODO: implement polyfill for browserland
  describe('Disk', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Disk instanceof Function, true);
    });
  });
  */
});
