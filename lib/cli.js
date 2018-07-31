'use strict';

import Fabric from '../';

const util = require('util');
const jade = require('jade');
const parse = require('xml2js').parseString;
const blessed = require('blessed');
const contrib = require('blessed-contrib');

//const Fabric = require('../');
const Swarm = require('./swarm');
const Vector = require('./vector');
const Viewer = require('wopr');

const MAX_ACTOR_LENGTH = 35;
const DEFAULT_PEER_LIST = require('../data/peers');

/**
 * Base class for a terminal-like interface to the Fabric network.
 * @param       {Object} configuration Configuration object for the CLI.
 * @constructor
 * @property storage {Storage} - Instance of {@link Storage}.
 */
function CLI (init) {
  this['@data'] = init || {};

  // TODO: use deep assign
  this.config = Object.assign({
    ui: './assets/cli.jade',
    oracle: true,
    swarm: {
      peer: {
        port: process.env['PEER_PORT'] || 7777
      },
      peers: DEFAULT_PEER_LIST
    }
  }, init);

  if (this.config.oracle) {
    this.oracle = new Fabric.HTTP(Object.assign({
      name: 'fabric',
      port: 3007
    }, this.config.oracle));

    this.oracle.on('changes', this.handler.bind(this));
    this.oracle.on('info', this.inform.bind(this));

    // TODO: move to lib/chat.js
    this.oracle.define('Message', {
      routes: {
        list: '/messages',
        get: '/messages/:id'
      }
    });

    this.oracle.define('Peer', {
      routes: {
        list: '/peers',
        get: '/peers/:id'
      }
    });
  }

  this.commandHistory = new Set();

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.init();
}

// all user interfaces begin with a "Vector"
util.inherits(CLI, Vector);

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

  self.textbox.key(['enter'], function (ch, key) {
    self.form.submit();
    self.textbox.clearValue();
    self.textbox.readInput();
  });

  self.textbox.key(['up'], function (ch, key) {
    self.log('up press:', self.commandHistory[0], ch, key);
    self.textbox.setValue(self.commandHistory[self.commandHistory.size - 1]);
  });

  self.submit.on('press', function () {
    self.form.submit();
  });

  self.form.on('submit', async function (data) {
    if (!data) return self.log('No data.');

    let now = new Date();

    self.commandHistory.add(data.input);

    if (data && data.input && data.input.charAt(0) === '/') {
      let parts = data.input.trim().split(' ');
      switch (parts[0].substring(1)) {
        default:
          self.log('Unknown command:', parts[0]);
          break;
        case 'help':
          self.log('Available commands:',
            '/help',
            '/test',
            '/keys',
            '/peers',
            '/ping',
            '/state',
            '/history',
            '/clear',
            '/wipe'
          );
          break;
        case 'test':
          self.log('test!');
          break;
        case 'keys':
          self.log('keys:', self.oracle.keys);
          break;
        case 'peers':
          self.log('peers:', self.swarm.peers);
          break;
        case 'ping':
          self.log('pinging peers...');
          // select a random number, broadcast with ping
          self.swarm._broadcastTypedMessage(0x12, Math.random());
          break;
        case 'state':
          self.log('state (self):', self.state);
          self.log('state (oracle):', self.oracle.state);
          self.log('state (machine):', self.oracle.machine.state);
          break;
        case 'history':
          self.log('history:', self.commandHistory);
          break;
        case 'clear':
          self.logs.clearItems();
          self.log('Cleared logs.');
          break;
        case 'wipe':
          await self.oracle.flush();
          self.log('shutting down in 5s...');
          setTimeout(function () {
            process.exit();
          }, 5000);
      }
    } else {
      if (!data.input) {
        return self.log(`Message is required.`);
      }
      // TODO: visual indicator of "sending..." status
      let result = await self.oracle._POST('/messages', {
        created: now.toISOString(),
        input: data.input
      });

      if (!result) {
        return self.log('Could not post message.');
      }
    }

    self.form.reset();
    self.screen.render();
  });
};

// TODO: move to Fabric#Chat
CLI.prototype._handleConnection = function (connection) {
  let self = this;

  if (self.peerlist) {
    self.peerlist.addItem(`${connection.address}`);
    self.peerlist.setScrollPerc(100);
  }

  if (self.screen) {
    self.screen.render();
  }
};

// TODO: move to Fabric#Chat
CLI.prototype._handlePeerMessage = async function (peer) {
  let self = this;
  let node = await self.oracle._PUT(`/peers/${peer.id}`, peer);
  // let result = await self.oracle._POST(`/peers`, node);

  self.log('peer PUT result:', node);

  let outcome = self.oracle.machine.commit();

  self.log('outcome:', outcome);
};

// TODO: move to Fabric#Chat
CLI.prototype._handlePartMessage = function (message) {
  let self = this;

  self.log('part message:', message);

  if (self.peerlist) {
    self.peerlist.removeItem(message);
    self.peerlist.setScrollPerc(100);
  }

  if (self.screen) {
    self.screen.render();
  }
};

// TODO: move to Fabric#Chat
CLI.prototype._appendMessage = function (message) {
  let self = this;
  let instance = Object.assign({
    created: new Date(),
    input: message.input
  }, { created: message.created }, {});

  if (self.history) {
    self.history.pushLine(`${instance.created}${(instance.actor) ? ' ' + instance.actor : ''}: ${instance.input}`);
    self.history.setScrollPerc(100);
  }

  if (self.screen) {
    self.screen.render();
  }
};

// TODO: move to Fabric#Chat
CLI.prototype._appendLogMessage = function (message) {
  let self = this;
  let instance = Object.assign({
    created: new Date(),
    input: JSON.stringify(message)
  });

  if (self.logs) {
    self.logs.addItem(`${instance.created}: ${instance.input}`);
    self.logs.setScrollPerc(100);
  }

  if (self.screen) {
    self.screen.render();
  }
};

CLI.prototype.inform = function (msg) {
  try {
    this._appendLogMessage(msg);
  } catch (E) {
    console.error('could not inform:', msg);
  }
};

CLI.prototype.handler = function (msg) {
  let self = this;

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
        self.log('received unhandled peer notification:', instruction);
        break;
    }
  }
};

CLI.prototype.start = async function () {
  let self = this;
  let swarm = self.swarm = new Swarm(self.config.swarm);

  self.on('info', self.inform.bind(self));

  swarm.on('info', self.inform.bind(self));
  swarm.on('peer', self._handlePeerMessage.bind(self));
  swarm.on('part', self._handlePartMessage.bind(self));
  swarm.on('connection', self._handleConnection.bind(self));

  swarm.on('changes', async function (changes) {
    self.oracle.machine.applyChanges(changes);
    await self.oracle._sync();
    self.log('state is now:', self.oracle.machine.state);
  });

  self.oracle.on('changes', function (changes) {
    self.log('ORACLE', 'emitted changes:', changes);
    self.swarm.self.broadcast(changes);
  });

  swarm.start();

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
  if (this.screen) {
    this.screen.destroy();
  }

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
