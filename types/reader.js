'use strict';

const {
  HEADER_SIZE,
  MAGIC_BYTES,
  MAX_MESSAGE_SIZE
} = require('../constants');

const merge = require('lodash.merge');
const EventEmitter = require('events').EventEmitter;
const Message = require('./message');

/**
 * Read from a byte stream, seeking valid Fabric messages.
 */
class Reader extends EventEmitter {
  /**
   * Create an instance of a {@link Reader}, which can listen to a byte stream
   * for valid Fabric messages.
   * @param {Object} settings Settings for the stream.
   * @returns {Reader}
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      constraints: {
        frame: {
          size: MAX_MESSAGE_SIZE
        }
      }
    }, settings);

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

    this._readFabricFrame();
  }

  _addBytes (data) {
    for (let i = 0; i < data.length; i++) {
      this.queue.push(data[i]);
    }
  }

  _readBytes (count) {
    const bytes = [];

    for (let i = 0; i < count; i++) {
      bytes.push(this.queue[i]);
    }

    return bytes;
  }

  _takeBytes (count) {
    const bytes = [];

    for (let i = 0; i < count; i++) {
      bytes.push(this.queue.shift());
    }

    return bytes;
  }

  _promiseBytes (count = 1) {
    const self = this;
    return new Promise((resolve, reject) => {
      const bytes = self._readBytes(count);
      return resolve(bytes);
    });
  }

  _readFrame (size = 1) {
    const bytes = this._readBytes(size);
    this.emit('candidate', bytes);
    return bytes;
  }

  _readFabricFrame () {
    if (this._bufferedBytes < HEADER_SIZE) return;

    // Read up to HEADER_SIZE bytes
    const header = this._readBytes(HEADER_SIZE);
    const parts = [];

    // Segment the header bytes
    parts.push(header.slice(0, 4)); // magic
    parts.push(header.slice(4, 8)); // version
    parts.push(header.slice(8, 40)); // parent
    parts.push(header.slice(40, 72)); // author
    parts.push(header.slice(72, 76)); // type
    parts.push(header.slice(76, 80)); // payload size
    parts.push(header.slice(80, 112)); // hash
    parts.push(header.slice(112, HEADER_SIZE)); // signature

    const map = parts.map((x) => Buffer.from(x, 'hex'));
    const elements = map.map((x) => parseInt(x.toString('hex'), 16));

    // Read header
    const magic = elements[0];
    const version = elements[1];
    const parent = elements[2];
    const author = elements[3];
    const type = elements[4];
    const size = elements[5];
    const signature = elements[6];
    const hash = elements[7];

    if (magic !== MAGIC_BYTES) {
      throw new Error(`Header not magic: ${magic} !== ${MAGIC_BYTES}`);
    }

    // Defer to next call (not enough data)
    if (this._bufferedBytes < HEADER_SIZE + size) return;

    // Take extra data
    const data = this._takeBytes(HEADER_SIZE + size);
    const frame = Buffer.from(data, 'hex');

    // Provide data for debugger
    const proposal = {
      magic,
      version,
      type,
      size,
      data
    };

    // this.emit('debug', `Reader Proposal: ${JSON.stringify(proposal, null, '  ')}`);
    this.emit('message', frame);
  }
}

module.exports = Reader;
