'use strict';

const crypto = require('crypto');
const monitor = require('fast-json-patch');
const EventEmitter = require('events').EventEmitter;

/**
 * The {@link State} is the core of most {@link User}-facing interactions.  To
 * interact with the {@link User}, simply propose a change in the state by
 * committing to the outcome.  This workflow keeps app design actually quite
 * simple!
 * @property {size} @id Unique identifier for this data.
 * @property {Map} @id Unique identifier for this data.
 */
class State extends EventEmitter {
  /**
   * Creates a snapshot of some information.
   * @param  {Mixed} data Input data.
   * @return {State}      Resulting state.
   */
  constructor (data) {
    super(data);

    if (typeof data === 'string') {
      data = {
        '@type': 'String',
        '@buffer': Buffer.from(data, 'hex'),
        '@encoding': 'hex',
        '@input': data,
        '@method': 'sha256',
        '@output': crypto.createHash('sha256').update(data, 'utf8').digest('hex'),
        '@data': data,
        length: data.length,
        size: data.length
      };
    } else if (data instanceof Array) {
      let buffer = Buffer.from(`${[data.join(',')]}`);
      data = {
        '@type': 'Array',
        '@buffer': buffer,
        '@encoding': 'json',
        '@input': data,
        '@method': 'render',
        '@challenge': crypto.createHash('sha256').update(buffer).digest('hex'),
        '@data': data,
        length: data.length,
        size: data.length
      };
    } else if (data instanceof Buffer) {
      data = {
        '@type': 'Buffer',
        '@buffer': data,
        '@encoding': 'json',
        '@input': data.toString('hex'),
        '@method': 'render',
        '@challenge': crypto.createHash('sha256').update(data.toString('utf8')).digest('hex'),
        '@data': data,
        length: data.length,
        size: data.length
      };
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
        return this.id.length;
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
    this['@type'] = 'State';
    this['@data'] = Object.assign({}, data);
    this['@id'] = this.id;

    // set internal data
    this.services = ['json'];
    this.name = this['@data'].name || this.id;
    this.link = `/states/${this.id}`;
    this.tags = [];

    // attach observer
    this.observer = monitor.observe(this['@data']);

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
    if (typeof input !== 'string') return null;

    let result = null;

    try {
      let raw = Buffer.from(input, 'hex');
      let state = new State(raw);

      // Since we've computed a State, let's commit to our answer.
      state.commit();

      // The resulting State is provided as output.
      result = state.deserialize(input);
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
    let input = this.serialize(this['@data']);
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }

  toBuffer () {
    if (this['@buffer']) return this['@buffer'];
    if (this['@data'] instanceof Buffer) return this['@data'];
    if (this['@data']['@data'] instanceof Buffer) return this['@data']['@data'];
    if (this['@data']) {
      let data = this['@data'];
      // console.log('[BUFFER]', 'toBuffer', 'data:', data);
      return Buffer.from(JSON.stringify(this['@data']));
    }

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

  /**
   * Convert to {@link Buffer}.
   * @param  {Mixed} [input] Input to serialize.
   * @return {Buffer}       {@link Store}-able blob.
   */
  serialize (input) {
    if (!input) input = this['@data'];
    // console.log('serializing:', typeof input, input.constructor.name, input);
    if (typeof input === 'string') {
      return Buffer.from(`"${input}"`, 'utf8');
    } else if (input instanceof Array) {
      return Buffer.from(`${JSON.stringify(input)}`, 'utf8');
    } else if (input instanceof Buffer) {
      return input;
    } else if (input['@type']) {
      switch (input['@type']) {
        case 'Array':
          let output = `[${input['@data'].map(x => JSON.stringify(x)).join(',')}]`;
          return Buffer.from(output, 'utf8');
        case 'Buffer':
          return input['@buffer'];
        case 'State':
          return Buffer.from(JSON.stringify(input['@data']));
        case 'String':
          return Buffer.from(input['@data'], 'utf8');
      }
    }

    let state = {};

    // strip special fields
    // TODO: order?
    for (let name in input) {
      if (name.charAt(0) === '@') {
        continue;
      } else {
        state[name] = input[name];
      }
    }

    // console.log('raw state:', state);
    // console.log('input was', input);

    return Buffer.from(JSON.stringify(state));
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
      this.emit('state', this['@data']);
      this.emit('state/tip', this.id);
    }

    return this;
  }

  /**
   * Compose a JSON string for network consumption.
   * @return {String} JSON-encoded {@link String}.
   */
  render () {
    this['@encoding'] = 'json';
    this['@output'] = this.serialize(this['@data'], 'json');

    switch (this['@type']) {
      default:
        this.log('[RENDER]', 'unhandled type:', this['@type']);
        this.log('[RENDER]', 'unhandled data:', this['@data']);
        break;
      case 'Array':
        this['@output'] = `[${JSON.stringify(this['@data'])}]`;
        break;
      case 'Buffer':
        this['@output'] = `${this['@data']['@buffer']}`;
        break;
      case 'Map':
        this['@output'] = `${JSON.stringify(this['@data'])}`;
        break;
      case 'State':
        switch (this['@data']['@type']) {
          default:
            this['@output'] = JSON.stringify(this['@data']);
            break;
          case 'Array':
            this['@output'] = `${JSON.stringify(this['@data']['@data'])}`;
            break;
          case 'Buffer':
            this['@output'] = `${this['@data']['@buffer'].toString()}`;
            break;
          case 'String':
            this['@output'] = `${this['@data']['@data']}`;
            break;
        }
        break;
      case 'String':
        let locals = Buffer.from(this['@data']['@input'], 'hex');
        this['@output'] = JSON.stringify(locals.toString('utf8'));
        break;
    }

    this['@id'] = this.id;

    // Commit to it!
    this.commit();

    return this['@output'];
  }
}

module.exports = State;
