'use strict';

const net = require('net');
const util = require('util');
const crypto = require('crypto');
const stream = require('stream');

const Key = require('./key');
const Message = require('./message');
const Vector = require('./vector');

const P2P_INSTRUCTION = 0x00000020;

/**
 * An in-memory representation of a node in our network.
 * @param       {Vector} config - Initialization Vector for this peer.
 * @constructor
 */
function Peer (config) {
  this.config = Object.assign({
    address: '127.0.0.1',
    port: 7777
  }, config || {});

  this.stream = new stream.Transform({
    transform (chunk, encoding, callback) {
      console.log('TODO: parse as encrypted data:', chunk);
      callback(null, chunk);
    }
  });

  // this.stream.on('data', this._handler.bind(this));

  this.key = this.config.key || new Key();
  this.id = this.key.public.toString('hex');

  this.connections = {};

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.init();
}

util.inherits(Peer, Vector);

Peer.prototype._connect = function connect (address) {
  let self = this;
  let parts = address.split(':');

  console.log('registering peer:', address);

  self.connections[address] = new net.Socket();
  self.connections[address].connect(parts[1], parts[0], function () {
    let id = Buffer.from(self.id);
    let op = Buffer.from('HELLO');
    let hello = Buffer.concat([id, op]);
    console.log('hello msg:', hello);
    self.connections[address].write(hello);
  });
};

Peer.prototype._registerPeer = function registerPeer (socket) {
  let self = this;
  let id = [socket.remoteAddress, socket.remotePort].join(':');

  // console.log('[PEER]', 'registering peer:', id);

  socket.on('data', function handler (input) {
    let message = null;

    try {
      message = Message.fromRaw(input);
    } catch (E) {
      console.error('[PEER]', 'error parsing transaction:', E);
    }

    switch (message.type) {
      default:
        console.log('[PEER]', `unhandled message type "${message.type}"`);
        break;
      case P2P_INSTRUCTION:
        // TODO: use Fabric.Script / Fabric.Machine
        let stack = message.data.split(' ');
        switch (stack[1]) {
          case 'SIGN':
            let signature = self.key._sign(stack[0]);
            let buffer = Buffer.from(signature);

            let script = [buffer.toString('hex'), 'CHECKSIG'].join(' ');
            let message = Message.fromVector([P2P_INSTRUCTION, script]);
            let raw = message.asRaw();

            socket.write(raw);
            break;
          default:
            console.log('[PEER]', `unhandled instruction "${stack[1]}"`);
            break;
        }

        break;
    }
  });

  this.connections[id] = socket;
};

Peer.prototype.broadcast = function message (message) {
  this.emit('message', message);
};

Peer.prototype.listen = function listen () {
  this.server = net.createServer(this._registerPeer.bind(this));
  this.server.listen(this.config.port, this.config.address);
  this.address = this.config.address;
  this.port = this.config.port;
};

Peer.prototype.stop = function stop () {
  this.server.close();
};

module.exports = Peer;
