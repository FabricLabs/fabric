'use strict';

const fs = require('fs');
const path = require('path');

const { blessedParamsFromJadeAttrs } = require('../functions/wireJson');

const lex = require('pug-lexer');
const parse = require('pug-parser');

const blessed = require('blessed');

class Renderer {
  constructor (_settings = {}) {
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
      if (ast.name === 'script') return result;

      const space = ' '.repeat(depth * 2);
      const id = jadeAttr(ast, 'id');
      let widgetName = ast.name;
      if (widgetName === 'grid') widgetName = 'box';
      if (id === 'peers' || id === 'logs') widgetName = 'list';
      if (widgetName === 'screen') {
        if (ast.block) result += this.render(ast.block, screen, ui, eventHandlers, depth + 1);
        return result;
      }

      const { attrs, params } = blessedParamsFromJadeAttrs(ast.attrs);

      params.parent = screen;

      if (screen && typeof blessed[widgetName] === 'function') {
        let element = blessed[widgetName](params);
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

  _describeTemplate (filename) {
    const file = filename || path.join(__dirname, '../assets/cli.jade');
    return this._describeSource(fs.readFileSync(file, 'utf8'), file);
  }

  _describeSource (src, filename) {
    const name = filename || 'inline.jade';
    const tokens = lex(src, { filename: name });
    const ast = parse(tokens, { filename: name, src: src });
    const widgets = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === 'Block') {
        (node.nodes || []).forEach(walk);
        return;
      }
      if (node.type !== 'Tag') return;
      if (node.name === 'script') return;
      const id = jadeAttr(node, 'id');
      widgets.push({
        tag: node.name,
        id: id,
        widget: widgetFor(node.name, id)
      });
      if (node.block) walk(node.block);
    };
    walk(ast);
    return widgets;
  }

  _fromPath (filename) {
    let src = fs.readFileSync(filename, 'utf8');
    let tokens = lex(src);
    let ast = parse(tokens, { filename, src });
    let html = this.render(ast);
    return html;
  }

  _renderJadeFile (filename, ui, eventHandlers) {
    const file = filename || path.join(__dirname, '../assets/cli.jade');
    let src = fs.readFileSync(file, 'utf8');
    console.log('src:', src);

    let tokens = lex(src, { filename: file });
    console.log('tokens:', tokens);

    let ast = parse(tokens, { filename: file, src: src });
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
    screen.key(['escape'], function (_ch, _key) {
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

function jadeAttr (node, name) {
  const attrs = node && node.attrs;
  if (!attrs) return '';
  for (const attr of attrs) {
    if (!attr || attr.name !== name) continue;
    return String(attr.val || '').replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function widgetFor (tag, id) {
  if (id === 'peers' || id === 'logs') return 'list';
  if (tag === 'screen') return 'screen';
  if (tag === 'grid') return 'box';
  if (tag === 'textbox' || tag === 'button' || tag === 'form' || tag === 'list' || tag === 'box') return tag;
  return 'box';
}

module.exports = Renderer;
