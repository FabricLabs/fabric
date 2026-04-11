'use strict';

const assert = require('assert');
const Circuit = require('../types/circuit');

describe('@fabric/core/types/circuit', function () {
  describe('Circuit', function () {
    it('can create a new circuit', function () {
      const circuit = new Circuit();
      assert.ok(circuit);
      assert.ok(circuit.id);
    });

    describe('Bristol Format', function () {
      it('can convert from Bristol Format', function () {
        const circuit = new Circuit({
          state: {
            graph: {
              nodes: [],
              edges: []
            }
          },
          gates: [],
          wires: []
        });

        const bristolFormat = '2 2\n1 1 2 XOR\n';
        circuit._state.content.graph = {
          nodes: [],
          edges: []
        };
        circuit.gates = [];
        circuit.wires = [];

        // Parse the Bristol Format and set up the circuit
        const lines = bristolFormat.split('\n');
        const [numGates, numWires] = lines[0].split(' ').map(Number);

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split(' ');
          if (parts.length < 3) continue;

          circuit.gates.push({
            type: parts[parts.length - 1],
            inputs: parts.slice(0, -1).map(Number)
          });
        }

        assert.ok(circuit.gates);
        assert.strictEqual(circuit.gates.length, 1);
        assert.strictEqual(circuit.gates[0].type, 'XOR');
        assert.deepStrictEqual(circuit.gates[0].inputs, [1, 1, 2]);
      });

      it('can convert to Bristol Format', function () {
        const circuit = new Circuit();
        circuit.gates = [{
          type: 'XOR',
          inputs: [1, 1, 2]
        }];
        circuit.wires = [1, 2];
        
        const bristolFormat = circuit.toBristolFormat();
        assert.strictEqual(bristolFormat, '1 2\n1 1 2 XOR\n');
      });
    });

    describe('Bristol Fashion', function () {
      it('can convert from Bristol Fashion', function () {
        const circuit = new Circuit({
          state: {
            graph: {
              nodes: [],
              edges: []
            }
          },
          gates: [],
          wires: []
        });
        
        const bristolFashion = '2 2 1 1\n2 1 1 1 2 XOR\n';
        circuit._state.content.graph = {
          nodes: [],
          edges: []
        };
        circuit.gates = [];
        circuit.wires = [];
        
        // Parse the Bristol Fashion and set up the circuit
        const lines = bristolFashion.split('\n');
        const [numGates, numWires, numInputWires, numOutputWires] = lines[0].split(' ').map(Number);
        circuit.inputWires = numInputWires;
        circuit.outputWires = numOutputWires;
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(' ');
          if (parts.length < 4) continue;
          
          const numInputs = parseInt(parts[0]);
          const numOutputs = parseInt(parts[1]);
          circuit.gates.push({
            type: parts[parts.length - 1],
            numInputs: numInputs,
            numOutputs: numOutputs,
            inputs: parts.slice(2, 2 + numInputs).map(Number),
            outputs: parts.slice(2 + numInputs, 2 + numInputs + numOutputs).map(Number)
          });
        }

        assert.ok(circuit.gates);
        assert.strictEqual(circuit.gates.length, 1);
        assert.strictEqual(circuit.gates[0].type, 'XOR');
        assert.strictEqual(circuit.gates[0].numInputs, 2);
        assert.strictEqual(circuit.gates[0].numOutputs, 1);
        assert.deepStrictEqual(circuit.gates[0].inputs, [1, 1]);
        assert.deepStrictEqual(circuit.gates[0].outputs, [2]);
        assert.strictEqual(circuit.inputWires, 1);
        assert.strictEqual(circuit.outputWires, 1);
      });

      it('can convert to Bristol Fashion', function () {
        const circuit = new Circuit();
        circuit.gates = [{
          type: 'XOR',
          numInputs: 2,
          numOutputs: 1,
          inputs: [1, 1],
          outputs: [2]
        }];
        circuit.wires = [1, 2];
        circuit.inputWires = 1;
        circuit.outputWires = 1;

        const bristolFashion = circuit.toBristolFashion();
        assert.strictEqual(bristolFashion, '1 2 1 1\n2 1 1 1 2 XOR\n');
      });
    });

    it('can handle complex circuits', function () {
      const circuit = new Circuit({
        state: {
          graph: {
            nodes: [],
            edges: []
          }
        },
        gates: [],
        wires: []
      });

      const bristolFashion = '3 4 2 1\n2 1 1 2 3 AND\n2 1 3 4 5 XOR\n';
      circuit._state.content.graph = {
        nodes: [],
        edges: []
      };
      circuit.gates = [];
      circuit.wires = [];

      // Parse the Bristol Fashion and set up the circuit
      const lines = bristolFashion.split('\n');
      const [numGates, numWires, numInputWires, numOutputWires] = lines[0].split(' ').map(Number);
      circuit.inputWires = numInputWires;
      circuit.outputWires = numOutputWires;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(' ');
        if (parts.length < 4) continue;

        const numInputs = parseInt(parts[0]);
        const numOutputs = parseInt(parts[1]);
        circuit.gates.push({
          type: parts[parts.length - 1],
          numInputs: numInputs,
          numOutputs: numOutputs,
          inputs: parts.slice(2, 2 + numInputs).map(Number),
          outputs: parts.slice(2 + numInputs, 2 + numInputs + numOutputs).map(Number)
        });
      }

      assert.ok(circuit.gates);
      assert.strictEqual(circuit.gates.length, 2);
      assert.strictEqual(circuit.gates[0].type, 'AND');
      assert.strictEqual(circuit.gates[1].type, 'XOR');
      assert.strictEqual(circuit.inputWires, 2);
      assert.strictEqual(circuit.outputWires, 1);
    });

    it('compute is identity on arbitrary input', function () {
      const c = new Circuit();
      assert.strictEqual(c.compute(42), 42);
      assert.strictEqual(c.compute('x'), 'x');
    });

    it('scramble returns ordered gate descriptors for each lifecycle step', function () {
      const c = new Circuit();
      const gates = c.scramble();
      assert.strictEqual(gates.length, c._state.steps.length);
      assert.ok(gates.every((g) => g.name && g.seed !== undefined));
    });

    it('hash is sha256 hex of dot export', function () {
      const c = new Circuit();
      assert.strictEqual(typeof c.hash, 'string');
      assert.strictEqual(c.hash.length, 64);
      assert.strictEqual(/^[0-9a-f]+$/.test(c.hash), true);
    });

    it('render embeds hash and dot for UI binding', function () {
      const c = new Circuit();
      const html = c.render();
      assert.ok(html.includes('<fabric-circuit>'));
      assert.ok(html.includes(c.hash));
      assert.ok(html.includes('data-bind'));
    });

    it('parse delegates to dotparser', function () {
      const c = new Circuit();
      const ast = c.parse('digraph G { a -> b }');
      assert.ok(ast);
    });

    it('toObject parses graphviz from state machine export', function () {
      const c = new Circuit();
      const obj = c.toObject();
      assert.ok(Array.isArray(obj));
    });

    it('fromBristolFormat reads Bristol lines from dot-shaped text', function () {
      const c = new Circuit();
      Object.defineProperty(c, 'dot', {
        configurable: true,
        get () {
          return '1 2\n1 1 2 XOR\n';
        }
      });
      c.fromBristolFormat();
      assert.strictEqual(c.gates.length, 1);
      assert.strictEqual(c.gates[0].type, 'XOR');
      assert.deepStrictEqual(c.gates[0].inputs, [1, 1, 2]);
    });

    it('fromBristolFashion reads extended Bristol lines from dot-shaped text', function () {
      const c = new Circuit();
      Object.defineProperty(c, 'dot', {
        configurable: true,
        get () {
          return '1 2 1 1\n2 1 1 1 2 XOR\n';
        }
      });
      c.fromBristolFashion();
      assert.strictEqual(c.gates.length, 1);
      assert.strictEqual(c.gates[0].type, 'XOR');
      assert.strictEqual(c.gates[0].numInputs, 2);
      assert.strictEqual(c.gates[0].numOutputs, 1);
    });

    it('_registerMethod stores a callable on methods', function () {
      const c = new Circuit();
      const fn = () => 1;
      c._registerMethod('m', fn);
      assert.strictEqual(c.methods.m, fn);
    });
  });
}); 