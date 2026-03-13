#!/usr/bin/env node
'use strict';

// Fixtures
const {
  FIXTURE_SEED
} = require('../constants');

// Settings
const settings = require('../settings/local');

// Dependencies
const merge = require('lodash.merge');

// Fabric Types
// const Block = require('../types/block');
// const Chain = require('../types/chain');
const Environment = require('../types/environment');
const Federation = require('../types/federation');
const Key = require('../types/key');
const Machine = require('../types/machine');

// Fabric Services
const Bitcoin = require('../services/bitcoin');

// Create Environment
const environment = new Environment();

// Read Keys
const FABRIC_SEED = environment.readVariable('FABRIC_SEED');
const FABRIC_XPRV = environment.readVariable('FABRIC_XPRV');
const FABRIC_XPUB = environment.readVariable('FABRIC_XPUB');

console.log('seed:', FABRIC_SEED);

const key = new Key({
  private: FIXTURE_SEED
});

console.log('key:', key);

/* const bond = Buffer.from([
    0x51, // witness v1
    0x20, // PUSH_DATA 32
    pubkey.key.public // x-only pub
]); */

const OP_ADVANCE_BLOCK = require('../contracts/federation');
// const Actor = require('../types/actor');

async function main (input = {}) {
  const config = merge({
    balances: {
      // 0x00: 10000000
    },
    blocks: {},
    chain: [],
    frequency: 60, // seconds
    script: [],
    validators: []
  }, input);

  // const chain = new Chain();
  const federation = new Federation(config);
  const machine = new Machine(config);

  /* // example use of trigger-based cycles
  const source = new Actor();
  source.on('changes', (changes) => {
    machine.trigger('OP_HANDLE_CHANGES', [changes]);
  }); */

  // Define Opcodes
  machine.define('OP_ADVANCE_BLOCK', OP_ADVANCE_BLOCK);

  // Configure State
  machine.set('/balances', config.balances);
  machine.set('/blocks', config.blocks);
  machine.set('/chain', config.chain);
  machine.set('/validators', config.validators);

  // Log changes
  machine.on('changes', (changes) => {
    console.log('[SCRIPTS:VALIDATOR] Changes:', changes);
    console.log('[SCRIPTS:VALIDATOR] State:', machine.state);
  });

  // Anchor Chain
  const bitcoin = new Bitcoin();
  const fixture = new Key({ seed: FIXTURE_SEED });

  console.log('public:', fixture.public.encodeCompressed('hex'));

  federation.addMember({
    public: fixture.public.encodeCompressed('hex')
  });

  federation.start();

  await machine.start();

  return JSON.stringify({
    content: machine.state,
    frequency: machine.frequency,
    interval: machine.interval,
    machine: machine.id
  });
}

main(settings).catch((exception) => {
  console.error('[SCRIPTS:VALIDATOR] Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:VALIDATOR] Main Process Output:', output);
});
