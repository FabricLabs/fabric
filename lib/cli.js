'use strict';

const blessed = require('blessed');

const Fabric = require('./fabric');
const Key = require('./key');
const State = require('./state');
const Swarm = require('./swarm');
const Vector = require('./vector');

const MAX_ACTOR_LENGTH = 35;
const DEFAULT_PEER_LIST = require('../data/peers');

/**
 * Base class for a terminal-like interface to the Fabric network.
 * @property {Configratione} config Initial {@link Vector}.
 * @property {Oracle} oracle Instance of {@link Oracle}.
 */
class CLI extends Fabric {
  /**
   * Base class for a terminal-like interface to the Fabric network.
   * @param       {Object} configuration Configuration object for the CLI.
   */
  constructor (config) {
    super(config);

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
    }, config);

    this.elements = {};
    this.commandHistory = new Set();

    // set ready status
    this.status = 'ready';

    return this;
  }

  async _loadHistory () {
    // TODO: use method to only retrieve latest
    let logs = await this._GET('/messages') || [];

    logs.sort(function (a, b) {
      return new Date(a.created) - new Date(b.created);
    });

    for (let i in logs) {
      let message = await this._GET(`/messages/${logs[i]}`);
      this.log('message:', message);
      if (message) {
        this._appendMessage(message);
      } else {
        this.warn(`Message ${logs[i]} was in the history, but not found in local storage.`);
      }
    }
  }

  // TODO: move to Fabric#Chat
  async _handlePeerMessage (peer) {
    let self = this;
    let node = await self._PUT(`/peers/${peer.id}`, peer);
    // let result = await self._POST(`/peers`, node);
    return this;
  }

  async _handleSubmit (data) {
    if (!data) return this.log('No data.');
    if (!data.input) return this.log(`Input is required.`);

    let now = new Date();
    let self = this;

    this.commandHistory.add(data.input);

    if (data.input.charAt(0) === '/') {
      let parts = data.input.trim().split(' ');
      switch (parts[0].substring(1)) {
        default:
          this.log('Unknown command:', parts[0]);
          break;
        case 'help':
          this.log('Available commands:',
            '/help',
            '/test',
            '/keys',
            '/peers',
            '/ping',
            '/state',
            '/history',
            '/connect',
            '/clear',
            '/wipe'
          );
          break;
        case 'test':
          this.log('test!');
          break;
        case 'keys':
          this.log('keys:', this.oracle.keys);
          break;
        case 'peers':
          this.log('peers:', this.swarm.peers);
          break;
        case 'ping':
          this.log('pinging peers...');
          // select a random number, broadcast with ping
          this.swarm._broadcastTypedMessage(0x12, Math.random());
          break;
        case 'state':
          this.log('state (self):', this.state.id, this.state);
          // this.log('state (oracle):', this.oracle.state.id, this.oracle.state);
          // this.log('state (machine):', this.oracle.machine.state.id, this.oracle.machine.state);
          break;
        case 'history':
          this.log('history:', this.commandHistory);
          break;
        case 'connect':
          this.swarm.connect(parts[1]);
          break;
        case 'clear':
          this.logs.clearItems();
          this.log('Cleared logs.');
          break;
        case 'wipe':
          // await this.oracle.flush();
          await this.flush();
          this.log('shutting down in 5s...');
          setTimeout(function () {
            process.exit();
          }, 5000);
      }
    } else {
      let state = new State(data.input);
      let vector = new Vector({
        '@type': 'Chat',
        actor: this.actor,
        method: 'sha256',
        created: now.toISOString(),
        parent: this.state.id,
        integrity: `sha256:${state.id}`,
        input: data.input
      });

      // TODO: visual indicator of "sending..." status
      let result = await this._POST('/messages', vector['@data']);
      // let item = await this._GET(result);
      let item = await this._GET(`/messages/${vector.id}`);

      // TODO: use `result`, which has `/blobs:id` as absolute path
      // this.log('result:', result);
      this.log('created:', typeof item['@data'], item['@data']);

      if (!result) {
        return this.log('Could not post message.');
      }
    }

    this.form.reset();
    // this.screen.render();

    return this;
  }

  async start () {
    await super.start();

    console.log('CLI starting...');

    let self = this;
    let swarm = self.swarm = new Swarm(self.config.swarm);

    // log events
    self.on('info', self.inform.bind(self));
    // swarm.on('info', self.inform.bind(self));

    // swarm notifications
    swarm.on('peer', self._handlePeerMessage.bind(self));
    swarm.on('ready', self._handleReady.bind(self));
    swarm.on('connections:open', self._handleConnectionOpen.bind(self));
    swarm.on('connections:close', self._handleConnectionClose.bind(self));
    swarm.on('changes', async function (changes) {
      console.log('swarm gave us changes:', changes);

      await self.machine.applyChanges(changes);
      await self.machine.commit();

      await self._sync();
      self.log('state is now:', self.machine.state);
    });

    self.on('changes', function (changes) {
      self.log('changes:', changes);
    });

    // TODO: remove wat
    // shouldn't have to trust our own state...
    self.trust(self.state);
    await swarm.start();

    self._createInstance();
    self._assembleInterface();
    // TODO: move to lib/chat
    self._requestLogin();

    self.screen.render();

    // TODO: use a status UI
    let start = new Date();
    self._appendLogMessage({
      actor: '[FABRIC]',
      created: start.toISOString(),
      input: 'Loading from history...'
    });
    self._loadHistory();
    let finish = new Date();

    self._appendLogMessage({
      actor: '[FABRIC]',
      created: finish.toISOString(),
      input: `Historical context loaded in ${finish - start}ms.  Welcome!`
    });

    self._appendMessage({
      actor: '[FABRIC]',
      created: start.toISOString(),
      input: 'Hello, friend!'
    });

    // self.subscribe('/');

    // self.form.focus();
    self.textbox.readInput();

    return this;
  }

  inform (msg) {
    try {
      this._appendLogMessage(msg);
    } catch (E) {
      console.error('could not inform:', msg);
    }
  }

  trust (source) {
    let cli = this;

    source.on('changes', async function (changes) {
      let state = await cli._applyChanges(changes);
      cli.log('CLI type:', cli.constructor.name);
      cli.log('applied:', state.id);
      cli.log('cli[@data]:', cli['@data']);
    });

    return cli;
  }

  // TODO: move to Fabric#Chat
  _appendMessage (message) {
    let self = this;
    let instance = Object.assign({
      actor: message.actor,
      created: new Date(),
      input: message.input
    }, { created: message.created });

    if (self.history) {
      self.history.pushLine(`${instance.created}${(instance.actor) ? ' ' + instance.actor : ''}: ${instance.input}`);
      self.history.setScrollPerc(100);
    }

    if (self.screen) {
      self.screen.render();
    }
  }

  // TODO: move to Fabric#Chat
  _appendLogMessage (message) {
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
  }

  _assembleInterface () {
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

    self.form.on('submit', self._handleSubmit.bind(self));
  }

  _createInstance () {
    let self = this;

    self.screen = blessed.screen({
      smartCSR: true,
      dockBorders: true
    });

    self.screen.key(['escape'], function (ch, key) {
      self.screen.destroy();
      // console.log('the machine:', self.machine);
      // console.log('the mempool:', self.mempool);
      process.exit();
    });
  }

  _handleReady (event) {
    this.log('handling ready:', event);
    this.emit('ready');
  }

  /**
   * Update UI as necessary based on changes from Oracle.
   * @param  {Message} msg Incoming {@link Message}.
   * @return {CLI}
   */
  _handleChanges (msg) {
    let self = this;

    self.log('handling changes:', msg);

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

    return this;
  }

  _handleCollectionUpdate (change) {
    let self = this;

    self.log('handling collection update:', change);

    switch (change.path) {
      default:
        self.log('unhandled change path:', change.path);
        break;
      case '/messages':
        if (self.history) {
          // TODO: validate before append
          self._appendMessage(change.data);
        }
        break;
    }
  }

  _requestLogin () {
    let self = this;

    self.elements.login = blessed.prompt({
      parent: self.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      content: 'What is your name?'
    });

    self.elements.login.readInput('What?', 'asdf', function (nick) {
      self.log('nick set:', nick);
      self.identity = new Key();
    });

    self.elements.login.focus();

    return this;
  }

  // TODO: move to Fabric#Chat
  _handleConnectionOpen (connection) {
    let self = this;

    self.log('connection opened:', connection.address);

    if (self.peerlist) {
      self.peerlist.addItem(`${connection.address}`);
      self.peerlist.setScrollPerc(100);
    }

    if (self.screen) {
      self.screen.render();
    }
  }

  // TODO: move to Fabric#Chat
  _handleConnectionClose (connection) {
    let self = this;

    self.log('connection closed:', connection.address);

    if (self.peerlist) {
      self.peerlist.removeItem(`${connection.address}`);
      self.peerlist.setScrollPerc(100);
    }

    if (self.screen) {
      self.screen.render();
    }
  }

  // TODO: move to Fabric#Chat
  _handlePartMessage (message) {
    let self = this;

    self.log('part message:', message);

    if (self.peerlist) {
      self.peerlist.removeItem(message);
      self.peerlist.setScrollPerc(100);
    }

    if (self.screen) {
      self.screen.render();
    }
  }

  // TODO: read specific Jade template, compose Blessed interface
  // from standardized elements (should match element names in Maki)
  render () {
    const self = this;
    const render = jade.compileFile(this['@data'].ui);
    const xml = render(this['@data']);

    parse(xml, function (err, doc) {
      if (err) return console.error(err);
      // if (!doc || !doc.document) return console.error('Invalid UI definition.');

      console.debug('doc:', doc);

      self.screen = blessed.screen();
      self.viewer = new Viewer(doc, self.screen);

      self.screen.key(['q', 'escape'], function (ch, key) {
        process.exit();
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
      // self.viewer.render();

      done();
    });
  }
}

module.exports = CLI;
