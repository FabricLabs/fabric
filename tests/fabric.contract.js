'use strict';

const assert = require('assert');
const Contract = require('../types/contract');
const Key = require('../types/key');
const { FIXTURE_XPRV } = require('../constants');

const sample = {
  key: new Key({
    xprv: FIXTURE_XPRV
  })
};

describe('@fabric/core/types/contract', function () {
  describe('Contract', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Contract instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const contract = new Contract(sample);
        assert.ok(contract);
        done();
      }

      test();
    });

    it('can start and stop', function (done) {
      async function test () {
        const contract = new Contract(sample);
        contract.start();
        contract.stop();
        assert.ok(contract);
        done();
      }

      test();
    });

    it('can publish a contract', function (done) {
      const timeout = setTimeout(() => {
        done(new Error('Timeout waiting for contract publish'));
      }, 5000);

      async function test () {
        const contract = new Contract({
          ...sample,
          key: new Key({
            xprv: FIXTURE_XPRV
          })
        });

        contract.on('error', (err) => {
          clearTimeout(timeout);
          done(err);
        });

        contract.on('message', (msg) => {
          switch (msg['@type']) {
            default:
            case 'CONTRACT_PUBLISH':
              clearTimeout(timeout);
              assert.ok(contract);
              assert.ok(msg);
              done();
              break;
          }
        });

        try {
          await contract.deploy();
        } catch (err) {
          clearTimeout(timeout);
          done(err);
        }
      }

      test();
    });

    it('emits committed changes even when the diff is too large for one message', function () {
      const contract = new Contract(sample);
      const seen = { changes: null, messages: 0, warnings: [] };
      contract.on('changes', (changes) => { seen.changes = changes; });
      contract.on('message', () => { seen.messages++; });
      contract.on('warning', (w) => { seen.warnings.push(w); });
      contract._state.content.blob = 'x'.repeat(64 * 1024);
      contract.commit();
      assert.ok(seen.changes && seen.changes.length, 'listeners got the changes');
      assert.strictEqual(seen.messages, 0);
      assert.strictEqual(seen.warnings.length, 1);
      assert.match(seen.warnings[0], /commit message not built/);
    });
  });
});
