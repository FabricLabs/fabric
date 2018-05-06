'use strict';

const crypto = require('crypto');
const Vector = require('./vector');

const MAGIC_BYTES = 0xC0D3F33D;
const VERSION_NUMBER = 0x01;

const HEADER_SIZE = 48;
const MAX_MESSAGE_SIZE = 4096 - HEADER_SIZE;

class Message extends Vector {
  /**
   * The `Message` type is standardized in {@link Fabric} as a {@link Vector}, which can be added to any other vector to computer a resulting state.
   * @param  {Vector} message Message vector.  Will be serialized by {@link Vector#_serialize}.
   * @return {Vector} Instance of the message.
   */
  constructor (input = {}) {
    super(input);

    this.raw = {
      magic: Buffer.alloc(4),
      version: Buffer.alloc(4),
      type: Buffer.alloc(4),
      size: Buffer.alloc(4),
      hash: Buffer.alloc(32),
      data: null
    };

    this.raw.magic.writeUInt32BE(MAGIC_BYTES);
    this.raw.version.writeUInt32BE(VERSION_NUMBER);

    this.init();
  }

  asRaw () {
    return Buffer.concat([this.header, this.raw.data]);
  }

  static fromRaw (input) {
    if (!input) return null;
    if (input.length < HEADER_SIZE) return null;
    if (input.length > MAX_MESSAGE_SIZE) return new Error('Input too large.');

    let message = new Message();

    message.raw = {
      magic: input.slice(0, 4),
      version: input.slice(4, 8),
      type: input.slice(8, 12),
      size: input.slice(12, 16),
      hash: input.slice(16, 48)
    };

    if (message.raw.size) {
      let size = message.raw.size.readUInt32BE();
      message.data = input.slice(HEADER_SIZE, HEADER_SIZE + size);
    }

    return message;
  }

  static fromVector (vector) {
    let message = new Message();

    message.type = vector[0];
    message.data = vector[1];

    return message;
  }

  get [Symbol.toStringTag] () {
    return 'Message';
  }

  get id () {
    return crypto.createHash('sha256').update(this.asRaw()).digest('hex');
  }

  get magic () {
    return this.raw.magic;
  }

  get size () {
    return this.raw.size.readUInt32BE();
  }

  get version () {
    return this.raw.version.readUInt32BE();
  }

  get header () {
    return Buffer.concat([
      this.raw.magic,
      this.raw.version,
      this.raw.type,
      this.raw.size,
      this.raw.hash
    ]);
  }
}

Object.defineProperty(Message.prototype, 'type', {
  get () {
    return this.raw.type.readUInt32BE();
  },
  set (value) {
    this.raw.type.writeUInt32BE(value);
  }
});

Object.defineProperty(Message.prototype, 'data', {
  get () {
    if (!this.raw.data) return '';
    return this.raw.data.toString('ascii');
  },
  set (value) {
    if (!value) value = '';
    let hash = crypto.createHash('sha256').update(value.toString('ascii'));
    this.raw.hash = hash.digest();
    this.raw.data = Buffer.from(value);
    this.raw.size.writeUInt32BE(this.raw.data.byteLength);
  }
});

module.exports = Message;
export default Message;
