'use strict';

const blessed = require('blessed');

const Fabric = require('./fabric');
const Constants = require('./constants');
const Key = require('./key');
const State = require('./state');
const Swarm = require('./swarm');

const DEFAULT_PEER_LIST = require('../data/peers');

/**
 * Base class for a terminal-like interface to the Fabric network.
 * @property {Object} config Initial {@link Vector}.
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
      ui: './components/cli.jade',
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
    let cli = this;
    let start = new Date();

    cli._appendLogMessage({
      actor: '[FABRIC]',
      created: start.toISOString(),
      input: 'Loading from history...'
    });

    // TODO: use method to only retrieve latest
    let logs = await cli._GET('/messages') || [];
    let messages = [];

    console.log('logs loaded:', logs);

    for (let i in logs) {
      let message = await cli._GET(`/states/${logs[i]}`);

      if (!message) {
        cli.error(`Message ${logs[i]} was in the history, but not found in local storage.`);
      } else {
        messages.push(message);
      }
    }

    messages.sort(function (a, b) {
      return new Date(a.created) - new Date(b.created);
    });

    for (let i in messages) {
      cli._appendMessage(messages[i]);
    }

    let finish = new Date();

    cli._appendLogMessage({
      actor: '[FABRIC]',
      created: finish.toISOString(),
      input: `Historical context loaded in ${finish - start}ms.  Welcome!`
    });

    cli._appendMessage({
      actor: '[FABRIC]',
      created: start.toISOString(),
      input: 'Welcome, friend!'
    });

    return this;
  }

  // TODO: move to Fabric#Chat
  async _handleConnectionOpen (connection) {
    let self = this;

    self.log('connection opened:', connection.address);
    self.log('connection:', connection);

    if (self.peerlist) {
      self.peerlist.addItem(`${connection.address}`);
      self.peerlist.setScrollPerc(100);
    }

    if (self.screen) {
      self.screen.render();
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

    this.status = 'posting';
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
      let vector = new State({
        '@type': 'Chat',
        actor: this.actor,
        method: 'sha256',
        created: now.toISOString(),
        parent: this.state.id,
        integrity: `sha256:${state.id}`,
        input: data.input
      });

      // TODO: visual indicator of "sending..." status
      let link = await this._POST('/messages', vector['@data']);
      let message = await this._GET(link).catch((E) => { console.error(E); });
      let recov = await this._GET('/messages').catch((E) => { console.error(E); });
      let outcome = new State(recov);
      let blob = `/states/${outcome.id}`;

      this.log('posted:', link);
      this.log('message:', message);
      this.log('recov:', recov);
      this.log('link:', link);
      this.log('blob:', blob);

      this.log('outcome:', outcome);
      this.log('yay, our data:', outcome['@data']['@data']);

      if (!link) {
        return this.log('Could not post message.');
      }

      return link;
    }

    this.elements.form.reset();
    this.status = 'ready';

    return this;
  }

  async start () {
    await super.start();

    console.log('CLI starting...');

    let self = this;
    let swarm = self.swarm = new Swarm(self.config.swarm);

    // log events
    self.on('info', self.inform.bind(self));
    self.on('warn', self.inform.bind(self));
    self.on('error', self.inform.bind(self));

    // swarm notifications
    swarm.on('peer', self._handlePeerMessage.bind(self));
    swarm.on('ready', self._handleReady.bind(self));
    swarm.on('connections:open', self._handleConnectionOpen.bind(self));
    swarm.on('connections:close', self._handleConnectionClose.bind(self));

    self.on('changes', function (changes) {
      self.log(`${changes.length} changes to self:`, changes);
    });

    // await self.trust(self.store);
    // await self.trust(self.swarm);

    await self.swarm.start();

    await self._createInstance();
    await self._assembleInterface();

    return this;
  }

  inform (msg) {
    try {
      this._appendLogMessage(msg);
    } catch (E) {
      this.error('could not inform:', msg);
    }
  }

  trust (source) {
    let cli = this;

    source.on('info', cli.log.bind(cli));
    source.on('warn', cli.log.bind(cli));
    source.on('error', cli.log.bind(cli));

    source.on('changes', async function (changes) {
      cli.log(`source (${source.constructor.name}) emitted changes:`, changes);
      let state = await cli._applyChanges(changes);

      cli.log(`magic:`, state);
      cli.log(`magic data:`, state['@data']);
      cli.log(`${changes.length} changes:`, changes);

      // TODO: set relay policy
      cli.emit('state', state);
    });

    // TODO: internalize to CLI
    // TODO: fix route -- `channels/messages`
    source.on(`channels/~1messages`, function (event) {
      let state = new State(source['@data'].collections['/messages']['@data']);
      cli.log(`@id: `, state.id);
      cli._appendMessage(event['@data']);
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
    let state = new State(instance);

    if (self.elements.history) {
      // TODO: use Stack
      self.elements.history.pushLine(`[${state.id}] ${instance.created} ${(instance.actor) ? ' ' + instance.actor : ''}: ${instance.input}`);
      self.elements.history.setScrollPerc(100);
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
    }, message);

    if (self.elements.logs) {
      self.elements.logs.addItem(`${instance.created}: ${instance.input}`);
      self.elements.logs.setScrollPerc(100);
    }

    if (self.screen) {
      self.screen.render();
    }
  }

  async _assembleInterface () {
    let self = this;

    self.elements = {};

    self.elements.controls = blessed.box({
      parent: self.screen,
      border: {
        type: 'line'
      },
      bottom: 0,
      height: 3
    });

    self.elements.form = blessed.form({
      parent: self.screen,
      keys: true
    });

    self.elements.textbox = blessed.textbox({
      parent: self.elements.form,
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

    self.elements.submit = blessed.button({
      parent: self.elements.form,
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

    self.elements.instructions = blessed.box({
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

    self.elements.history = blessed.box({
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

    self.elements.logs = blessed.list({
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

    self.elements.textbox.key(['enter'], function (ch, key) {
      self.elements.form.submit();
      self.elements.textbox.clearValue();
      self.elements.textbox.readInput();
    });

    self.elements.textbox.key(['up'], function (ch, key) {
      self.log('up press:', self.commandHistory[0], ch, key);
      self.elements.textbox.setValue(self.commandHistory[self.commandHistory.size - 1]);
    });

    self.elements.submit.on('press', function () {
      self.form.submit();
    });

    self.elements.form.on('submit', self._handleSubmit.bind(self));

    await self._loadHistory();
    self._requestLogin();

    return this;
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
      fg: 'white',
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      content: 'What is your name?'
    });

    self.elements.login.readInput('What should others call you?', '', function (nick) {
      self.nickname = nick;
      self.identity = new Key();
      self.log('Identity:', {
        nickname: nick,
        key: self.identity
      });
    });

    self.elements.login.show();
    self.elements.login.focus();

    return this;
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

      // done();
    });
  }
}

module.exports = CLI;
