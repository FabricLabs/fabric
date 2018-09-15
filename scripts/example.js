const util = require('util');

const Fabric = require('../lib/fabric');
const Worker = require('../lib/worker');

function Genesis () {
  comment = 'Function body is the program.';
}

// contract writes to stdout
/**
 * Example program.
 * @param       {Mixed} input Arbitrary input data.
 * @constructor
 */
function App (input) {
  console.log(`${Date.now()} Called with input: ${JSON.stringify(input, null, '  ')}`);

  // program definition
  // these are available to the entire app
  function doStuff () {
    console.log('leaked data:', this);
    let tip = advanceChain();
    return {
      tip: tip,
      response: 'Did stuff.',
      input: input
    };
  }

  function advanceChain () {
    return {
      input: input,
      root: root,
      seed: Math.random()
    };
  }

  let output = doStuff();
  console.log('output:', output);

  advanceChain();

  return output;
}

util.inherits(App, Fabric);

var worker = new Worker(App);

console.log('worker:', worker);
console.log('method:', worker.method);
console.log('result:', worker.method());

// for convenience
function every (list) {
  return list.map(App);
}

function main (input) {
  let cores = [Buffer.alloc(32), 'EXAMPLE_STRING', 'input is an array'];

  for (let i = 1; i < 5; i++) {
    cores.push({ name: `core-${i}` })
  }

  cores.push(Genesis);

  let many = every(cores);

  console.log('many:', many);

}

main(process.stdin);
