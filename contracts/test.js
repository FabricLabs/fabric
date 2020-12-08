'use strict';

// Fabric Types
const Chain = require('../types/chain');
const Entity = require('../types/entity');

// Settings
const data = require('../settings/test');

// Program Definition
async function OP_TEST () {
  const chain = new Chain(data);
  await chain.start();

  const bank = new Entity({
    value: chain.subsidy
  });

  await chain.append({
    '@id': 'stub',
    '@data': {
      parent: chain.id,
      transactions: [
        bank.id
      ]
    }
  });

  console.log('chain started:', chain.id);
}

// Module
module.exports = OP_TEST;
