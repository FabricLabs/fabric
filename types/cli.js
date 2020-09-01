'use strict';

const MAX_CHAT_MESSAGE_LENGTH = 2048;

// Dependencies
const merge = require('lodash.merge');

// Types
const App = require('../types/app');
const Peer = require('../types/peer');
const Message = require('../types/message');

// Services
const Bitcoin = require('../services/bitcoin');

// UI dependencies
// TODO: use Jade to render pre-registered components
// ```jade
// fabric-application
//   fabric-box
//   fabric-row
//     fabric-log
//     fabric-list
//   fabric-input
// ```
const blessed = require('blessed');

/**
 * Provides a Command Line Interface (CLI) for interacting with
 * the Fabric network using a terminal emulator.
 */
class CLI extends App {
  constructor (settings = {}) {
    super(settings);

    // Assign Settings
    this.settings = merge({}, this.settings, settings);

    // Internal Components
    this.node = new Peer(this.settings);
    this.bitcoin = new Bitcoin({
      fullnode: true,
      network: 'regtest',
      peers: [
        // '25.14.120.36:18444',
        // '127.0.0.1:18444'
      ],
      verbosity: 0
    });

    // Other Properties
    this.screen = null;
    this.history = [];
    this.commands = {};
    this.services = {};
    this.elements = {};
    this.peers = {};

    // Chainable
    return this;
  }

  async start () {
    // Register Internal Commands
    this._registerCommand('help', this._handleHelpRequest);
    this._registerCommand('quit', this._handleQuitRequest);
    this._registerCommand('exit', this._handleQuitRequest);
    this._registerCommand('clear', this._handleClearRequest);
    this._registerCommand('peers', this._handlePeerListRequest);
    this._registerCommand('connect', this._handleConnectRequest);
    this._registerCommand('disconnect', this._handleDisconnectRequest);
    this._registerCommand('identity', this._handleIdentityRequest);
    this._registerCommand('generate', this._handleGenerateRequest);
    this._registerCommand('receive', this._handleReceiveAddressRequest);
    this._registerCommand('balance', this._handleBalanceRequest);
    this._registerCommand('sync', this._handleChainSyncRequest);
    this._registerCommand('send', this._handleSendRequest);

    // Render UI
    this.render();

    // Attach P2P handlers
    this.node.on('ready', this._handleNodeReady.bind(this));
    this.node.on('error', this._handlePeerError.bind(this));
    this.node.on('warning', this._handlePeerWarning.bind(this));
    this.node.on('message', this._handlePeerMessage.bind(this));

    this.node.on('peer', this._handlePeer.bind(this));
    this.node.on('peer:candidate', this._handlePeerCandidate.bind(this));
    this.node.on('connections:open', this._handleConnectionOpen.bind(this));
    this.node.on('connections:close', this._handleConnectionClose.bind(this));
    this.node.on('connection:error', this._handleConnectionError.bind(this));
    this.node.on('session:update', this._handleSessionUpdate.bind(this));
    // this.node.on('socket:data', this._handleSocketData.bind(this));

    // Attach Bitcoin handlers
    this.bitcoin.on('ready', this._handleBitcoinReady.bind(this));
    this.bitcoin.on('error', this._handleBitcoinError.bind(this));
    this.bitcoin.on('message', this._handleBitcoinMessage.bind(this));
    this.bitcoin.on('block', this._handleBitcoinBlock.bind(this));
    this.bitcoin.on('tx', this._handleBitcoinTransaction.bind(this));

    // Start Bitcoin service
    await this.bitcoin.start();

    for (const [name, service] of Object.entries(this.services)) {
      await service.start();
    }

    // Start P2P node
    this.node.start();
    this.emit('ready');
  }

  async stop () {
    await this.node.stop();
    return process.exit(0);
  }

  async _appendMessage (msg) {
    this.elements['messages'].log(`[${(new Date()).toISOString()}]: ${msg}`);
    this.screen.render();
  }

  async _appendWarning (msg) {
    this._appendMessage(`{yellow-fg}${msg}{/yellow-fg}`)
  }

  async _appendError (msg) {
    this._appendMessage(`{red-fg}${msg}{/red-fg}`)
  }

  async _handleBitcoinMessage (message) {
    this._appendMessage(`Bitcoin service emitted message: ${message}`);
  }

  async _handleBitcoinBlock (block) {
    this._appendMessage(`Bitcoin service emitted block, chain height now: ${this.bitcoin.fullnode.chain.height}`);
    this._syncChainDisplay();
    const message = Message.fromVector(['BlockCandidate', block.raw]);
    this.node.relayFrom(this.node.id, message);
  }

  async _handleBitcoinTransaction (transaction) {
    this._appendMessage(`Bitcoin service emitted transaction: ${JSON.stringify(transaction)}`);
  }

  async _handleBitcoinError (...msg) {
    this._appendError(msg);
  }

  async _handleBitcoinReady (bitcoin) {
    this._syncChainDisplay();
  }

  async _handleConnectionOpen (msg) {
    this._appendMessage(`Node emitted "connections:open" event: ${JSON.stringify(msg)}`);
    this._syncPeerList();
  }

  async _handleConnectionClose (msg) {
    this._appendMessage(`Node emitted "connections:close" event: ${JSON.stringify(msg)}`);

    for (const id in this.peers) {
      const peer = this.peers[id];
      this._appendMessage(`Checking: ${JSON.stringify(peer)}`);
      if (peer.address === msg.address) {
        this._appendMessage(`Address matches.`);
        delete this.peers[id];
      }
    }

    this._syncPeerList();
  }

  async _handleConnectionError (msg) {
    this._appendMessage(`Node emitted "connection:error" event: ${JSON.stringify(msg)}`);
  }

  async _handlePeer (peer) {
    const self = this;
    // console.log('[SCRIPTS:CHAT]', 'Peer emitted by node:', peer);

    if (!peer.id) {
      self._appendMessage('Peer did not send an ID.  Event received: ' + JSON.stringify(peer));
    }

    if (!self.peers[peer.id]) {
      self.peers[peer.id] = peer;
    }

    self._syncPeerList();
    self.screen.render();
  }

  async _handlePeerCandidate (peer) {
    const self = this;
    self._appendMessage('Local node emitted "peer:candidate" event: ' + JSON.stringify(peer));
    self.screen.render();
  }

  async _handleNodeReady (node) {
    this.elements['identityString'].setContent(node.id);
  }

  async _handlePeerError (message) {
    this._appendError(`Local "error" event: ${JSON.stringify(message)} <${message.type}> ${message.data}`);
  }

  async _handlePeerWarning (message) {
    this._appendWarning(`Local "warning" event: ${JSON.stringify(message)}`);
  }

  async _handlePeerMessage (message) {
    switch (message.type) {
      default:
        if (!message.type && !message.data) {
          this._appendMessage(`Local "message" event: ${message}`);
        } else {
          this._appendMessage(`Local "message" event: <${message.type}> ${message.data}`);
        }
        break;
      case 'ChatMessage':
        try {
          let parsed = JSON.parse(message.data);
          this._appendMessage(`[@${parsed.actor}]: ${parsed.object.content}`);
        } catch (exception) {
          this._appendError(`Could not parse <ChatMessage> data (should be JSON): ${message.data}`);
        }
        break;
      case 'BlockCandidate':
        this._appendMessage(`Received Candidate Block from peer: <${message.type}> ${message.data}`);
        this.bitcoin.append(message.data);
        break;
    }
  }

  async _handleSessionUpdate (session) {
    this._appendMessage(`Local session update: ${JSON.stringify(session, null, '  ')}`);
  }

  async _handleSocketData (data) {
    this._appendMessage(`Local "socket:data" event: ${JSON.stringify(data)}`);
  }

  async _handlePromptEnterKey (ch, key) {
    this.elements['prompt'].historyIndex = this.history.length;
    this.elements['form'].submit();
    this.elements['prompt'].clearValue();
    this.elements['prompt'].readInput();
  }

  async _handlePromptUpKey (ch, key) {
    const index = this.elements['prompt'].historyIndex;
    if (index > 0) this.elements['prompt'].historyIndex--;
    this.elements['prompt'].setValue(this.history[index]);
    this.screen.render();
  }

  async _handlePromptDownKey (ch, key) {
    const index = ++this.elements['prompt'].historyIndex;

    if (index < this.history.length) {
      this.elements['prompt'].setValue(this.history[index]);
    } else {
      this.elements['prompt'].historyIndex = this.history.length - 1;
      this.elements['prompt'].setValue('');
    }

    this.screen.render();
  }

  async _handleGenerateRequest (params) {
    if (!params[1]) params[1] = 1;
    const count = params[1];
    const address = await this.node.wallet.getUnusedAddress();
    this._appendMessage(`Generating ${count} blocks to address: ${address}`);
    this.bitcoin.generateBlocks(count, address);
    return false;
  }

  _bindKeys () {
    const self = this;
    self.screen.key(['escape', 'q', 'C-c'], self.stop.bind(self));
    self.elements['prompt'].key(['enter'], self._handlePromptEnterKey.bind(self));
    self.elements['prompt'].key(['up'], self._handlePromptUpKey.bind(self));
    self.elements['prompt'].key(['down'], self._handlePromptDownKey.bind(self));
  }

  _handleFormSubmit (data) {
    const self = this;
    const content = data.input;

    if (!content) return self._appendMessage('No message provided.');
    if (content.length > MAX_CHAT_MESSAGE_LENGTH) return self._appendMessage(`Message exceeds maximum length (${MAX_CHAT_MESSAGE_LENGTH}).`);

    // Modify history
    self.history.push(data.input);

    // Send as Chat Message if no handler registered
    if (!self._processInput(data.input)) {
      // Describe the activity for use in P2P message
      let body = JSON.stringify({
        actor: self.node.id,
        object: {
          created: Date.now(),
          content: content
        },
        target: '/messages'
      });

      self.node.relayFrom(self.node.id, Message.fromVector(['ChatMessage', body]));
    }

    self.elements['form'].reset();
    self.screen.render();
  }

  _handleQuitRequest () {
    this._appendMessage('Exiting...');
    this.stop();
    return false;
  }

  _handleClearRequest () {
    this.elements['messages'].setContent('');
    return false;
  }

  _handlePeerListRequest (params) {
    this._appendMessage('Peers: ' + JSON.stringify(this.peers, null, ' '));
    return false;
  }

  _handleConnectRequest (params) {
    if (!params[1]) return this._appendMessage('You must specify an address to connect to.');
    const address = params[1];
    this._appendMessage('Connect request: ' + JSON.stringify(params));
    this.node._connect(address);
    return false;
  }

  _handleDisconnectRequest (params) {
    if (!params[1]) return this._appendMessage('You must specify an peer to disconnect from.');
    const id = params[1];
    this._appendMessage('Disconnect request: ' + JSON.stringify(params));
    this.node._disconnect(id);
    return false;
  }

  _handleChainSyncRequest () {
    this._appendMessage(`Sync starting for chain...`);

    // TODO: test this on testnet / mainnet
    this.bitcoin.fullnode.startSync();

    const message = Message.fromVector(['ChainSyncRequest', JSON.stringify({
      tip: this.bitcoin.fullnode.chain.tip
    })]);
    this.node.relayFrom(this.node.id, message);

    return false;
  }

  async _handleSendRequest (params) {
    if (!params[1]) return this._appendError('You must specify an address to send to.');
    if (!params[2]) return this._appendError('You must specify an amount to send.');

    const address = params[1];
    const amount = params[2];

    const tx = await this.node.wallet._spendToAddress(amount, address);
    this._appendMessage('Transaction created:', tx);

    return false;
  }

  async _handleBalanceRequest () {
    const balance = await this.node.wallet.wallet.getBalance(1);
    this._appendMessage(`{bold}Wallet Balance{/bold}: ${JSON.stringify(balance, null, '  ')}`);
    return false;
  }

  async _handleReceiveAddressRequest () {
    const address = await this.node.wallet.getUnusedAddress();
    this._appendMessage(`{bold}Receive address:{/bold}: ${JSON.stringify(address.toString(), null, '  ')}`);
    return false;
  }

  _handleIdentityRequest () {
    this._appendMessage(`Local Identity: ${JSON.stringify({
      id: this.node.id,
      address: this.node.server.address()
    }, null, '  ')}`);
  }

  _handleHelpRequest (data) {
    const self = this;
    const help = `Available Commands:\n${Object.keys(self.commands).map(x => `\t${x}`).join('\n')}`;

    self._appendMessage(help);
  }

  _handleServiceMessage (msg) {
    this.emit('message', 'received message from service:', msg);
  }

  _processInput (input) {
    if (input.charAt(0) === '/') {
      const parts = input.substring(1).split(' ');

      if (this.commands[parts[0]]) {
        this.commands[parts[0]].apply(this, [ parts ]);
        return true;
      }

      this._appendError('Unhandled command: ' + parts[0]);

      return true;
    }

    return false;
  }

  _syncChainDisplay () {
    this.elements['chainTip'].setContent(`${this.bitcoin.tip} (height is ${this.bitcoin.fullnode.chain.height})`);
  }

  _syncPeerList () {
    this.elements['peers'].clearItems();

    for (const id in this.peers) {
      const peer = this.peers[id];
      const element = blessed.element({
        name: peer.id,
        content: `[✓] ${peer.id}@${peer.address}`
      });

      // TODO: use peer ID for managed list
      // self.elements['peers'].insertItem(0, element);
      this.elements['peers'].add(element.content);
    }
  }

  _registerCommand (command, method) {
    this.commands[command] = method.bind(this);
  }

  _registerService (name, type) {
    const self = this;
    const service = new type(this.settings);

    this.services[name] = service;

    this.services[name].on('message', function (msg) {
      self._appendMessage(`service message from ${name}:`, msg);
    });
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
      smartCSR: true,
      input: this.settings.input,
      output: this.settings.output,
      terminal: this.settings.terminal,
      fullUnicode: this.settings.fullUnicode
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

    self.elements['identity'] = blessed.box({
      parent: self.elements['status'],
      left: 1
    });

    self.elements['identityLabel'] = blessed.text({
      parent: self.elements['identity'],
      content: 'IDENTITY:',
      top: 0,
      bold: true
    });

    self.elements['identityString'] = blessed.text({
      parent: self.elements['identity'],
      content: '',
      top: 0,
      left: 10
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
      right: 15,
      bold: true
    });

    self.elements['denomination'] = blessed.text({
      parent: self.elements['wallet'],
      content: 'BTC',
      top: 0,
      right: 0
    });

    self.elements['chain'] = blessed.box({
      parent: self.elements['status'],
      top: 1,
      left: 1
    });

    self.elements['chainLabel'] = blessed.box({
      parent: self.elements['chain'],
      content: 'CHAIN TIP:',
      bold: true
    });

    self.elements['chainTip'] = blessed.box({
      parent: self.elements['chain'],
      content: '',
      left: 11
    });

    self.elements['mempool'] = blessed.box({
      parent: self.elements['status'],
      top: 2,
      left: 1,
      width: 29
    });

    self.elements['mempoolLabel'] = blessed.box({
      parent: self.elements['mempool'],
      content: 'MEMPOOL SIZE:',
      bold: true
    });

    self.elements['mempoolCount'] = blessed.box({
      parent: self.elements['mempool'],
      content: '0',
      left: 14
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
      mouse: true,
      tags: true
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


    // Set Index for Command History
    this.elements['prompt'].historyIndex = -1;

    // Render the screen.
    self.screen.render();
    self._bindKeys();

    // TODO: clean up workaround (from https://github.com/chjj/blessed/issues/109)
    self.elements['prompt'].oldFocus = self.elements['prompt'].focus;
    self.elements['prompt'].focus = function () {
      let oldListener = self.elements['prompt'].__listener;
      self.elements['prompt'].removeListener('keypress', self.elements['prompt'].__listener);
      delete self.elements['prompt'].__listener;

      let oldBlur = self.elements['prompt'].__done;
      self.elements['prompt'].removeListener('blur', self.elements['prompt'].__done);
      delete self.elements['prompt'].__done;
      self.elements['prompt'].screen.focusPop(self.elements['prompt'])

      self.elements['prompt'].addListener('keypress', oldListener);
      self.elements['prompt'].addListener('blur', oldBlur);

      self.elements['prompt'].oldFocus();
    }

    //focus when clicked
    self.elements['form'].on('click', function () {
      self.elements['prompt'].focus();
    });

    self.elements['form'].on('submit', self._handleFormSubmit.bind(self));
    self.elements['prompt'].focus();

    setInterval(function () {
      // self._appendMessage('10 seconds have passed.');
      // self.bitcoin.generateBlock();
    }, 10000);
  }
}

module.exports = CLI;
