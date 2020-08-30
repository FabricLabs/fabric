'use strict';

const {
  HEADER_SIZE,
  MAGIC_BYTES,
  MAX_MESSAGE_SIZE
} = require('../constants');

const EventEmitter = require('events').EventEmitter;
const Message = require('./message');

class Reader extends EventEmitter {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({}, settings);

    this.queue = [];
    this.frame = Buffer.alloc(MAX_MESSAGE_SIZE);

    return this;
  }

  get _bufferedBytes () {
    return this.queue.length;
  }

  _addData (data) {
    for (let i = 0; i < data.length; i++) {
      this.queue.push(data[i]);
    }

    this._readFrame();
  }

  _readBytes (count) {
    let bytes = [];

    for (let i = 0; i < count; i++) {
      bytes.push(this.queue[i]);
    }

    return bytes;
  }

  _takeBytes (count) {
    let bytes = [];

    for (let i = 0; i < count; i++) {
      bytes.push(this.queue.shift());
    }

    return bytes;
  }

  _readFrame () {
    if (this._bufferedBytes < HEADER_SIZE) return;

    const header = this._readBytes(HEADER_SIZE);
    const magic = parseInt(Buffer.from(header.slice(0, 4), 'hex').toString('hex'), 16);
    const version = parseInt(Buffer.from(header.slice(4, 8), 'hex').toString('hex'), 16);
    const type = parseInt(Buffer.from(header.slice(8, 12), 'hex').toString('hex'), 16);
    const size = parseInt(Buffer.from(header.slice(12, 16), 'hex').toString('hex'), 16);

    if (magic !== MAGIC_BYTES) {
      throw new Error('Header not magic:', magic, '!==', MAGIC_BYTES);
    }

    if (this._bufferedBytes < HEADER_SIZE + size) return;

    const frame = Buffer.from(this._takeBytes(HEADER_SIZE + size), 'hex');
    const message = Message.parseBuffer(frame);

    this.emit('message', message.buffer());
  }
}

module.exports = Reader;