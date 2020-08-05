'use strict';

// Types
const App = require('../types/app');
const Peer = require('../types/peer');
const Message = require('../types/message');

// Services
const Bitcoin = require('../services/bitcoin');

// UI dependencies
const blessed = require('blessed');

class CLI extends App {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({}, this.settings, settings);

    this.node = new Peer(this.settings);
    this.bitcoin = new Bitcoin({
      fullnode: true,
      network: 'regtest',
      verbosity: 0
    });

    this.screen = null;
    this.commands = {};
    this.elements = {};
    this.peers = {};

    return this;
  }

  async start () {
    this._registerCommand('help', this._handleHelpRequest);
    this._registerCommand('generate', this._handleGenerateRequest);

    this.render();

    // Attach P2P handlers
    this.node.on('message', this._handlePeerMessage.bind(this));
    this.node.on('peer', this._handlePeer.bind(this));
    this.node.on('peer:candidate', this._handlePeerCandidate.bind(this));
    this.node.on('connections:close', this._handleConnectionClose.bind(this));

    // Attach Bitcoin handlers
    this.bitcoin.on('block', this._handleBitcoinBlock.bind(this));

    // Start Bitcoin service
    // await this.bitcoin.start();

    this.node.start();
    this.emit('ready');
  }

  async stop () {
    return process.exit(0);
  }

  async _appendMessage (msg) {
    this.elements['messages'].log(`[${(new Date()).toISOString()}]: ${msg}`);
    this.screen.render();
  }

  async _handleBitcoinBlock (block) {
    this._appendMessage(`Bitcoin service emitted block: ${block}`);
  }

  async _handleConnectionClose (msg) {
    this._appendMessage(`Node emitted "connections:close" event: ${msg}`);
  }

  async _handlePeer (peer) {
    const self = this;
    // console.log('[SCRIPTS:CHAT]', 'Peer emitted by node:', peer);

    if (!peer.id) {
      self._appendMessage('Peer did not send an ID.  Event received: ' + JSON.stringify(peer));
    }

    if (!self.peers[peer.id]) {
      let element = blessed.element({
        name: peer.id,
        content: `[✓] ${peer.id}@${peer.address}`
      });

      self.peers[peer.id] = peer;
      // TODO: use peer ID for managed list
      // self.elements['peers'].insertItem(0, element);
      self.elements['peers'].add(element.content);
    }

    self.screen.render();
  }

  async _handlePeerCandidate (peer) {
    const self = this;
    self._appendMessage('Local node emitted "peer:candidate" event: ' + JSON.stringify(peer));
    self.screen.render();
  }

  async _handlePeerMessage (message) {
    const self = this;
    self._appendMessage(`Local "message" event: <${message.type}> ${message.data}`);
    self.screen.render();
  }

  async _handlePromptEnterKey (ch, key) {
    this.elements['form'].submit();
    this.elements['prompt'].clearValue();
    this.elements['prompt'].readInput();
  }

  _bindKeys () {
    const self = this;
    self.screen.key(['escape', 'q', 'C-c'], self.stop);
    self.elements['prompt'].key(['enter'], self._handlePromptEnterKey.bind(self));
  }

  _handleFormSubmit (data) {
    const self = this;
    const content = data.input;

    // Debug
    // TODO: remove
    self._appendMessage('Form submit: ' + JSON.stringify(data));

    // TODO: pass actor:object:target type
    const result = self._processInput(data.input);

    if (!result) {
      self.node.relayFrom(self.node.id, Message.fromVector(['Generic', content]));
    }

    self.elements['form'].reset();
    self.screen.render();
  }

  _handleGenerateRequest (count = 1) {
    this.bitcoin.generateBlock();
  }

  _handleHelpRequest (data) {
    const self = this;
    const help = `Available Commands:\n${Object.keys(self.commands).map(x => `\t${x}`).join('\n')}`;

    self._appendMessage(help);
  }

  _processInput (input) {
    if (input.charAt(0) === '/') {
      const parts = input.substring(1).split(' ');
      if (this.commands[parts[0]]) {
        // TODO: pass actor:object:target type
        return this.commands[parts[0]].apply(this, [ parts ]);
      }
    }
  }

  _registerCommand (command, method) {
    this.commands[command] = method.bind(this);
  }

  render () {
    const self = this;
    const defaults = {
      parent: self.screen,
      border: {
        type: 'line'
      }
    };

    self.screen = blessed.screen({
      smartCSR: true
    });

    self.elements['status'] = blessed.box({
      parent: self.screen,
      label: '[ Status ]',
      border: {
        type: 'line'
      },
      top: 0,
      height: 5,
      width: '100%'
    });

    self.elements['wallet'] = blessed.box({
      parent: self.elements['status'],
      right: 1,
      width: 29,
    });

    self.elements['balance'] = blessed.text({
      parent: self.elements['wallet'],
      content: '0.00000000',
      top: 0,
      right: 4
    });

    self.elements['label'] = blessed.text({
      parent: self.elements['wallet'],
      content: 'BALANCE:',
      top: 0,
      right: 15
    });

    self.elements['denomination'] = blessed.text({
      parent: self.elements['wallet'],
      content: 'BTC',
      top: 0,
      right: 0
    });

    self.elements['messages'] = blessed.log({
      parent: self.screen,
      label: '[ Messages ]',
      border: {
        type: 'line'
      },
      top: 5,
      width: '80%',
      bottom: 3,
      mouse: true
    });

    self.elements['peers'] = blessed.list({
      parent: self.screen,
      label: '[ Peers ]',
      border: {
        type: 'line'
      },
      top: 5,
      left: '80%+1',
      bottom: 3
    });

    self.elements['controls'] = blessed.box({
      parent: self.screen,
      bottom: 0,
      height: 3,
      border: {
        type: 'line'
      }
    });

    self.elements['form'] = blessed.form({
      parent: self.elements['controls'],
      bottom: 0,
      height: 1,
      left: 1
    });

    self.elements['prompt'] = blessed.textbox({
      parent: self.elements['form'],
      name: 'input',
      input: true,
      keys: true,
      inputOnFocus: true
    });

    // Render the screen.
    self.screen.render();
    self._bindKeys();

    self.elements['form'].on('click', function () {
      self.elements['prompt'].focus();
    });

    self.elements['form'].on('submit', self._handleFormSubmit.bind(self));
    self.elements['prompt'].focus();

    setInterval(function () {
      self._appendMessage('10 seconds have passed.');
      self.bitcoin.generateBlock();
    }, 10000);
  }
}

module.exports = CLI;