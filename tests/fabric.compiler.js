'use strict';

const Compiler = require('../types/compiler');
const Hash256 = require('../types/hash256');
const assert = require('assert');
const fs = require('fs');

describe('@fabric/core/types/compiler', function () {
  describe('Compiler', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Compiler instanceof Function, true);
    });

    it('can smoothly create a new compiler', function () {
      const compiler = new Compiler();
      assert.ok(compiler);
    });

    it('can start a newly-created compiler', async function () {
      const compiler = new Compiler();
      await compiler.start();
      assert.ok(compiler);
    });

    it('can start a newly-created compiler with provided inputs', async function () {
      const compiler = new Compiler({
        inputs: [
          './contracts/node.js'
        ]
      });

      await compiler.start();
      assert.ok(compiler);
    });

    it('can read a JavaScript contract', function () {
      const body = fs.readFileSync(`./contracts/node.js`);
      const compiler = Compiler._fromJavaScript(body);
      assert.ok(compiler);
    });

    it('can compile a JavaScript contract', async function () {
      const body = fs.readFileSync(`./contracts/node.js`);
      const compiler = Compiler._fromJavaScript(body);
      await compiler.start();
      assert.ok(compiler);
    });

    it('can compile to HTML', async function () {
      const body = fs.readFileSync(`./contracts/node.js`);
      const compiler = Compiler._fromJavaScript(body);
      await compiler.start();
      const html = compiler._renderToHTML();
      const hash = Hash256.digest(html);
      assert.ok(compiler);
      assert.strictEqual(compiler.integrity, 'sha256-e4720ec234b4673cff23bd97dec51c6c5511f711942bb502617235e0797d3680');
      assert.strictEqual(hash, '280f20541e198b61bd52760338d71072b6f1968921587e171a5c0fab83227c4d');
    });
  });
});
