'use strict';

const crypto = require('crypto');
const monitor = require('fast-json-patch');

// const CANON = require('canon');
const Constants = require('./constants');
const EventEmitter = require('events').EventEmitter;

/**
 * The {@link State} is the core of most {@link User}-facing interactions.  To
 * interact with the {@link User}, simply propose a change in the state by
 * committing to the outcome.  This workflow keeps app design quite simple!
 * @property {Number} size Size of state in bytes.
 * @property {Buffer} @buffer Byte-for-byte memory representation of state.
 * @property {String} @type Named type.
 * @property {Mixed} @data Local instance of the state.
 * @property {String} @id Unique identifier for this data.
 */
class State extends EventEmitter {
  /**
   * Creates a snapshot of some information.
   * @param  {Mixed} data Input data.
   * @return {State}      Resulting state.
   */
  constructor (data) {
    super(data);

    this['@version'] = 0x01;
    this['@input'] = data || null;
    this['@data'] = data || {};
    this['@meta'] = {};
    this['@encoding'] = 'json';

    // Literal Entity Structure
    this['@entity'] = {
      '@type': 'State',
      '@data': data
    };

    // TODO: test and document memory alignment
    // this['@buffer'] = Buffer.alloc(Constants.MAX_MESSAGE_SIZE);
    this['@buffer'] = Buffer.from(this.serialize(this['@entity']['@data']));

    // if not destined to be an object...
    if (typeof this['@data'] === 'string') {
      this['@entity']['@type'] = 'String';
    } else if (this['@data'] instanceof Array) {
      this['@entity']['@type'] = 'Array';
    } else if (this['@data'] instanceof Buffer) {
      this['@entity']['@type'] = 'Buffer';
    } else if (
      this['@data'] &&
      this['@data']['@type'] &&
      this['@data']['@data']
    ) {
      switch (this['@data']['@type']) {
        default:
          this['@entity']['@type'] = this['@data']['@type'];
          this['@entity']['@data'] = this['@data']['@data'];
          break;
      }
    }

    /**
     * Identity function.
     * @type {Boolean}
     */
    Object.defineProperty(this, 'id', {
      enumerable: true,
      get: this.fingerprint.bind(this)
    });

    Object.defineProperty(this, `size`, {
      enumerable: true,
      get: function count () {
        return this['@buffer'].length;
      }
    });

    Object.defineProperty(this, 'domain', {
      enumerable: false
    });

    Object.defineProperty(this, '_events', {
      enumerable: false
    });

    Object.defineProperty(this, '_eventsCount', {
      enumerable: false
    });

    Object.defineProperty(this, '_maxListeners', {
      enumerable: false
    });

    // start at zero
    this.clock = 0;

    // set various #meta
    this['@type'] = this['@entity']['@type'];
    this['@id'] = this.id;

    // set internal data
    this.services = ['json'];
    this.name = this['@entity'].name || this.id;
    this.link = `/states/${this.id}`;
    this.tags = [];

    // attach observer
    this.observer = monitor.observe(this['@entity']);

    // always commit before resolving
    this.commit();

    return this;
  }

  /**
   * Marshall an input into an instance of a {@link State}.  States have
   * absolute authority over their own domain, so choose your States wisely.
   * @param  {String} input Arbitrary input.
   * @return {State}       Resulting instance of the {@link State}.
   */
  static fromJSON (input) {
    if (typeof input !== 'string') return null;

    let result = null;

    try {
      result = JSON.parse(input);
    } catch (E) {
      console.error('Failure in fromJSON:', E);
    }

    return result;
  }

  static fromHex (input) {
    if (typeof input !== 'string') return null;
    return this.fromJSON(Buffer.from(input, 'hex').toString('utf8'));
  }

  static fromString (input) {
    if (typeof input !== 'string') return null;
    return this.fromJSON(input);
  }

  async _applyChanges (ops) {
    try {
      monitor.applyPatch(this['@data'], ops);

      await this.commit();
    } catch (E) {
      this.error('Error applying changes:', E);
    }

    return this;
  }

  fingerprint () {
    let map = {};
    map['@method'] = 'sha256';
    map['@input'] = this.serialize(this['@entity']['@data']);
    map['@buffer'] = crypto.createHash('sha256').update(map['@input'], 'utf8');
    map['@output'] = map['@buffer'].digest('hex');
    return map['@output'];
  }

  isRoot () {
    return this['@parent'] === this.id;
  }

  toBuffer () {
    if (this['@data'] instanceof Buffer) return this['@data'];
    if (this['@data']) return this.serialize();

    return Buffer.from(this['@data']['@data']);
  }

  toHTML () {
    let state = this;
    let solution = state['@output'].toString('utf8');
    let confirmed = String(solution);
    let raw = `X-Claim-ID: ${this.id}
X-Claim-Integrity: sha256
X-Claim-Type: Response
X-Claim-Result: ${state.id}
Body:
# STOP!
Here is your opportunity to read the documentation: https://dev.fabric.pub

Document ID: ${this.id}
Document Type (local JSON): ${this.constructor.name}
Document Path: ${this.path}
Document Name: ${this.name}
Document Integrity: sha256:${this.id}
Document Data (local JSON): ${confirmed}
Document Source:
\`\`\`
${confirmed}
\`\`\`

## Source Code
### Free as in _freedom_.
Labs: https://github.com/FabricLabs

To edit this message, visit this URL: https://github.com/FabricLabs/fabric/edit/master/lib/state.js

## Onboarding
When you're ready to continue, visit the following URL: https://dev.fabric.pub/WELCOME.html
`;

    return raw;
  }

  /**
   * Unmarshall an existing state to an instance of a {@link Blob}.
   * @return {String} Serialized {@link Blob}.
   */
  toString () {
    return this.serialize();
  }

  overlay (data) {
    let state = new State(data);
    this['@parent'] = this['@id'];
    this['@data'] = Object.assign({}, this['@data'], state['@data']);
    this['@did'] = `did:fabric:${this.id}`;
    this['@id'] = this.id;
    return this;
  }

  pack (data) {
    if (!data) data = this['@data'];
    return JSON.stringify(data);
  }

  /**
   * Convert to {@link Buffer}.
   * @param  {Mixed} [input] Input to serialize.
   * @return {Buffer}       {@link Store}-able blob.
   */
  serialize (input, encoding = 'json') {
    if (!input) input = this['@data'];

    let result = null;
    let state = {};

    if (typeof input === 'string') {
      result = Buffer.from(`${JSON.stringify(input)}`, 'utf8');
    } else if (input instanceof Array) {
      result = Buffer.from(`${JSON.stringify(input)}`, 'utf8');
    } else if (input instanceof Buffer) {
      result = input;
    } else if (input['@type'] && input['@data']) {
      return this.serialize(input['@data']);
    } else {
      switch (input.constructor.name) {
        default:
          this.warn('unhandled serialization type:', input.constructor.name);
          break;
        case 'Buffer':
          result = Buffer.from(JSON.stringify(input.toString('utf8')));
          break;
        case 'Object':
          result = Buffer.from(JSON.stringify(input));
      }

      // strip special fields
      // TODO: order?
      for (let name in input) {
        if (name.charAt(0) === '@') {
          continue;
        } else {
          state[name] = input[name];
        }
      }
    }

    return result;
  }

  /**
   * Take a hex-encoded input and convert to a {@link State} object.
   * @param  {String} input [description]
   * @return {State}       [description]
   */
  deserialize (input) {
    let output = null;

    if (typeof input === 'string') {
      // Let's create a state object...
      try {
        let state = new State(input);
        // Assign our output to the state data
        output = state['@data'];
      } catch (E) {
        this.error('Could not parse string as Buffer:', E);
      }

      return output;
    } else {
      this.log('WARNING:', `input not a string`, input);
    }

    if (!output) return null;

    switch (output['@type']) {
      case 'String':
        output = output['@buffer'].toString(output['@encoding']);
        break;
    }

    return output;
  }

  flatten () {
    let map = {};

    for (let k in this['@data']) {
      map[k] = this.serialize(this['@data'][k]);
    }

    return map;
  }

  fork () {
    let data = Object.assign({
      '@parent': this.id
    }, this['@data']);
    return new State(data);
  }

  commit () {
    ++this.clock;

    this['@parent'] = this.id;
    this['@preimage'] = this.toString();
    this['@constructor'] = this.constructor;
    this['@changes'] = monitor.generate(this.observer);
    this['@id'] = this.id;

    if (this['@changes'].length) {
      this.emit('changes', this['@changes']);
      this.emit('state', this['@state']);
    }

    return this;
  }

  /**
   * Compose a JSON string for network consumption.
   * @return {String} JSON-encoded {@link String}.
   */
  render () {
    this['@id'] = this.id;
    this['@encoding'] = 'json';
    this['@output'] = this.serialize(this['@entity']['@data'], 'json');
    this['@commit'] = this.commit();

    switch (this['@type']) {
      default:
        return this['@output'].toString('utf8');
    }
  }
}

module.exports = State;
