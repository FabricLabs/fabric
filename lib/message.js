'use strict';

const crypto = require('crypto');
const Vector = require('./vector');

const MAGIC_BYTES = 0xC0D3F33D;
const P2P_INSTRUCTION = 0x00000020;

const HEADER_SIZE = 44;
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
      type: Buffer.alloc(4),
      size: Buffer.alloc(4),
      hash: Buffer.alloc(32),
      data: null
    };

    this.raw.magic.writeUInt32BE(MAGIC_BYTES);

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
      type: input.slice(4, 8),
      size: Buffer.alloc(8, 12),
      hash: input.slice(12, 44)
    };

    message.size = message.raw.size.readUInt32BE();
    message.data = input.slice(44, message.size).toString();

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
}

Object.defineProperty(Message.prototype, 'type', {
  get () {
    return this.raw.type.readUInt32BE();
  },
  set (value) {
    this.raw.type.writeUInt32BE(value);
  }
});

Object.defineProperty(Message.prototype, 'header', {
  get () {
    return Buffer.concat([
      this.raw.magic,
      this.raw.type,
      this.raw.size,
      this.raw.hash
    ]);
  }
});

Object.defineProperty(Message.prototype, 'data', {
  get () {
    return this.raw.data.toString('ascii');
  },
  set (value) {
    if (!value) value = '';
    this.raw.hash = crypto.createHash('sha256').update(value).digest();
    this.raw.data = Buffer.from(value);
    this.raw.size.writeUInt32BE(this.raw.data.byteLength);
  }
});

module.exports = Message;
export default Message;
