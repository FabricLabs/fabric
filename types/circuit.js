'use strict';

// External dependencies
const crypto = require('crypto');
const parser = require('dotparser');
const visualize = require('javascript-state-machine/lib/visualize');
const StateMachine = require('javascript-state-machine');

// Fabric Types
const Machine = require('./machine');
const Actor = require('./actor');

/**
 * The {@link Circuit} is the mechanism through which {@link Fabric}
 * operates, a computable directed graph describing a network of
 * {@link Peer} components and their interactions (side effects).
 * See also {@link Swarm} for deeper inspection of {@link Machine}
 * mechanics.
 */
class Circuit extends Actor {
  constructor (config = {}) {
    super(config);

    this.settings = Object.assign({
      edges: [],
      gates: [],
      loops: [],
      nodes: [],
      wires: [],
      methods: {},
      state: {
        graph: {
          edges: [],
          nodes: []
        }
      }
    }, config);

    this['@data'] = this.settings;

    this.gates = [];
    this.transitions = [];
    this.methods = {};

    for (let i in this.settings.gates) {
      this.transitions.push({
        name: `step`,
        from: 'cycle()',
        to: `${this.settings.gates[i]}`
      });
    }

    for (let i in this.settings.wires) {
      let wire = this.settings.wires[i];
      this.transitions.push({ name: wire.name, from: wire.from, to: wire.to });
    }

    // Internal State
    this._state = {
      steps: [
        'load', // load from storage
        'bootstrap', // configure memory
        'step', // single cycle before start
        'start', // create services
        'listen' // listen for input
      ],
      content: this.settings.state
    };

    this.graph = new StateMachine({
      init: 'start()',
      data: this.state,
      transitions: this.transitions,
      methods: this.methods
    });

    return this;
  }

  get hash () {
    return crypto.createHash('sha256').update(this.dot).digest('hex');
  }

  get dot () {
    // TODO: generate polynomial for circuit
    return visualize(this.graph, {
      orientation: 'horizontal'
    });
  }

  _registerMethod (name, method) {
    this.methods[name] = method;
  }

  fromBristolFashion () {
    // Convert from Bristol Fashion format to internal circuit representation
    const lines = this.dot.split('\n');
    const [numGates, numWires, numInputWires, numOutputWires] = lines[0].split(' ').map(Number);

    this.gates = [];
    this.wires = [];
    this.inputWires = numInputWires;
    this.outputWires = numOutputWires;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(' ');
      if (parts.length < 4) continue;

      const numInputs = parseInt(parts[0]);
      const numOutputs = parseInt(parts[1]);
      const gate = {
        type: parts[parts.length - 1],
        numInputs: numInputs,
        numOutputs: numOutputs,
        inputs: parts.slice(2, 2 + numInputs).map(Number),
        outputs: parts.slice(2 + numInputs, 2 + numInputs + numOutputs).map(Number)
      };

      this.gates.push(gate);
    }

    return this;
  }

  fromBristolFormat () {
    // Convert from Bristol Format to internal circuit representation
    const lines = this.dot.split('\n');
    const [numGates, numWires] = lines[0].split(' ').map(Number);

    this.gates = [];
    this.wires = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(' ');
      if (parts.length < 3) continue;

      const gate = {
        type: parts[parts.length - 1],
        inputs: parts.slice(0, -1).map(Number)
      };

      this.gates.push(gate);
    }

    return this;
  }

  toBristolFashion () {
    // Convert internal circuit representation to Bristol Fashion format
    let output = `${this.gates.length} ${this.wires.length} ${this.inputWires || 0} ${this.outputWires || 0}\n`;

    for (const gate of this.gates) {
      const numInputs = gate.numInputs || gate.inputs.length;
      const numOutputs = gate.numOutputs || 1;
      const inputs = gate.inputs.join(' ');
      const outputs = gate.outputs ? gate.outputs.join(' ') : '';
      output += `${numInputs} ${numOutputs} ${inputs} ${outputs} ${gate.type}\n`;
    }

    return output;
  }

  toBristolFormat () {
    // Convert internal circuit representation to Bristol Format
    let output = `${this.gates.length} ${this.wires.length}\n`;

    for (const gate of this.gates) {
      output += `${gate.inputs.join(' ')} ${gate.type}\n`;
    }

    return output;
  }

  toObject () {
    return parser(this.dot);
  }

  parse (input) {
    return parser(input);
  }

  compute (input) {
    let output = input;

    // empty resolves to Identity function f(x) = x

    return output;
  }

  scramble () {
    let key = crypto.randomBytes(32);
    let machine = new Machine({ seed: key });
    let seed = machine.sip();
    let gates = [];

    for (let i = 0; i < this._state.steps.length; i++) {
      gates.push({
        name: this._state.steps[i],
        seed: machine.sip()
      });
    }

    gates.sort((a, b) => {
      return a.seed - b.seed;
    });

    return gates;
  }

  render () {
    let hash = crypto.createHash('sha256').update(this.dot).digest('base64');
    return `<fabric-circuit>
  <fabric-code-snippet data-bind="${this.hash}" data-integrity="sha256-${hash}">${this.dot}</fabric-code-snippet>
  <fabric-canvas>
    <fabric-grid>
      <fabric-grid-row>
        <textarea data-bind="${this.hash}" placeholder="Purity contract here...">${this.dot}</textarea>
      </fabric-grid-row>
      <fabric-grid-row>
        <button data-action="_step">step</button>
      </fabric-grid-row>
      <fabric-grid-row>
        <fabric-svg id="svg"></fabric-svg>
      </fabric-grid-row>
      <fabric-grid-row>
        <canvas id="output" data-bind="output"></canvas>
        <canvas id="canvas" data-bind="${this.hash}"></canvas>
      </fabric-grid-row>
  </fabric-canvas>
</fabric-circuit>`;
  }

  _draw () {
    return this;
  }

  async _step () {
    let circuit = this;
    let origin = circuit.hash + '';

    console.log('[CIRCUIT:STEP]', this.graph);
    console.log('[CIRCUIT:STEP]', 'woo:', this.toObject());
    console.log('[CIRCUIT:STEP]', 'zkc:', this.toObject().map((x) => {
      return x.children.filter(x => {
        return x.type === 'edge_stmt';
      }).map((y) => {
        return y.edge_list.map(z => {
          return z.id;
        });
      });
    })[0]);

    console.log('[CIRCUIT:STEP]', 'fsm:', this.graph._fsm);
    console.log('[CIRCUIT:STEP]', 'origin:', origin);
    console.log('[CIRCUIT:STEP]', 'origin hash:', this.hash);
    console.log('[CIRCUIT:STEP]', 'origin data:', this.dot);
    console.log('[CIRCUIT:STEP]', 'current:', this.graph.state);

    switch (this.graph.state) {
      default:
        console.error('unhandled state:', this.graph.state);
        break;
      case 'init':
        this.graph.ready();
        break;
      case 'ready':
        this.graph.step1();
        break;
      case '1':
        this.graph.step2();
        break;
      case '2':
        this.graph.step3();
        break;
      case '3':
        this.graph.done();
        break;
      case 'complete':
        console.log('#winning');
        this.emit('complete');
        break;
    }

    console.log('[CIRCUIT:STEP]', 'after:', this.graph.state);

    this.emit(origin, this.dot);

    await this._PUT(`/output`, Buffer.alloc((256 ** 3) / 8), false);
    await this._PUT(`/source`, this.dot, false);
    await this._PUT(`/status`, this.graph.state, false);

    let commit = await this.commit();

    console.log('commit:', commit);

    return commit;
  }

  async start () {
    return this;
  }
}

module.exports = Circuit;
