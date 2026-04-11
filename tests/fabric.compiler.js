'use strict';

const Compiler = require('../types/compiler');
const Hash256 = require('../types/hash256');
const assert = require('assert');
const fs = require('fs');

describe('@fabric/core/types/compiler', function () {
  describe('Compiler', function () {
    it('is available from @fabric/core', function () {
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
      assert.ok(compiler.integrity.startsWith('sha256-'));
      assert.strictEqual(typeof hash, 'string');
      assert.strictEqual(hash.length, 64);
    });

    it('validates static constructors require Buffer input', function () {
      assert.throws(() => Compiler._fromJavaScript('not-buffer'), /buffer/i);
      assert.throws(() => Compiler._fromMinsc('not-buffer'), /buffer/i);
      assert.throws(() => Compiler._fromSolidity('not-buffer'), /buffer/i);
    });

    it('_getScriptAST throws as unsupported', function () {
      const compiler = new Compiler();
      assert.throws(() => compiler._getScriptAST(Buffer.from('x')), /Not yet supported/);
    });

    it('_getJavaScriptAST accepts string input', function () {
      const compiler = new Compiler();
      const ast = compiler._getJavaScriptAST('const x = 1;');
      assert.ok(ast);
      assert.strictEqual(ast['@type'], 'AST');
      assert.strictEqual(ast['@language'], 'JavaScript');
      assert.ok(ast.interpreters.WebAssembly);
    });

    it('_getMinscAST returns expected wrapper', function () {
      const compiler = new Compiler();
      const ast = compiler._getMinscAST('1');
      assert.strictEqual(ast['@type'], 'AST');
      assert.strictEqual(ast['@language'], 'Minsc');
      assert.ok(Object.prototype.hasOwnProperty.call(ast.interpreters, 'Minsc'));
    });

    it('render() prefers terminal path when screen is set', function () {
      const compiler = new Compiler({ body: Buffer.from('abc', 'utf8') });
      compiler.screen = {};
      compiler._renderToTerminal = () => 'terminal-output';
      assert.strictEqual(compiler.render(), 'terminal-output');
    });
  });
});
