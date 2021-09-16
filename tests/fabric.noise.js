'use strict';

const NOISE = require('../types/noise');
const assert = require('assert');

describe('@fabric/core/types/noise', function () {
  describe('NOISE', function () {
    xit('is available from @fabric/core', function () {
      assert.strictEqual(NOISE instanceof Function, true);
    });

    it('can smoothly create a new NOISE session', function (done) {
      async function test () {
        const noise = new NOISE();

        noise.on('log', function (msg) {
          console.log(msg);
        });

        noise.on('warning', function (msg) {
          console.warning(msg);
        });

        noise.on('error', function (msg) {
          console.error(msg);
        });

        noise.on('ready', async function () {
          await noise.connect('tcp://localhost:9735');
          assert.strictEqual(noise.id, 'b9d8bce32d234014b3f45b37ee432b445fbdad036487ced2b5926b14aaa41683');
          done();
        });

        await noise.start();
      }

      test();
    });
  });
});
