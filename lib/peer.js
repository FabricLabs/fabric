'use strict';

const net = require('net');
const util = require('util');
const crypto = require('crypto');
const stream = require('stream');

const Key = require('./key');
const Message = require('./message');
const Vector = require('./vector');

const P2P_ROOT = 0x00000000;
const P2P_PING = 0x00000012; // same ID as Lightning (18)
const P2P_PONG = 0x00000013; // same ID as Lightning (19)
const P2P_INSTRUCTION = 0x00000020;
const P2P_STATE_COMMITTMENT = 0x00000032;

const OP_ADD = 0x93;

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
  this.hex = this.key.public.encodeCompressed('hex');
  this.id = crypto.createHash('sha256').update(this.hex).digest('hex');

  this.address = this.config.address;
  this.port = this.config.port;

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

  if (parts.length !== 2) return console.error('Invalid address:', address);

  self.connections[address] = new net.Socket();
  self.connections[address].connect(parts[1], parts[0], function () {
    let id = Buffer.from(self.id);
    let message = Message.fromVector([P2P_PING]);

    // self.connections[address].write(message.asRaw());
  });
};

Peer.prototype._registerPeer = function registerPeer (socket) {
  let self = this;
  let id = [socket.remoteAddress, socket.remotePort].join(':');

  // console.log('[PEER]', 'registering peer:', id);

  socket.on('data', function handler (input) {
    let message = null;
    let response = null;

    try {
      message = Message.fromRaw(input);
    } catch (E) {
      console.error('[PEER]', 'error parsing transaction:', E);
    }

    if (!message) return socket.destroy();

    switch (message.type) {
      default:
        console.log('[PEER]', `unhandled message type "${message.type}"`);
        break;
      case P2P_PING:
        response = Message.fromVector([P2P_PONG, message.id]);
        break;
      case P2P_INSTRUCTION:
        // TODO: use Fabric.Script / Fabric.Machine
        let stack = message.data.split(' ');
        switch (stack[1]) {
          case 'SIGN':
            let signature = self.key._sign(stack[0]);
            let buffer = Buffer.from(signature);
            let script = [buffer.toString('hex'), 'CHECKSIG'].join(' ');

            response = Message.fromVector([P2P_INSTRUCTION, script]);
            break;
          default:
            console.log('[PEER]', `unhandled instruction "${stack[1]}"`);
            break;
        }

        break;
    }

    socket.write(response.asRaw());
  });

  this.connections[id] = socket;
};

Peer.prototype.broadcast = function message (message) {
  this.emit('message', message);
};

Peer.prototype.listen = function listen () {
  let self = this;
  self.server = net.createServer(self._registerPeer.bind(self));
  self.server.listen(self.config.port, self.config.address, function () {
    if (self.config.debug) {
      console.log('[PEER]', `${self.id} now listening on tcp://${self.address}:${self.port}`);
    }
    self.emit('ready');
  });
  return self;
};

Peer.prototype.stop = function stop () {
  this.server.close();
};

module.exports = Peer;
