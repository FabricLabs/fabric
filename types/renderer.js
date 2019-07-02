'use strict';

const fs = require('fs');

const lex = require('jade-lexer');
const parse = require('jade-parser');

const blessed = require('blessed');

class Renderer {
  constructor (settings = {}) {
    this.screen = null;
    return this;
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

  _fromPath (filename) {
    let src = fs.readFileSync(filename, 'utf8');
    let tokens = lex(src);
    let ast = parse(tokens, { filename, src });
    let html = this.render(ast);
    return html;
  }

  _renderJadeFile (filename, ui, eventHandlers) {
    let src = fs.readFileSync(filename, 'utf8');
    console.log('src:', src);

    let tokens = lex(src);
    console.log('tokens:', tokens);

    let ast = parse(tokens, {filename, src});
    console.log('ast:', JSON.stringify(ast, null, '  '));

    let html = this.render(ast);
    console.log('html:', html);

    let screen = blessed.screen();

    this._toCLI(ast, screen, ui, eventHandlers);

    screen.render();
  }

  _toCLI (ast, screen, ui, eventHandlers) {
    // let self = this;
    // self.screen = screen;
    ui.screen = screen;

    this.render(ast, screen, ui, eventHandlers);

    // TODO: move this to dynamic event handler
    screen.key(['escape'], function (ch, key) {
      screen.destroy();
      // console.log('the machine:', self.oracle.machine);
      // console.log('the mempool:', self.oracle.mempool);
      process.exit();
    });

    // return;

    /* self.screen.key(['escape'], eventHandlers.on_screen_key_esc);

    self.controls = blessed.box({
        parent: self.screen,
        border: {
            type: 'line'
        },
        bottom: 0,
        height: 3
    });

    self.form = blessed.form({
        parent: self.screen,
        keys: true
    });

    self.textbox = blessed.textbox({
        parent: self.form,
        name: 'input',
        input: true,
        inputOnFocus: true,
        focused: true,
        value: '',
        bottom: 1,
        mouse: true,
        height: 3,
        width: '100%',
        border: {
            type: 'line'
        },
        keys: true
    });

    self.submit = blessed.button({
        parent: self.form,
        mouse: true,
        // keys: true,
        shrink: true,
        bottom: 0,
        right: 0,
        name: 'submit',
        content: '[ENTER] Send',
        style: {
            bg: 'blue'
        },
        padding: {
            left: 1,
            right: 1
        }
    });

    self.instructions = blessed.box({
        parent: self.screen,
        content: '[ESCAPE (2x)] exit]',
        bottom: 0,
        height: 1,
        width: '100%-20',
        padding: {
            left: 1,
            right: 1
        }
    });

    self.history = blessed.box({
        parent: self.screen,
        label: '[ History ]',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        height: '100%-16',
        width: '80%',
        bottom: 16,
        border: {
            type: 'line'
        }
    });

    self.peerlist = blessed.list({
        parent: self.screen,
        label: '[ Peers ]',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        top: 0,
        left: '80%+1',
        bottom: 4,
        right: 0,
        border: {
            type: 'line'
        },
        scrollbar: {}
    });

    self.logs = blessed.list({
        parent: self.screen,
        label: '[ Logs ]',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        height: 12,
        width: '80%',
        bottom: 4,
        border: {
            type: 'line'
        },
        scrollbar: {}
    });

    self.textbox.key(['enter'], eventHandlers.on_textbox_key_enter);
    self.textbox.key(['up'], eventHandlers.on_textbox_key_up);
    self.submit.on('press', eventHandlers.on_submit_press);
    self.form.on('submit', eventHandlers.on_form_submit); */
  }
}

module.exports = Renderer;
