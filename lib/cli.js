'use strict';

import Fabric from '../';

const util = require('util');
const jade = require('jade');
const parse = require('xml2js').parseString;
const blessed = require('blessed');
const contrib = require('blessed-contrib');

//const Fabric = require('../');
const Viewer = require('wopr');

const MAX_ACTOR_LENGTH = 35;

/**
 * Base class for a terminal-like interface to the Fabric network.
 * @param       {Object} configuration Configuration object for the CLI.
 * @constructor
 * @property storage {Storage} - Instance of {@link Storage}.
 */
function CLI (init) {
  this['@data'] = init || {};

  this.config = Object.assign({
    oracle: true,
    ui: './assets/cli.jade'
  }, init);

  if (this.config.oracle) {
    this.oracle = new Fabric.HTTP(Object.assign({
      name: 'fabric',
      port: 3007
    }, this.config.oracle));

    this.oracle.on('changes', this.handler.bind(this));
    this.oracle.on('info', this.inform.bind(this));
  }

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.init();
}

// all user interfaces begin with a "Vector"
util.inherits(CLI, require('../lib/vector'));

CLI.prototype._createInstance = function () {
  let self = this;

  self.screen = blessed.screen({
    smartCSR: true,
    dockBorders: true
  });

  self.screen.key(['escape'], function (ch, key) {
    self.screen.destroy();
    // console.log('the machine:', self.oracle.machine);
    // console.log('the mempool:', self.oracle.mempool);
    process.exit();
  });
};

CLI.prototype._assembleInterface = function () {
  let self = this;

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
    },
    scrollbar: {}
  });

  self.peerlist = blessed.box({
    parent: self.screen,
    label: '[ Peers ]',
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    left: '80%+1',
    bottom: 4,
    border: {
      type: 'line'
    },
    scrollbar: {}
  });

  self.logs = blessed.box({
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

  self.textbox.key(['enter'], function (ch, key) {
    self.form.submit();
    self.textbox.clearValue();
    self.textbox.readInput();
  });

  self.submit.on('press', function () {
    self.form.submit();
  });

  self.form.on('submit', async function (data) {
    let now = new Date();

    // TODO: visual indicator of "sending..." status
    let result = await self.oracle._POST('/messages', {
      created: now.toISOString(),
      input: data.input
    });

    self.form.reset();
    self.screen.render();
  });
};

// TODO: move to Fabric#Chat
CLI.prototype._handleConnection = function (connection) {
  let self = this;
  let instance = Object.assign({
    created: new Date(),
    input: JSON.stringify(connection)
  });

  self.peerlist.pushLine(`${instance.input}`);
  self.peerlist.setScrollPerc(100);

  self.screen.render();
};

// TODO: move to Fabric#Chat
CLI.prototype._handlePeerMessage = function (message) {
  let self = this;
  let instance = Object.assign({
    created: new Date(),
    input: JSON.stringify(message)
  });

  self.peerlist.pushLine(`${instance.input}`);
  self.peerlist.setScrollPerc(100);

  self.screen.render();
};

// TODO: move to Fabric#Chat
CLI.prototype._handlePartMessage = function (message) {
  let self = this;
  let instance = Object.assign({
    address: message,
    status: 'disconnected'
  });

  self.peerlist.pushLine(`${JSON.stringify(instance)}`);
  self.peerlist.setScrollPerc(100);

  self.screen.render();
};

// TODO: move to Fabric#Chat
CLI.prototype._appendMessage = function (message) {
  let self = this;
  let instance = Object.assign({
    created: new Date(),
    input: message.input
  }, { created: message.created }, {});

  self.history.pushLine(`${instance.created}${(instance.actor) ? ' ' + instance.actor : ''}: ${instance.input}`);
  self.history.setScrollPerc(100);

  self.screen.render();
};

// TODO: move to Fabric#Chat
CLI.prototype._appendLogMessage = function (message) {
  let self = this;
  let instance = Object.assign({
    created: new Date(),
    input: JSON.stringify(message)
  });

  self.logs.pushLine(`${instance.created}: ${instance.input}`);
  self.logs.setScrollPerc(100);

  self.screen.render();
};

CLI.prototype.inform = function (msg) {
  this._appendLogMessage(msg);
};

CLI.prototype.handler = function (msg) {
  let self = this;

  // console.log('[CLI]', 'received change event from oracle:', msg);
  // console.log('[CLI]', 'state is currently:', this.oracle.machine.state);

  for (let i = 0; i < msg.length; i++) {
    let instruction = msg[i];
    // TODO: receive events from collection
    // we should (probably) use Proxy() for this
    switch (instruction.path.split('/')[1]) {
      // TODO: fix Machine bug; only one delta should be emitted;
      case 'messages':
        // TODO: eliminate need for this check
        // on startup, the Oracle emits a `changes` event with a full state
        // snapshot... this might be useful overall, but the CLI (Chat) should
        // either rely on this exclusively or not at all
        if (self.history) {
          self._appendMessage(instruction.value);
        }
        break;
      case 'peers':
        console.log('received unhandled peer notification:', instruction);
        break;
    }
  }
};

CLI.prototype.start = async function () {
  let self = this;

  await self.oracle.start();

  self._createInstance();
  self._assembleInterface();

  self.screen.render();

  // TODO: use a status UI
  let start = new Date();
  self._appendLogMessage({
    actor: '[FABRIC]',
    created: start.toISOString(),
    input: 'Loading from history...'
  });

  // TODO: use method to only retrieve latest
  let logs = await self.oracle._GET('/messages') || [];

  logs.sort(function (a, b) {
    return new Date(a.created) - new Date(b.created);
  });

  for (let i in logs) {
    self._appendMessage(logs[i]);
  }

  let finish = new Date();
  self._appendLogMessage({
    actor: '[FABRIC]',
    created: finish.toISOString(),
    input: `Historical context loaded in ${finish - start}ms.  Welcome!`
  });

  // self.oracle.subscribe('/');

  // self.form.focus();
  self.textbox.readInput();
};

CLI.prototype.stop = async function () {
  this.screen.destroy();
  if (this.config.oracle) {
    await this.oracle.stop();
  }
  this.emit('stopped');
};

// TODO: read specific Jade template, compose Blessed interface
// from standardized elements (should match element names in Maki)
CLI.prototype.render = function (done) {
  const self = this;
  const render = jade.compileFile(this['@data'].ui);
  const xml = render(this['@data']);

  parse(xml, function (err, doc) {
    if (err) return console.error(err);
    //if (!doc || !doc.document) return console.error('Invalid UI definition.');

    console.debug('doc:', doc);

    self.screen = blessed.screen();
    self.viewer = new Viewer(doc, self.screen);

    self.screen.key(['q', 'escape'], function(ch, key) {
      process.exit()
    });

    for (var i in doc) {
      var item = doc[i];
      var name = Object.keys(item)[1];
      var element = contrib[i] || blessed[i];
      
      console.debug('loop:', item, name, element, opts);
      
      if (!element) throw new Error('Unexpected interface element: ' + name);
      
      var opts = self.viewer.readOptions(item, element);


      self.screen.append(element);
    }

    self.screen.render();
    //self.viewer.render();

    done();
  });
};

module.exports = CLI;
