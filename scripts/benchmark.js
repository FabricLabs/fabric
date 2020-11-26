'use strict';

const iterations = 10000;
const priors = {
  '100': 194,
  '1000': 3690,
  '10000': 378840
};

const Collection = require('../types/collection');
const Machine = require('../types/machine');

async function benchmark () {
  let now = Date.now();
  let collection = new Collection();
  let machine = new Machine();

  for (let i = 0; i < iterations; i++) {
    let item = { name: machine.sip() };
    let instance = await collection.create(item);
  }

  let finish = Date.now();
  let duration = finish - now;

  console.log('[BENCHMARK]', `Benchmark ended, ${iterations} run in ${duration} milliseconds.`);
}

benchmark();
