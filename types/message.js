'use strict';

const {
  MAGIC_BYTES,
  VERSION_NUMBER,
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  OP_CYCLE,
  GENERIC_MESSAGE_TYPE,
  LOG_MESSAGE_TYPE,
  GENERIC_LIST_TYPE,
  BITCOIN_BLOCK_TYPE,
  BITCOIN_BLOCK_HASH_TYPE,
  BITCOIN_TRANSACTION_TYPE,
  BITCOIN_TRANSACTION_HASH_TYPE,
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
  P2P_RELAY,
  P2P_MESSAGE_RECEIPT,
  CHAT_MESSAGE,
  DOCUMENT_PUBLISH_TYPE,
  DOCUMENT_REQUEST_TYPE,
  JSON_CALL_TYPE,
  PATCH_MESSAGE_TYPE,
  CONTRACT_PROPOSAL_TYPE,
  BLOCK_CANDIDATE,
  PEER_CANDIDATE,
  SESSION_START,
  // Lightning message codes
  LIGHTNING_WARNING,
  LIGHTNING_INIT,
  LIGHTNING_ERROR,
  LIGHTNING_PING,
  LIGHTNING_PONG,
  LIGHTNING_OPEN_CHANNEL,
  LIGHTNING_ACCEPT_CHANNEL,
  LIGHTNING_FUNDING_CREATED,
  LIGHTNING_FUNDING_SIGNED,
  LIGHTNING_CHANNEL_READY,
  LIGHTNING_SHUTDOWN,
  LIGHTNING_CLOSING_SIGNED,
  LIGHTNING_UPDATE_ADD_HTLC,
  LIGHTNING_UPDATE_FULFILL_HTLC,
  LIGHTNING_UPDATE_FAIL_HTLC,
  LIGHTNING_COMMITMENT_SIGNED,
  LIGHTNING_REVOKE_AND_ACK,
  LIGHTNING_CHANNEL_ANNOUNCEMENT,
  LIGHTNING_NODE_ANNOUNCEMENT,
  LIGHTNING_CHANNEL_UPDATE
} = require('../constants');

const HEADER_SIG_SIZE = 64;

/** @param {Buffer} buf */
function isAllZero32 (buf) {
  if (!buf || buf.length !== 32) return true;
  return buf.equals(Buffer.alloc(32));
}

// Dependencies
// const crypto = require('crypto');
const struct = require('struct');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Key = require('./key');

// Function Definitions
const padDigits = require('../functions/padDigits');
const taggedHash = require('../functions/taggedHash');

/**
 * The {@link Message} type defines the Application Messaging Protocol, or AMP.
 * Each {@link Actor} in the network receives and broadcasts messages,
 * selectively disclosing new routes to peers which may have open circuits.
 * @type {Object}
 */
class Message extends Actor {
  /**
   * The `Message` type is standardized in {@link Fabric} as a {@link Array}, which can be added to any other vector to compute a resulting state.
   * @param  {Object} message Message vector.  Will be serialized by {@link Array#_serialize}.
   * @return {Message} Instance of the message.
   */
  constructor (input = {}) {
    super(input);

    this.raw = {
      magic: Buffer.alloc(4),
      version: Buffer.alloc(4),
      parent: Buffer.alloc(32),
      author: Buffer.alloc(32),
      type: Buffer.alloc(4), // TODO: 8, 32
      size: Buffer.alloc(4), // TODO: 8, 32
      hash: Buffer.alloc(32),
      preimage: Buffer.alloc(32),
      signature: Buffer.alloc(64),
      data: null
    };

    this.raw.magic.write(MAGIC_BYTES.toString(16), 'hex');
    this.raw.version.write(padDigits(VERSION_NUMBER.toString(16), 8), 'hex');

    // Use provided signer
    if (input.signer) {
      this.signer = input.signer;
    } else {
      this.signer = null;
    }

    // Support both @type/@data (deprecated) and type/data (preferred) formats
    const messageType = input.type || input['@type'];
    const messageData = input.data || input['@data'];

    if (messageData && messageType) {
      this.type = messageType;
      // Set the type field to the numeric constant
      const typeCode = this.types[messageType] || GENERIC_MESSAGE_TYPE;
      this.raw.type.writeUInt32BE(typeCode, 0);

      if (typeof messageData !== 'string') {
        this.data = JSON.stringify(messageData);
      } else {
        this.data = messageData;
      }
    }

    if (input.preimage != null) this.preimage = input.preimage;

    // Log HEARTBEAT message creation to track origin
    if (this.type === 'HEARTBEAT' || messageType === 'HEARTBEAT') {
      const hasSignature = input.signature || (this.raw.signature && this.raw.signature.toString('hex') !== '0'.repeat(128));
      const inputSummary = {
        type: input.type || input['@type'],
        hasType: !!(input.type || input['@type']),
        hasData: !!(input.data || input['@data']),
        hasSignature: !!hasSignature,
        inputKeys: Object.keys(input).filter(k => !k.startsWith('_') && k !== 'signer')
      };

      console.log('[FABRIC:MESSAGE]', '⚠️  HEARTBEAT message created:', {
        messageType: this.type || messageType,
        input: inputSummary,
        hasSignature: hasSignature,
        signatureHex: this.raw.signature ? this.raw.signature.toString('hex').substring(0, 16) + '...' : 'none'
      });
      console.trace('[FABRIC:MESSAGE]', 'HEARTBEAT creation stack trace:');
    }

    // Set various properties to be unenumerable
    for (let name of [
      '@input',
      '@entity',
      '_state',
      'config',
      'settings',
      'signer',
      'stack',
      'observer'
    ]) Object.defineProperty(this, name, { enumerable: false });

    return this;
  }

  get author () {
    return this.raw.author.toString('hex');
  }

  get body () {
    return this.raw.data.toString('utf8');
  }

  get byte () {
    const input = 0 + '';
    const num = Buffer.from(`0x${padDigits(input, 8)}`, 'hex');
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
    return Buffer.from((this.raw && this.raw.hash) ? `0x${padDigits(this.raw.hash, 8)}` : Actor.randomBytes(32));
  }

  set signature (value) {
    if (value instanceof Buffer) value = value.toString('hex');
    this.raw.signature.write(value, 'hex');
  }

  /**
   * Optional 32-byte preimage (e.g. HTLC secret). `null` when unset / public (all-zero on wire).
   */
  get preimage () {
    if (!this.raw || !Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) return null;
    if (isAllZero32(this.raw.preimage)) return null;
    return Buffer.from(this.raw.preimage);
  }

  set preimage (value) {
    if (!this.raw.preimage || !Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) {
      this.raw.preimage = Buffer.alloc(32);
    }
    if (value === null || value === undefined) {
      this.raw.preimage.fill(0);
      return;
    }
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'hex');
    if (buf.length !== 32) throw new Error('Message preimage must be 32 bytes');
    buf.copy(this.raw.preimage);
  }

  toBuffer () {
    return this.asRaw();
  }

  /**
   * Returns a {@link Buffer} of the complete message.
   * @return {Buffer} Buffer of the encoded {@link Message}.
   */
  asRaw () {
    return Buffer.concat([this.header, this.raw.data]);
  }

  toRaw () {
    return this.asRaw();
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
        magic: parseInt(`${this.raw.magic.toString('hex')}`, 16),
        version: parseInt(`${this.raw.version.toString('hex')}`, 16),
        parent: this.raw.parent.toString('hex'),
        author: this.raw.author.toString('hex'),
        type: parseInt(`${this.raw.type.toString('hex')}`, 16),
        size: parseInt(`${this.raw.size.toString('hex')}`, 16),
        hash: this.raw.hash.toString('hex'),
        preimage: this.preimage ? this.preimage.toString('hex') : null,
        signature: this.raw.signature.toString('hex'),
      },
      type: this.type,
      data: this.data
    };
  }

  toVector () {
    return [this.type, this.data];
  }

  fromObject (input) {
    return new Message(input);
  }

  /**
   * Signs the message using a specific key.
   * Uses BIP-340 Schnorr signatures with tagged hash "Fabric/Message".
   * Signs the complete message (header + body) as per C implementation.
   *
   * @param {Object} key Key object with private key and sign method.
   * @param {String|Buffer} key.private Private key
   * @param {String|Buffer} key.pubkey Public key
   * @param {Function} key.sign Signing function
   * @returns {Message} Signed message.
   * @throws {Error} If attempting to sign without a private key
   */
  signWithKey (key) {
    if (!key) throw new Error('No key provided.');
    if (!key.private) throw new Error('Cannot sign message with public key only.');
    if (!key.sign) throw new Error('Key object must implement sign method');

    // Extract x-only public key (32 bytes) from compressed pubkey (33 bytes)
    // This matches the C implementation which uses secp256k1_xonly_pubkey_serialize
    const compressedPubkey = Buffer.from(key.public.encodeCompressed('hex'), 'hex');
    const xOnlyPubkey = compressedPubkey.slice(1); // Remove prefix byte (first byte)

    // Set author field BEFORE signing so it's included in the signed data
    // Write x-only pubkey to author field (32 bytes = 64 hex chars)
    this.raw.author.write(xOnlyPubkey.toString('hex'), 'hex');

    // Create header with signature field zeroed (as it would be during signing)
    // The C implementation includes the signature field in offsetof(Message, body),
    // but it's zero/uninitialized when signing, so we zero it
    const zeroedSignature = Buffer.alloc(64); // 64 bytes of zeros
    const pre = Buffer.isBuffer(this.raw.preimage)
      ? this.raw.preimage
      : Buffer.from(this.raw.preimage || '', 'hex');
    if (pre.length !== 32) throw new Error('Message preimage must be 32 bytes on wire');
    const headerForHash = Buffer.concat([
      Buffer.from(this.raw.magic, 'hex'),
      Buffer.from(this.raw.version, 'hex'),
      Buffer.from(this.raw.parent, 'hex'),
      Buffer.from(this.raw.author, 'hex'),
      Buffer.from(this.raw.type, 'hex'),
      Buffer.from(this.raw.size, 'hex'),
      Buffer.from(this.raw.hash, 'hex'),
      pre,
      zeroedSignature // Signature field zeroed for hash computation
    ]);

    // Create buffer with header (signature zeroed) + body
    // This matches the C implementation: memcpy(data_buffer, message, offsetof(Message, body))
    const dataBuffer = Buffer.concat([
      headerForHash,
      this.raw.data || Buffer.alloc(0)
    ]);

    // Compute tagged hash with "Fabric/Message" tag (BIP-340)
    // This matches: secp256k1_tagged_sha256(ctx, msghash, "Fabric/Message", data_buffer, data_size)
    const tag = 'Fabric/Message';
    const messageHash = taggedHash(tag, dataBuffer);

    // Sign the tagged hash using BIP-340 Schnorr
    // This matches: secp256k1_schnorrsig_sign32(ctx, signature, msghash, &keypair, NULL)
    // Use signSchnorrHash since we already have a pre-computed hash
    const signature = key.signSchnorrHash(messageHash);

    // Write signature (64 bytes = 128 hex chars)
    this.raw.signature.write(signature.toString('hex'), 'hex');

    return this;
  }

  sign () {
    if (!this.signer) throw new Error('No signer available.');
    if (!this.signer.private) throw new Error('Cannot sign message with public key only.');
    if (!this.signer.sign) throw new Error('Signer must implement sign method');

    return this.signWithKey(this.signer);
  }

  /**
   * Verify a message's signature.
   * @returns {Boolean} `true` if the signature is valid, `false` if not.
   */
  verify () {
    if (!this.header) throw new Error('No header property.');
    if (!this.raw) throw new Error('No raw property.');
    if (!this.signer) throw new Error('No signer available.');
    if (!this.signer.verify) throw new Error('Signer must implement verify method');

    return this.verifyWithKey(this.signer);
  }

  /**
   * Verify a message's signature with a specific key.
   * Uses BIP-340 Schnorr signature verification with tagged hash "Fabric/Message".
   * Verifies the complete message (header + body) as per C implementation.
   *
   * @param {Object} key Key object with verify method.
   * @param {Function} key.verify Verification function
   * @returns {Boolean} `true` if the signature is valid, `false` if not.
   */
  verifyWithKey (key) {
    if (!this.header) throw new Error('No header property.');
    if (!this.raw) throw new Error('No raw property.');
    if (!key) throw new Error('No key provided.');
    if (!key.verify) throw new Error('Key object must implement verify method');

    // Parse x-only pubkey from author field (32 bytes = 64 hex chars)
    // This matches the C implementation which uses secp256k1_xonly_pubkey_parse
    const authorHex = this.raw.author.toString('hex');
    if (authorHex.length !== 64) {
      throw new Error(`Invalid author field length: expected 64 hex chars (32 bytes), got ${authorHex.length}`);
    }
    const xOnlyPubkeyFromAuthor = Buffer.from(authorHex, 'hex');

    // Get x-only pubkey from the provided key for comparison
    // This allows us to verify using the key directly instead of reconstructing
    const compressedPubkeyFromKey = Buffer.from(key.public.encodeCompressed('hex'), 'hex');
    const xOnlyPubkeyFromKey = compressedPubkeyFromKey.slice(1);

    // Verify that the author field matches the key's x-only pubkey
    if (!xOnlyPubkeyFromAuthor.equals(xOnlyPubkeyFromKey)) {
      return false;
    }

    // Create header with signature field zeroed (as it would be during signing)
    // The C implementation includes the signature field in offsetof(Message, body),
    // but it's zero/uninitialized when signing, so we zero it for verification
    const zeroedSignature = Buffer.alloc(64); // 64 bytes of zeros
    const pre = Buffer.isBuffer(this.raw.preimage)
      ? this.raw.preimage
      : Buffer.from(this.raw.preimage || '', 'hex');
    if (pre.length !== 32) throw new Error('Message preimage must be 32 bytes on wire');
    const headerForHash = Buffer.concat([
      Buffer.from(this.raw.magic, 'hex'),
      Buffer.from(this.raw.version, 'hex'),
      Buffer.from(this.raw.parent, 'hex'),
      Buffer.from(this.raw.author, 'hex'),
      Buffer.from(this.raw.type, 'hex'),
      Buffer.from(this.raw.size, 'hex'),
      Buffer.from(this.raw.hash, 'hex'),
      pre,
      zeroedSignature // Signature field zeroed for hash computation
    ]);

    // Create buffer with header (signature zeroed) + body
    // This matches the C implementation: memcpy(data_buffer, message, offsetof(Message, body))
    const dataBuffer = Buffer.concat([
      headerForHash,
      this.raw.data || Buffer.alloc(0)
    ]);

    // Compute tagged hash with "Fabric/Message" tag (BIP-340)
    const tag = 'Fabric/Message';
    const messageHash = taggedHash(tag, dataBuffer);

    // Get signature
    const signature = this.raw.signature;
    const sigBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature.toString('hex'), 'hex');

    // Use the provided key's verifySchnorrHash method directly
    // This avoids needing to reconstruct the key from the author field
    return key.verifySchnorrHash(messageHash, sigBuffer);
  }

  /**
   * Sets the signer for the message.
   * @param {Object} key Key object with pubkey property.
   * @param {String|Buffer} key.pubkey Public key
   * @returns {Message} Instance of the Message with associated signer.
   */
  _setSigner (key) {
    if (!key || !key.pubkey) {
      throw new Error('Key object with pubkey is required');
    }

    this.signer = key;
    return this;
  }

  static parseBuffer (buffer) {
    const message = struct()
      .charsnt('magic', 4, 'hex')
      .charsnt('version', 4, 'hex')
      .charsnt('parent', 32, 'hex')
      .charsnt('author', 32, 'hex')
      .charsnt('type', 4, 'hex')
      .charsnt('size', 4, 'hex')
      .charsnt('hash', 32, 'hex')
      .charsnt('preimage', 32, 'hex')
      .charsnt('signature', 64, 'hex')
      .charsnt('data', buffer.length - HEADER_SIZE);

    message.allocate();
    message._setBuff(buffer);

    return message;
  }

  static parseRawMessage (buffer) {
    const message = {
      magic: buffer.slice(0, 4),
      version: buffer.slice(4, 8),
      parent: buffer.slice(8, 40),
      author: buffer.slice(40, 72),
      type: buffer.slice(72, 76),
      size: buffer.slice(76, 80),
      hash: buffer.slice(80, 112),
      preimage: buffer.slice(112, 144),
      signature: buffer.slice(144, HEADER_SIZE)
    };

    if (buffer.length >= HEADER_SIZE) {
      message.data = buffer.slice(HEADER_SIZE, buffer.length);
    }

    return message;
  };

  static fromBuffer (buffer) {
    return Message.fromRaw(buffer);
  }

  static fromRaw (input) {
    if (!input) return null;
    // Convert various buffer-like inputs to Buffer
    let buffer;
    if (input instanceof Buffer) {
      buffer = input;
    } else if (input instanceof Uint8Array) {
      buffer = Buffer.from(input.buffer);
    } else if (input instanceof ArrayBuffer) {
      buffer = Buffer.from(input);
    } else if (input.buffer instanceof ArrayBuffer) {
      buffer = Buffer.from(input.buffer);
    } else {
      throw new Error('Input must be a buffer or buffer-like object.');
    }

    const message = new Message();
    const payload = buffer.subarray(HEADER_SIZE);
    message.raw = {
      magic: buffer.subarray(0, 4),
      version: buffer.subarray(4, 8),
      parent: buffer.subarray(8, 40),
      author: buffer.subarray(40, 72),
      type: buffer.subarray(72, 76),
      size: buffer.subarray(76, 80),
      hash: buffer.subarray(80, 112),
      preimage: buffer.subarray(112, 144),
      signature: buffer.subarray(144, HEADER_SIZE),
      data: payload
    };

    // Do not assign `message.data` here: the `data` setter recomputes `raw.hash`
    // (double-SHA256 of the body), which would replace the on-wire hash and break
    // `Peer._handleFabricMessage` body-integrity checks (C parity).

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
    return Hash256.digest(this.asRaw());
  }

  get types () {
    // Message Types
    return {
      'BitcoinBlock': BITCOIN_BLOCK_TYPE,
      'BitcoinBlockHash': BITCOIN_BLOCK_HASH_TYPE,
      'BitcoinTransaction': BITCOIN_TRANSACTION_TYPE,
      'BitcoinTransactionHash': BITCOIN_TRANSACTION_HASH_TYPE,
      'GenericMessage': GENERIC_MESSAGE_TYPE,
      'GenericLogMessage': LOG_MESSAGE_TYPE,
      'GenericList': GENERIC_LIST_TYPE,
      'GenericQueue': GENERIC_LIST_TYPE,
      'FabricLogMessage': LOG_MESSAGE_TYPE,
      'FabricServiceLogMessage': LOG_MESSAGE_TYPE,
      'GenericTransferQueue': GENERIC_LIST_TYPE,
      'JSONBlob': GENERIC_MESSAGE_TYPE + 1,
      'JSONCall': JSON_CALL_TYPE,
      'JSONPatch': PATCH_MESSAGE_TYPE,
      'ContractProposal': CONTRACT_PROPOSAL_TYPE,
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
      'DocumentRequest': DOCUMENT_REQUEST_TYPE,
      'DocumentPublish': DOCUMENT_PUBLISH_TYPE,
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
      'P2P_RELAY': P2P_RELAY,
      'P2P_MESSAGE_RECEIPT': P2P_MESSAGE_RECEIPT,
      'LogMessage': LOG_MESSAGE_TYPE,
      // Lightning (BOLT) types
      'AcceptChannel': LIGHTNING_ACCEPT_CHANNEL,
      'ChannelAnnouncement': LIGHTNING_CHANNEL_ANNOUNCEMENT,
      'ChannelReady': LIGHTNING_CHANNEL_READY,
      'ChannelUpdate': LIGHTNING_CHANNEL_UPDATE,
      'ClosingSigned': LIGHTNING_CLOSING_SIGNED,
      'CommitmentSigned': LIGHTNING_COMMITMENT_SIGNED,
      'FundingCreated': LIGHTNING_FUNDING_CREATED,
      'FundingSigned': LIGHTNING_FUNDING_SIGNED,
      'LightningError': LIGHTNING_ERROR,
      'LightningInit': LIGHTNING_INIT,
      'LightningPing': LIGHTNING_PING,
      'LightningPong': LIGHTNING_PONG,
      'LightningWarning': LIGHTNING_WARNING,
      'NodeAnnouncement': LIGHTNING_NODE_ANNOUNCEMENT,
      'OpenChannel': LIGHTNING_OPEN_CHANNEL,
      'RevokeAndAck': LIGHTNING_REVOKE_AND_ACK,
      'Shutdown': LIGHTNING_SHUTDOWN,
      'UpdateAddHTLC': LIGHTNING_UPDATE_ADD_HTLC,
      'UpdateFailHTLC': LIGHTNING_UPDATE_FAIL_HTLC,
      'UpdateFulfillHTLC': LIGHTNING_UPDATE_FULFILL_HTLC
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

  get signature () {
    return parseInt(Buffer.from(this.raw.signature, 'hex'));
  }

  get size () {
    return parseInt(Buffer.from(this.raw.size, 'hex'));
  }

  get version () {
    return parseInt(Buffer.from(this.raw.version));
  }

  get header () {
    if (!Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) {
      throw new Error('Message raw.preimage must be a 32-byte Buffer');
    }
    const parts = [
      Buffer.from(this.raw.magic, 'hex'),
      Buffer.from(this.raw.version, 'hex'),
      Buffer.from(this.raw.parent, 'hex'),
      Buffer.from(this.raw.author, 'hex'),
      Buffer.from(this.raw.type, 'hex'),
      Buffer.from(this.raw.size, 'hex'),
      Buffer.from(this.raw.hash, 'hex'),
      this.raw.preimage,
      Buffer.from(this.raw.signature, 'hex')
    ];

    return Buffer.concat(parts);
  }
}

Object.defineProperty(Message.prototype, 'type', {
  get () {
    const code = parseInt(this.raw.type.toString('hex'), 16);
    switch (code) {
      case BITCOIN_BLOCK_TYPE:
        return 'BitcoinBlock';
      case BITCOIN_BLOCK_HASH_TYPE:
        return 'BitcoinBlockHash';
      case BITCOIN_TRANSACTION_TYPE:
        return 'BitcoinTransaction';
      case BITCOIN_TRANSACTION_HASH_TYPE:
        return 'BitcoinTransactionHash';
      case GENERIC_MESSAGE_TYPE:
        return 'GenericMessage';
      case GENERIC_MESSAGE_TYPE + 1:
        return 'JSONBlob';
      case LOG_MESSAGE_TYPE:
        return 'GenericLogMessage';
      case GENERIC_LIST_TYPE:
        return 'GenericList';
      case DOCUMENT_PUBLISH_TYPE:
        return 'DocumentPublish';
      case DOCUMENT_REQUEST_TYPE:
        return 'DocumentRequest';
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
      case P2P_RELAY:
        return 'P2P_RELAY';
      case P2P_MESSAGE_RECEIPT:
        return 'P2P_MESSAGE_RECEIPT';
      case PEER_CANDIDATE:
        return 'PeerCandidate';
      case SESSION_START:
        return 'StartSession';
      case CHAT_MESSAGE:
        return 'ChatMessage';
      case JSON_CALL_TYPE:
        return 'JSONCall';
      case PATCH_MESSAGE_TYPE:
        return 'JSONPatch';
      case CONTRACT_PROPOSAL_TYPE:
        return 'ContractProposal';
      case P2P_START_CHAIN:
        return 'StartChain';
      // Lightning (BOLT) types
      case LIGHTNING_WARNING:
        return 'LightningWarning';
      case LIGHTNING_INIT:
        return 'LightningInit';
      case LIGHTNING_ERROR:
        return 'LightningError';
      case LIGHTNING_PING:
        return 'LightningPing';
      case LIGHTNING_PONG:
        return 'LightningPong';
      case LIGHTNING_OPEN_CHANNEL:
        return 'OpenChannel';
      case LIGHTNING_ACCEPT_CHANNEL:
        return 'AcceptChannel';
      case LIGHTNING_FUNDING_CREATED:
        return 'FundingCreated';
      case LIGHTNING_FUNDING_SIGNED:
        return 'FundingSigned';
      case LIGHTNING_CHANNEL_READY:
        return 'ChannelReady';
      case LIGHTNING_SHUTDOWN:
        return 'Shutdown';
      case LIGHTNING_CLOSING_SIGNED:
        return 'ClosingSigned';
      case LIGHTNING_UPDATE_ADD_HTLC:
        return 'UpdateAddHTLC';
      case LIGHTNING_UPDATE_FULFILL_HTLC:
        return 'UpdateFulfillHTLC';
      case LIGHTNING_UPDATE_FAIL_HTLC:
        return 'UpdateFailHTLC';
      case LIGHTNING_COMMITMENT_SIGNED:
        return 'CommitmentSigned';
      case LIGHTNING_REVOKE_AND_ACK:
        return 'RevokeAndAck';
      case LIGHTNING_CHANNEL_ANNOUNCEMENT:
        return 'ChannelAnnouncement';
      case LIGHTNING_NODE_ANNOUNCEMENT:
        return 'NodeAnnouncement';
      case LIGHTNING_CHANNEL_UPDATE:
        return 'ChannelUpdate';
      default:
        return 'GenericMessage';
    }
  },
  set (value) {
    // console.trace('setting type:', value);
    let code = this.types[value];
    // Default to GenericMessage or JSONBlob based on content
    if (!code) {
      this.emit('warning', `Unknown message type: ${value}`);
      // Check if data is valid JSON
      try {
        if (this.data && JSON.parse(this.data)) {
          code = this.types['JSONBlob'];
          value = 'JSONBlob';
        } else {
          code = this.types['GenericMessage'];
        }
      } catch (e) {
        code = this.types['GenericMessage'];
      }
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
    const bodyBuf = Buffer.from(value);
    // Double-SHA256 for wire integrity (matches C message_compute_body_hash)
    this.raw.hash = Hash256.doubleDigest(bodyBuf);
    this.raw.data = bodyBuf;
    this.raw.size.write(padDigits(this.raw.data.byteLength.toString(16), 8), 'hex');
  }
});

module.exports = Message;
