'use strict';

const Compiler = require('../types/compiler');
const assert = require('assert');
const fs = require('fs');

describe('@fabric/core/types/compiler', function () {
  describe('Compiler', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Compiler instanceof Function, true);
    });

    it('can smoothly create a new compiler', function () {
      let compiler = new Compiler();
      assert.ok(compiler);
    });

    it('can start a newly-created compiler', async function () {
      let compiler = new Compiler();
      await compiler.start();
      assert.ok(compiler);
    });

    it('can start a newly-created compiler with provided inputs', async function () {
      let compiler = new Compiler({
        inputs: [
          './contracts/node.js'
        ]
      });

      await compiler.start();
      assert.ok(compiler);
    });

    it('can read a JavaScript contract', function () {
      const body = fs.readFileSync(`./contracts/node.js`);
      let compiler = Compiler._fromJavaScript(body);
      console.log('compiler:', compiler);
      assert.ok(compiler);
    });
  });
});
