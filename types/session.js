'use strict'

// Constants
const {
  LIGHTNING_PROTOCOL_H_INIT,
  LIGHTNING_PROTOCOL_PROLOGUE
} = require('../constants');

// Dependencies
const event = require('p-event');
const struct = require('struct');
const crypto = require('crypto');

// Fabric Types
const Entity = require('./entity');
const Key = require('./key');

/**
 * The {@link Session} type describes a connection between {@link Peer}
 * objects, and includes its own lifecycle.
 */
class Session extends Entity {
  /**
   * Creates a new {@link Session}.
   * @param {Object} settings 
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      ephemeral: true,
      initiator: null,
      recipient: null
    }, settings);

    // Create Unique Key
    this.key = new Key();

    // Internal State
    this._state = {
      clock: 0,
      meta: {
        messages: 0,
        received: 0,
        sent: 0
      }
    };

    // Protocol Components
    this.components = {};

    // Map of messages
    this.store = {};

    // List of Session messages
    this.messages = [];

    // Status flag
    this.status = 'initialized';

    return this;
  }

  get id () {
    return this.key.id;
  }

  get clock () {
    return this._state.clock;
  }

  set clock (value) {
    this._state.clock = value;
  }

  get state () {
    return Object.assign({}, this._state);
  }

  get meta () {
    return this.state.meta;
  }

  set meta (value) {
    this.state.meta = value;
  }

  TypedMessage (type, data) {
    const message = struct()
      .charsnt('type', 64) // 64 B
      .charsnt('data', Math.pow(2, 22)); // 4 MB

    // Allocate memory
    message.allocate();

    message.fields.type = type;
    message.fields.data = data;

    return message;
  }

  fingerprint (buffer) {
    if (!(buffer instanceof Buffer)) throw new Error('Input must be a buffer.');
    return this.hash(buffer).digest('hex');
  }

  hash (buffer) {
    if (!(buffer instanceof Buffer)) throw new Error('Input must be a buffer.');
    return crypto.createHash('sha256').update(buffer);
  }

  // TODO: implement
  encrypt (data) {
    return data;
  }

  // TODO: implement
  decrypt (data) {
    return data;
  }

  /**
   * Opens the {@link Session} for interaction.
   */
  async start () {
    this.status = 'starting';

    const start = this.TypedMessage('SessionStart');
    await this._appendMessage(start.buffer());

    this.components.h = this.hash(Buffer.from(LIGHTNING_PROTOCOL_H_INIT, 'ascii'));
    this.components.ck = this.hash(Buffer.from(LIGHTNING_PROTOCOL_H_INIT, 'ascii'));

    this.components.h.update(Buffer.from(LIGHTNING_PROTOCOL_PROLOGUE, 'ascii'));

    this.status = 'started';
    return this;
  }

  /**
   * Closes the {@link Session}, preventing further interaction.
   */
  async stop () {
    this.status = 'stopping';
    this.status = 'stopped';
    return this;
  }

  async commit () {
    return true;
    let signature = this.key._sign(this.state);
    return signature;
  }

  async _appendMessage (message) {
    this.clock++;

    const id = this.fingerprint(message);

    if (!this.settings.ephemeral) {
      this.store[id] = message;
    }

    this.messages.push(id);
    this.meta.messages = this.messages.length;

    let signature = await this.commit();
    this.emit('message', { id, signature });

    return signature;
  }
}

module.exports = Session;
