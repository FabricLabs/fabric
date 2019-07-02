'use strict';

const fs = require('fs');

const lex = require('jade-lexer');
const parse = require('jade-parser');

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
 * @type {Object}
 */
class Compiler {
  /**
   * Create a new Compiler.
   * @param  {Object} [settings={}] Configuration.
   * @return {Compiler}               Instance of the compiler.
   */
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    return this;
  }

  _fromPath (filename) {
    let src = fs.readFileSync(filename, 'utf8');
    let tokens = lex(src);
    let ast = parse(tokens, { filename, src });
    let html = this.render(ast);
    return html;
  }

  render (ast, screen, ui, eventHandlers, depth = 0) {
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
}

module.exports = Compiler;
