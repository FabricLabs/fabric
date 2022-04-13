'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/ledger', function () {
  describe('Ledger', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Ledger instanceof Function, true);
    });

    it('can cleanly start and stop', async function () {
      const ledger = new Fabric.Ledger();

      await ledger.start();
      await ledger.stop();

      assert.ok(ledger);
    });

    xit('can append an arbitrary message', async function () {
      const ledger = new Fabric.Ledger();

      await ledger.start();
      await ledger.append({ debug: true, input: 'Hello, world.' });
      await ledger.stop();

      assert.ok(ledger);
    });

    xit('can append multiple arbitrary messages', async function () {
      const ledger = new Fabric.Ledger();
      const one = new Fabric.Vector({ debug: true, input: 'Hello, world.' });
      const two = new Fabric.Vector({ debug: true, input: 'Why trust?  Verify.' });

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
      assert.equal(ledger.id, 'af6b5824247f57e335ae807ee16e4ed157ee270fe20b780507418a885b636e1d');
    });

    xit('can replicate state', async function () {
      const anchor = new Fabric.Ledger();
      const sample = new Fabric.Ledger({ path: './stores/tests' });

      const one = new Fabric.Vector({ debug: true, input: 'Hello, world.' });
      const two = new Fabric.Vector({ debug: true, input: 'Why trust?  Verify.' });

      sample.trust(anchor);

      anchor.on('changes', function (changes) {
        console.log('changes:', changes);
      });

      await anchor.start();
      await sample.start();
      await anchor.append(one['@data']);
      await anchor.append(two['@data']);
      await sample.stop();
      await anchor.stop();

      console.log('[TEST]', '[CORE:LEDGER]', 'resulting anchor id:', anchor['@id']);
      console.log('anchor.id:', anchor.id);
      console.log('anchor.pages:', anchor.pages);
      console.log('anchor[@data]:', anchor['@data']);

      assert.ok(anchor);
      assert.equal(one.id, '67822dac02f2c1ae1e202d8e75437eaede631861e60340b2fbb258cdb75780f3');
      assert.equal(two.id, 'a59402c14784e1be43b1adfc7832fa8c402dddf1ede7f7c29549d499b112444f');
      assert.equal(anchor['@data'].length, 3);
      assert.equal(anchor['@data'][0].toString('hex'), '56083f882297623cde433a434db998b99ff47256abd69c3f58f8ce8ef7583ca3');
      assert.equal(anchor['@data'][1].toString('hex'), one.id);
      assert.equal(anchor['@data'][2].toString('hex'), two.id);
      assert.equal(anchor.id, 'af6b5824247f57e335ae807ee16e4ed157ee270fe20b780507418a885b636e1d');
      assert.equal(sample['@data'].length, 3);
      assert.equal(sample['@data'][0].toString('hex'), '56083f882297623cde433a434db998b99ff47256abd69c3f58f8ce8ef7583ca3');
      assert.equal(sample['@data'][1].toString('hex'), one.id);
      assert.equal(sample['@data'][2].toString('hex'), two.id);
      assert.equal(sample.id, 'af6b5824247f57e335ae807ee16e4ed157ee270fe20b780507418a885b636e1d');
    });
  });
});
