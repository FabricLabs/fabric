'use strict';

// Dependencies
const fs = require('fs');
const { readFile } = require('fs').promises;

// TODO: rewrite these / use lexical parser
// const lex = require('jade-lexer');
// const parse = require('jade-parser');
const { run } = require('minsc');

// JavaScript & TypeScript ASTs
const AST = require('@webassemblyjs/ast');
const {
  Project,
  ScriptTarget
} = require('ts-morph');

// Fabric Types
const Entity = require('./entity');
const Machine = require('./machine');
const Ethereum = require('../services/ethereum');

// TODO: have Lexer review
// TODO: render the following:
// ```purity
// fabric-application
//   fabric-grid
//     fabric-row
//       h1 Hello, world.
//     fabric-row
//       fabric-column
//         fabric-row
//           fabric-message-list
//         fabric-row
//           fabric-message-forge
//       fabric-column
//         fabric-peers
// ```
// This is an example of a self-contained document.  You can add assertions as
// follows:
// ```
// method(check="integrity")
// ```
// This will auto-configure validation base from chain of greatest work.

/**
 * Compilers build interfaces for users of Fabric applications.
 * @type {Actor}
 * @property {AST} ast Compiler's current AST.
 * @property {Entity} entity Compiler's current {@link Entity}.
 */
class Compiler {
  /**
   * Create a new Compiler.
   * @param  {Object} settings={} Configuration.
   * @param  {Buffer} settings.body Body of the input program to compile.
   * @return {Compiler}             Instance of the compiler.
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      ast: null,
      body: null,
      inputs: [],
      outputs: []
    }, settings);

    this.entity = new Entity(this.settings);
    this.machine = new Machine(this.settings);
    this.project = new Project({
      compilerOptions: {
        target: ScriptTarget.ES2020
      }
    });

    this.ast = null;
    this.screen = null;

    this.entities = {};
    this.abstracts = {};

    return this;
  }

  /**
   * Creates a new Compiler instance from a JavaScript contract.
   * @param {Buffer} body Content of the JavaScript to evaluate.
   * @returns Compiler
   */
  static _fromJavaScript (body) {
    if (!(body instanceof Buffer)) throw new Error('JavaScript must be passed as a buffer.');
    return new Compiler({ body, ast });
  }

  static _fromMiniscript (body) {
    if (!(body instanceof Buffer)) throw new Error('JavaScript must be passed as a buffer.');
    const ast = this._getMinscAST(body);
    return new Compiler({ body, ast });
  }

  static _fromSolidity (body) {
    if (!(body instanceof Buffer)) throw new Error('JavaScript must be passed as a buffer.');
    const ast = this._getSolidityAST(body);
    return new Compiler({ body, ast });
  }

  async start () {
    const promises = this.settings.inputs.map(x => readFile(x));
    const contents = await Promise.all(promises);
    const entities = contents.map(x => new Entity(x));
    const abstracts = contents.map(x => this._getJavaScriptAST(x));

    // Assign Body
    const entity = new Entity(this.settings.body);
    const abstract = this._getJavaScriptAST(this.settings.body);

    this.entities[entity.id] = entity;
    this.abstracts[entity.id] = abstract;

    // Assign all Entities, Abstracts
    for (let i = 0; i < entities.length; i++) {
      this.entities[entities[i].id] = entities[i];
      this.abstracts[entities[i].id] = abstracts[i];
    }
  }

  _getScriptAST (input) {
    throw new Error('Not yet supported.');
    return null;
  }

  _getJavaScriptAST (input) {
    const ast = AST.program(input);
    return {
      '@type': 'AST',
      input: input,
      interpreters: {
        'WebAssembly': ast
      }
    };
  }

  _getMinscAST (input) {
    const output = run(input);
    return output;
  }

  _getSolidityAST (input) {
    const ethereum = new Ethereum();
    const result = ethereum.execute(body);
    return result;
  }

  _fromPath (filename) {
    let src = fs.readFileSync(filename, 'utf8');
    let tokens = lex(src);
    let ast = parse(tokens, { filename, src });
    let html = this.render(ast);
    return html;
  }

  render () {
    if (this.screen) {
      return this._renderToTerminal();
    } else {
      return this._renderToHTML();
    }
  }

  // TODO: @melnx to refactor into f(x) => y
  _renderToTerminal (ast, screen, ui, eventHandlers, depth = 0) {
    let result = '';

    if (ast.type === 'Block') {
      for (let n in ast.nodes) {
        result += this.render(ast.nodes[n], screen, ui, eventHandlers, depth);
      }
    } else if (ast.type === 'Tag') {
      // /////////////////////////////////////
      let space = ' '.repeat(depth * 2);
      // result += depth;

      let attrs = [];
      let params = {};
      for (let a in ast.attrs) {
        let attr = ast.attrs[a];
        attrs.push(attr.name + '=' + attr.val);

        if (attr.val[0] === "'") {
          let content = attr.val.substring(1, attr.val.length - 1);
          if (content[0] === '{') {
            params[attr.name] = JSON.parse(content);
          } else {
            params[attr.name] = content;
          }
        } else {
          params[attr.name] = JSON.parse(attr.val);
        }
      }

      params.parent = screen;

      if (screen) {
        let element = blessed[ast.name](params);
        for (let p in params) {
          if (p.startsWith('on')) {
            let handler = eventHandlers[ params[p] ];
            if (p.startsWith('onkey')) {
              let key = p.substr(5);
              element.key([key], handler);
            } else {
              element.on(p.substr(2), handler);
            }
          }
        }
        if (params.id) ui[params.id] = element;
      }

      var attrsStr = attrs.join(' ');
      if (attrsStr) attrsStr = ' ' + attrsStr;

      if (ast.selfClosing) {
        result += space + '<' + ast.name + attrsStr + '/>\n';
      } else {
        result += space + '<' + ast.name + attrsStr + '>\n';
        if (ast.block) result += this.render(ast.block, screen, ui, eventHandlers, depth + 1);
        result += space + '</' + ast.name + '>\n';
      }
    }

    return result;
  }

  _renderToHTML (state = {}) {

  }
}

module.exports = Compiler;
