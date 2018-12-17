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
    this['@buffer'] = Buffer.alloc(Constants.MAX_MESSAGE_SIZE);

    // if not destined to be an object...
    if (typeof this['@data'] === 'string') {
      this['@buffer'].write(data);
      this['@entity']['@type'] = 'String';
    } else if (this['@data'] instanceof Array) {
      let content = this.serialize(this['@data']).toString();

      console.log('data:', typeof this['@data'], this['@data']);
      console.log('content:', typeof content, content);

      this['@buffer'].write(content);
      this['@entity']['@type'] = 'Array';
    } else if (this['@data'] instanceof Buffer) {
      this['@data'].copy(this['@buffer']);
      this['@entity']['@type'] = 'Buffer';
    } else if (
      this['@data'] &&
      this['@data']['@type'] &&
      this['@data']['@data']
    ) {
      switch (this['@data']['@type']) {
        default:
          console.warn('FOUND DECLARED TYPE:', this['@data']['@type'], this['@data']);
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
  static fromString (input) {
    console.log('fromstring:', input);

    if (typeof input !== 'string') return null;

    let result = null;
    let json = Buffer.from(input, 'hex').toString('utf8');

    console.log('from input:', input);
    console.log('json:', json);

    try {
      result = JSON.parse(json);
    } catch (E) {
      console.error('Failure in fromString:', E);
    }

    return result;
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
    let input = this.serialize(this['@entity']['@data']);
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
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
    if (typeof this['@data'] === 'string') return this['@data'];
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
  serialize (input) {
    if (!input) input = this['@data'];

    let result = null;
    let state = {};

    if (typeof input === 'string') {
      result = Buffer.from(`${JSON.stringify(input)}`, 'utf8');
    } else if (input instanceof Array) {
      result = Buffer.from(`${JSON.stringify(input)}`, 'utf8');
      /* result = Buffer.from(`[${input.map((x) => {
        return `"${this.serialize(x).toString('hex')}"`;
      }).join(',')}]`, 'utf8'); */
    } else if (input instanceof Buffer) {
      result = input;
    } else if (input['@type'] && input['@data']) {
      return this.serialize(input['@data']);
    } else {
      // console.log('checking for input constructor:', input.constructor.name, input.constructor);

      switch (input.constructor.name) {
        default:
          console.log('unhandled serialization type:', input.constructor.name);
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

      // console.log('clean state:', state);
    }

    console.log('SCRIPT:');
    console.log('serialize', input, '⇒', `byte(${result.length})`, result);

    return result;

    // return Buffer.from(JSON.stringify(state));
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
    this['@output'] = this.serialize(this['@data'], 'json');
    this['@commit'] = this.commit();

    switch (this['@type']) {
      default:
        console.log('rendering unhandled type:', this['@type'], this['@data'], this['@output']);
        return this['@output'].toString('utf8');
      case 'Stack':
        let output = this.serialize(this['@data']).toString('utf8');
        console.log('output:', output.constructor.name, output);
        return output;
    }

    return this['@output'].toString();
  }
}

module.exports = State;
