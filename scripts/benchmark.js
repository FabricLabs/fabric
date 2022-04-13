'use strict';

const iterations = 10000;
const priors = {
  100: 194,
  1000: 3690,
  10000: 378840
};

const Collection = require('../types/collection');
const Machine = require('../types/machine');

async function benchmark () {
  const now = Date.now();
  const collection = new Collection();
  const machine = new Machine();

  for (let i = 0; i < iterations; i++) {
    const item = { name: machine.sip() };
    const instance = await collection.create(item);
  }

  const finish = Date.now();
  const duration = finish - now;

  console.log('[BENCHMARK]', `Benchmark ended, ${iterations} run in ${duration} milliseconds.`);
}

benchmark();
