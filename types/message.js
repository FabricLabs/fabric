'use strict';

const {
  MAGIC_BYTES,
  VERSION_NUMBER,
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  OP_CYCLE,
  LOG_MESSAGE_TYPE,
  GENERIC_LIST_TYPE,
  P2P_GENERIC,
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_ROOT,
  P2P_PING,
  P2P_PONG,
  P2P_START_CHAIN,
  P2P_INSTRUCTION,
  P2P_BASE_MESSAGE,
  P2P_CHAIN_SYNC_REQUEST,
  P2P_STATE_ROOT,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_STATE_REQUEST,
  P2P_TRANSACTION,
  P2P_CALL,
  CHAT_MESSAGE,
  BLOCK_CANDIDATE,
  PEER_CANDIDATE,
  SESSION_START
} = require('../constants');

const crypto = require('crypto');
const struct = require('struct');
const Vector = require('./vector');
const padDigits = require('../functions/padDigits');

/**
 * The {@link Message} type defines the Application Messaging Protocol, or AMP.
 * Each {@link Actor} in the network receives and broadcasts messages,
 * selectively disclosing new routes to peers which may have open circuits.
 * @type {Object}
 */
class Message extends Vector {
  /**
   * The `Message` type is standardized in {@link Fabric} as a {@link Vector}, which can be added to any other vector to compute a resulting state.
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
      Uint256: this.Uint256,
      data: null
    };

    this.raw.magic.write(`${MAGIC_BYTES.toString(16)}`, 'hex');
    this.raw.version.write(`${padDigits(VERSION_NUMBER.toString(16), 8)}`, 'hex');

    if (input.data) {
      this.data = JSON.stringify(input.data);
    }

    if (input.type) {
      this.type = input.type;
    }

    return this;
  }

  get body () {
    return this.raw.data;
  }

  get byte () {
    let input = 0 + '';
    let num = Buffer.from(`0x${padDigits(input, 8)}`, 'hex');
    return num;
  }

  get tu16 () {
    return parseInt(0);
  }

  get tu32 () {
    return parseInt(0);
  }

  get tu64 () {
    return parseInt(0);
  }

  get Uint256 () {
    // 256 bits
    return Buffer.from((this.raw && this.raw.hash) ? `0x${padDigits(this.raw.hash, 8)}` : crypto.randomBytes(32));
  }

  /**
   * Returns a {@link Buffer} of the complete message.
   * @return {Buffer} Buffer of the encoded {@link Message}.
   */
  asRaw () {
    return Buffer.concat([this.header, this.raw.data]);
  }

  toRaw () {
    return Buffer.from(this.asRaw());
  }

  asTypedArray () {
    return new Uint8Array(this.asRaw());
    // TODO: Node 12
    // return new TypedArray(this.asRaw());
  }

  asBlob () {
    return this.asRaw().map(byte => parseInt(byte, 16));
  }

  toObject () {
    return {
      headers: {
        magic: parseInt(`0x${this.raw.magic.toString('hex')}`, 16),
        version: parseInt(`${this.raw.version.toString('hex')}`, 16),
        type: parseInt(`${this.raw.type.toString('hex')}`, 16),
        size: parseInt(`${this.raw.size.toString('hex')}`, 16),
        hash: this.raw.hash.toString('hex')
      },
      type: this.type,
      data: this.data
    };
  }

  fromObject (input) {
    return new Message(input);
  }

  static parseBuffer (buffer) {
    const message = struct()
      .charsnt('magic', 4, 'hex')
      .charsnt('version', 4, 'hex')
      .charsnt('type', 4, 'hex')
      .charsnt('size', 4, 'hex')
      .charsnt('hash', 32, 'hex')
      .charsnt('data', buffer.length - HEADER_SIZE);

    message.allocate();
    message._setBuff(buffer);

    return message;
  }

  static fromBuffer (buffer) {
    const parsed = Message.parseBuffer(buffer);
    return Message.fromRaw(parsed.buffer());
  }

  static fromRaw (input) {
    if (!input) return null;
    // if (input.length < HEADER_SIZE) return null;
    // if (input.length > MAX_MESSAGE_SIZE) return new Error('Input too large.');

    const message = new Message();

    try {
      if (input instanceof String) input = Buffer.from([input], 'hex');
      let obj = JSON.parse(input.toString('utf8'));
      return new Message(obj);
    } catch (E) {
      // console.warn('[FABRIC:MESSAGE]', 'Could not parse string as JSON:', input.toString('utf8'), E);
    }

    if (input.headers) {
      message.raw = {
        magic: parseInt(input.headers['magic'], 10),
        version: parseInt(input.headers['version'], 10),
        type: parseInt(input.headers['type'], 10),
        size: parseInt(input.headers['size'], 10),
        hash: parseInt(input.headers['hash'], 16)
      };

      message.data = Buffer.from(input.data, 'utf8');
    } else if (input instanceof Buffer) {
      let size = input.length - HEADER_SIZE;

      message.raw = {
        magic: input.slice(0, 4),
        version: input.slice(4, 8),
        type: input.slice(8, 12),
        size: input.slice(12, 16),
        hash: input.slice(16, 48)
      };

      message.data = input.slice(HEADER_SIZE, HEADER_SIZE + size);
    } else {
      let input = Buffer.from(input, 'hex');
      let size = input.length - HEADER_SIZE;

      // TODO: eliminate this type
      message['@type'] = 'rarifiedHex';
      message.raw = {
        magic: input.slice(0, 4),
        version: input.slice(4, 8),
        type: input.slice(8, 12),
        size: input.slice(12, 16),
        hash: input.slice(16, 48)
      };

      message.data = input.slice(HEADER_SIZE, HEADER_SIZE + size);
    }

    return message;
  }

  static fromVector (vector = ['LogMessage', 'No vector provided.']) {
    let message = null;

    try {
      message = new Message({
        type: vector[0],
        data: vector[1]
      });
    } catch (exception) {
      console.error('[FABRIC:MESSAGE]', 'Could not construct Message:', exception);
    }

    return message;
  }

  /* get [Symbol.toStringTag] () {
    return `<Message | ${JSON.stringify(this.raw)}>`;
  } */

  get id () {
    return crypto.createHash('sha256').update(this.asRaw()).digest('hex');
  }

  get types () {
    // Message Types
    return {
      'GenericMessage': LOG_MESSAGE_TYPE,
      'GenericLogMessage': LOG_MESSAGE_TYPE,
      'GenericList': GENERIC_LIST_TYPE,
      'GenericQueue': GENERIC_LIST_TYPE,
      'FabricLogMessage': LOG_MESSAGE_TYPE,
      'FabricServiceLogMessage': LOG_MESSAGE_TYPE,
      'GenericTransferQueue': GENERIC_LIST_TYPE,
      // TODO: document Generic type
      // P2P Commands
      'Generic': P2P_GENERIC,
      'Cycle': OP_CYCLE,
      'IdentityRequest': P2P_IDENT_REQUEST,
      'IdentityResponse': P2P_IDENT_RESPONSE,
      'ChainSyncRequest': P2P_CHAIN_SYNC_REQUEST,
      // TODO: restore this type
      // 'StateRoot': P2P_ROOT,
      'Ping': P2P_PING,
      'Pong': P2P_PONG,
      'BlockCandidate': BLOCK_CANDIDATE,
      'PeerCandidate': PEER_CANDIDATE,
      'PeerInstruction': P2P_INSTRUCTION,
      'PeerMessage': P2P_BASE_MESSAGE,
      'StartSession': SESSION_START,
      'ChatMessage': CHAT_MESSAGE,
      'StartChain': P2P_START_CHAIN,
      // TODO: restore above StateRoot type
      'StateRoot': P2P_STATE_ROOT,
      'StateCommitment': P2P_STATE_COMMITTMENT,
      'StateChange': P2P_STATE_CHANGE,
      'StateRequest': P2P_STATE_REQUEST,
      'Transaction': P2P_TRANSACTION,
      'Call': P2P_CALL,
      'LogMessage': LOG_MESSAGE_TYPE,
    };
  }

  get codes () {
    return Object.entries(this.types).reduce((ret, entry) => {
      const [ key, value ] = entry;
      ret[ value ] = key;
      return ret;
    }, {});
  }

  get magic () {
    return this.raw.magic;
  }

  get size () {
    return parseInt(Buffer.from(this.raw.size, 'hex'));
  }

  get version () {
    return parseInt(Buffer.from(this.raw.version));
  }

  get header () {
    let parts = [
      Buffer.from(this.raw.magic, 'hex'),
      Buffer.from(this.raw.version, 'hex'),
      Buffer.from(this.raw.type, 'hex'),
      Buffer.from(this.raw.size, 'hex'),
      Buffer.from(this.raw.hash, 'hex')
    ];

    return Buffer.concat(parts);
  }
}

Object.defineProperty(Message.prototype, 'type', {
  get () {
    const code = parseInt(this.raw.type.toString('hex'), 16);
    switch (code) {
      default:
        // console.warn('[FABRIC:MESSAGE]', "Unhandled message type:", code);
        return 'GenericMessage';
      case LOG_MESSAGE_TYPE:
        return `GenericLogMessage`;
      case BLOCK_CANDIDATE:
        return 'BlockCandidate';
      case OP_CYCLE:
        return 'Cycle';
      case P2P_PING:
        return 'Ping';
      case P2P_PONG:
        return 'Pong';
      case P2P_GENERIC:
        return 'Generic';
      case P2P_CHAIN_SYNC_REQUEST:
        return 'ChainSyncRequest';
      case P2P_IDENT_REQUEST:
        return 'IdentityRequest';
      case P2P_IDENT_RESPONSE:
        return 'IdentityResponse';
      case P2P_BASE_MESSAGE:
        return 'PeerMessage';
      case P2P_STATE_ROOT:
        return 'StateRoot';
      case P2P_STATE_CHANGE:
        return 'StateChange';
      case P2P_STATE_REQUEST:
        return 'StateRequest';
      case P2P_TRANSACTION:
        return 'Transaction';
      case P2P_CALL:
        return 'Call';
      case PEER_CANDIDATE:
        return 'PeerCandidate';
      case SESSION_START:
        return 'StartSession';
      case CHAT_MESSAGE:
        return 'ChatMessage';
      case P2P_START_CHAIN:
        return 'StartChain';
    }
  },
  set (value) {
    let code = this.types[value];

    // Default to GenericMessage;
    if (!code) {
      this.emit('warning', `Unknown message type: ${value}`);
      code = this.types['GenericMessage'];
    }

    const padded = padDigits(code.toString(16), 8);
    this['@type'] = value;
    this.raw.type.write(padded, 'hex');
  }
});

Object.defineProperty(Message.prototype, 'data', {
  get () {
    if (!this.raw.data) return '';
    return this.raw.data.toString('utf8');
  },
  set (value) {
    if (!value) value = '';
    const hash = crypto.createHash('sha256').update(value.toString('utf8'));
    this.raw.hash = hash.digest();
    this.raw.data = Buffer.from(value);
    this.raw.size.write(padDigits(this.raw.data.byteLength.toString(16), 8), 'hex');
  }
});

module.exports = Message;
