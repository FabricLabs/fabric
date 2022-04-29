#!/usr/bin/env node
'use strict';

// Settings
const settings = require('../settings/local');
const master = Buffer.from('7e1b8e405919c1c8dcb07a677a2881b62517ecb7d136681851f514f22a806685', 'hex')

const merge = require('lodash.merge');

// Fabric Types
const Block = require('../types/block');
const Chain = require('../types/chain');
const Environment = require('../types/environment');
const Key = require('../types/key');
const Machine = require('../types/machine');
const Signer = require('../types/signer');

// Fabric Services
const Bitcoin = require('../services/bitcoin');

// Create Environment
const environment = new Environment();

// Read Keys
const FABRIC_SEED = environment.readVariable('FABRIC_SEED');
const FABRIC_XPRV = environment.readVariable('FABRIC_XPRV');
const FABRIC_XPUB = environment.readVariable('FABRIC_XPUB');

console.log('seed:', FABRIC_SEED);

const signer = new Signer({
  private: master
});

console.log('signer:', signer);

const bond = Buffer.from([
    0x51, // witness v1
    0x20, // PUSH_DATA 32
    pubkey.key.public // x-only pub
]);

const { OP_ADVANCE_BLOCK } = require('../contracts/federation');

async function main (input = {}) {
  const config = merge({
    balances: {
      // 0x00: 10000000
    },
    blocks: {},
    chain: [],
    frequency: 1, // Hz
    script: [
      'OP_ADVANCE_BLOCK',
    ],
    validators: [

    ]
  }, input);

  const chain = new Chain();
  const machine = new Machine(config);

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
  await machine.start();

  return machine; // { id: machine.id }
}

main(settings).catch((exception) => {
  console.error('[SCRIPTS:VALIDATOR] Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:VALIDATOR] Main Process Output:', output);
});
