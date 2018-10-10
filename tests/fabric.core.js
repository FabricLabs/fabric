'use strict';

// Core
const Fabric = require('../');

// Modules
const Service = require('../lib/service');

// Testing
const assert = require('assert');
// const expect = require('chai').expect;
const MerkleTree = require('merkletreejs');

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
describe('@fabric/core', function () {
  describe('Fabric', function () {
    it('should expose a constructor', function () {
      assert.equal(Fabric instanceof Function, true);
    });

    it('generates the correct, hard-coded genesis seed', async function provenance () {
      let seed = new Fabric.Vector(genesis['@data']);

      assert.equal(genesis['@id'], samples.names.fabric);
      assert.equal(seed['@id'], samples.names.fabric);
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

    it('can store and retrieve a blob', async function datastore () {
      let fabric = new Fabric({
        path: './data/test'
      });

      await fabric.start();

      let set = await fabric._SET('assets/test', message['@data']);
      let get = await fabric._GET('assets/test');

      await fabric.stop();

      let samples = {
        set: new Fabric.State(set),
        // put: new Fabric.State(put),
        get: new Fabric.State(get)
      };

      assert.equal(get, message['@data']);
      assert.equal(set, message['@data']);
      assert.equal(samples.get['@id'], message['@id']);
      assert.equal(samples.get.id, message['@id']);
    });

    xit('can store and retrieve an object', async function datastore () {
      let fabric = new Fabric();

      await fabric.start();

      let put = await fabric._SET('/assets/genesis', genesis);
      let get = await fabric._GET('/assets/genesis');

      await fabric.stop();

      assert.equal(put, put);
      assert.equal(typeof get, typeof message['@data']);
      assert.equal(fabric.state.assets.genesis.id, put['@id']);
    });
  });

  describe('Block', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Block instanceof Function, true);
    });
  });

  describe('Chain', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Chain instanceof Function, true);
    });

    it('can cleanly start and stop a chain', async function () {
      let chain = new Fabric.Chain();

      await chain.start();
      await chain.stop();

      assert.ok(chain);
      assert.ok(chain.ledger);
    });

    it('can append an arbitrary message', async function () {
      let chain = new Fabric.Chain();

      await chain.start();
      await chain.append({ debug: true, input: 'Hello, world.' });
      await chain.stop();

      assert.ok(chain);
      assert.ok(chain.ledger);
    });

    it('generates a merkle tree with the expected proof of inclusion', async function () {
      let chain = new Fabric.Chain();

      await chain.start();
      await chain.append({ debug: true, input: 'Hello, world.' });
      await chain.append({ debug: true, input: 'Why trust?  Verify.' });
      await chain.stop();

      let sample = chain.blocks.map(b => Buffer.from(b['@id'], 'hex'));
      let tree = chain['@tree'];
      let root = tree.getRoot();

      let proofs = {
        genesis: tree.getProof(sample[0], 0),
        'blocks/1': tree.getProof(sample[1], 1),
        'blocks/2': tree.getProof(sample[2], 2)
      };

      let verifiers = {
        genesis: tree.verify(proofs.genesis, sample[0], root),
        'blocks/1': tree.verify(proofs['blocks/1'], sample[1], root),
        'blocks/2': tree.verify(proofs['blocks/2'], sample[2], root),
        invalid: tree.verify(proofs['genesis'], Buffer.alloc(32), root)
      };

      assert.ok(chain);
      assert.equal(sample.length, 3);
      assert.equal(sample[0].toString('hex'), 'c1b294376d6d30d85a81cff9244e7b447a02e6307a047c4a53643a945022e505');
      assert.equal(sample[1].toString('hex'), '67822dac02f2c1ae1e202d8e75437eaede631861e60340b2fbb258cdb75780f3');
      assert.equal(sample[2].toString('hex'), 'a59402c14784e1be43b1adfc7832fa8c402dddf1ede7f7c29549d499b112444f');
      assert.equal(verifiers.genesis, true);
      assert.equal(verifiers['blocks/1'], true);
      assert.equal(verifiers['blocks/2'], true);
      assert.equal(verifiers.invalid, false);
    });
  });

  describe('Disk', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Disk instanceof Function, true);
    });
  });

  describe('Key', function () {
    it('is available from @fabric/core', function () {
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

  describe('Ledger', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Ledger instanceof Function, true);
    });

    it('can cleanly start and stop', async function () {
      let ledger = new Fabric.Ledger();

      await ledger.start();
      await ledger.stop();

      assert.ok(ledger);
    });

    it('can append an arbitrary message', async function () {
      let ledger = new Fabric.Ledger();

      await ledger.start();
      await ledger.append({ debug: true, input: 'Hello, world.' });
      await ledger.stop();

      assert.ok(ledger);
    });

    it('can append multiple arbitrary messages', async function () {
      let ledger = new Fabric.Ledger();
      let one = new Fabric.Vector({ debug: true, input: 'Hello, world.' });
      let two = new Fabric.Vector({ debug: true, input: 'Why trust?  Verify.' });

      await ledger.start();
      await ledger.append(one['@data']);
      await ledger.append(two['@data']);
      await ledger.stop();

      assert.ok(ledger);
      assert.equal(one.id, '67822dac02f2c1ae1e202d8e75437eaede631861e60340b2fbb258cdb75780f3');
      assert.equal(two.id, 'a59402c14784e1be43b1adfc7832fa8c402dddf1ede7f7c29549d499b112444f');
      assert.equal(ledger['@data'].length, 3);
      assert.equal(ledger['@data'][0].toString('hex'), '56083f882297623cde433a434db998b99ff47256abd69c3f58f8ce8ef7583ca3');
      assert.equal(ledger['@data'][1].toString('hex'), one.id);
      assert.equal(ledger['@data'][2].toString('hex'), two.id);
      assert.equal(ledger.id, '1ae312d8c3700df0bb22371eb8f0e9feb290a0d50b12d8e7dc2c54964aa05303');
    });

    xit('can replicate state', function (done) {
      async function main () {
        let anchor = new Fabric.Ledger();
        let sample = new Fabric.Ledger();

        let one = new Fabric.Vector({ debug: true, input: 'Hello, world.' });
        let two = new Fabric.Vector({ debug: true, input: 'Why trust?  Verify.' });

        sample.trust(anchor);

        anchor.on('changes', function (changes) {
          console.log('changes:', changes);
          done();
        });

        await anchor.start();
        await anchor.append(one['@data']);
        await anchor.append(two['@data']);
        await anchor.stop();

        assert.ok(anchor);
        assert.equal(one.id, '67822dac02f2c1ae1e202d8e75437eaede631861e60340b2fbb258cdb75780f3');
        assert.equal(two.id, 'a59402c14784e1be43b1adfc7832fa8c402dddf1ede7f7c29549d499b112444f');
        assert.equal(anchor['@data'].length, 3);
        assert.equal(anchor['@data'][0].toString('hex'), '56083f882297623cde433a434db998b99ff47256abd69c3f58f8ce8ef7583ca3');
        assert.equal(anchor['@data'][1].toString('hex'), one.id);
        assert.equal(anchor['@data'][2].toString('hex'), two.id);
        assert.equal(anchor.id, '1ae312d8c3700df0bb22371eb8f0e9feb290a0d50b12d8e7dc2c54964aa05303');
      }

      main();
    });
  });

  describe('Machine', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Machine instanceof Function, true);
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

    it('can correctly sum two values', async function prove () {
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

    it('can correctly sum three values', async function prove () {
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
  });

  describe('Oracle', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Oracle instanceof Function, true);
    });
  });

  describe('Resource', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Resource instanceof Function, true);
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

  describe('Scribe', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Scribe instanceof Function, true);
    });
  });

  describe('Script', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Script instanceof Function, true);
    });
  });

  describe('Stack', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Stack instanceof Function, true);
    });

    it('can instantiate from a serialized state', function () {
      // TODO: migrate to Stack
      let stack = Fabric.Vector.fromObjectString('{ "0": { "type": "Buffer", "data": [0, 0, 0, 0 ] } }');
      assert.equal(stack instanceof Array, true);
      assert.equal(stack[0] instanceof Buffer, true);
      assert.equal(stack[0].toString('hex'), '00000000');
      assert.ok(stack);
    });

    it('can push an element onto the stack', function () {
      let stack = new Fabric.Stack();

      let one = stack.push('foo');
      let two = stack.push('bar');

      assert.equal(one, 1);
      assert.equal(two, 2);
      assert.equal(stack['@data'][0].toString('hex'), samples.output.foo);
      assert.equal(stack['@data'][1].toString('hex'), samples.output.bar);
    });

    xit('mimics JavaScript semantics', function () {
      let stack = new Fabric.Stack();

      stack.push('foo');
      stack.push('bar');

      let last = stack.pop();

      assert.equal(last, 'bar');
    });
  });

  describe('State', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.State instanceof Function, true);
    });

    it('provides an accurate "@id" attribute', function () {
      let state = new Fabric.State(message['@data']);

      assert.ok(state);
      assert.equal(state.id, message['@id']);
    });
  });

  describe('Store', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Store instanceof Function, true);
    });

    xit('can set a key to a string value', async function () {
      let store = new Fabric.Store();
      let set = await store.set('example', samples.input.hello);
      assert.ok(store);
    });
  });

  describe('Transaction', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Transaction instanceof Function, true);
    });
  });

  describe('Vector', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Vector instanceof Function, true);
    });

    it('can restore from garbage', async function () {
      let vector = Fabric.Vector.fromObjectString('{ "0": { "type": "Buffer", "data": [0, 0, 0, 0 ] } }');
      assert.equal(vector instanceof Array, true);
      assert.equal(vector[0] instanceof Buffer, true);
      assert.equal(vector[0].toString('hex'), '00000000');
      assert.ok(vector);
    });
  });

  describe('Worker', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Worker instanceof Function, true);
    });
  });
});
