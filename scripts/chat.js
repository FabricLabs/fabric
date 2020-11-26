#!/usr/bin/env node
'use strict';

// Configuration
const PORT = process.env.PORT;
const SEED = process.env.SEED;

const defaults = require('../settings/default');
const playnet = require('../settings/playnet');

const path = process.env.HOME + '/.fabric';
const file = path + '/wallet.json';

// Dependencies
const fs = require('fs');
const { Command } = require('commander');

// Fabric Types
const CLI = require('../types/cli');
const Wallet = require('../types/wallet');
const Environment = require('../types/environment');

// Services
const Bitcoin = require('../services/bitcoin');
const Matrix = require('../services/matrix');

// Settings
const settings = {
  listen: true,
  peers: [].concat(playnet.peers),
  services: [
    'matrix'
  ],
  port: PORT,
  seed: SEED,
  key: {
    SEED,
  },
  // TODO: remove Wallet-specfic configuration
  wallet: {
    seed: SEED
  }
};

// Define Main Program
async function main () {
  // Argument Parsing
  const program = new Command();
  const wallet = new Wallet();
  const environment = new Environment();

  // ### [!!!] Toxic Waste [!!!]
  let seed = null;
  let secret = null;

  // Configure Program
  program.name('fabric');
  program.option('--earn', 'Enable earning.');
  program.option('--seed', 'Load from mnemonic seed.');
  program.option('--xpub', 'Load from xpub.');
  program.option('--keygen', 'Generate a new seed.');
  program.option('--force', 'Force generation of new seed.');
  program.option('--password <PASSWORD>', 'Specify the encryption passphrase.');
  program.parse(process.argv);

  if (!environment.walletExists() || (program.keygen && program.force)) {
    seed = await wallet._createSeed();
  } else {
    seed = environment.readWallet();
  }

  if (program.keygen) {
    // ### [!!!] Toxic Waste [!!!]
    if (!environment.walletExists() || program.force) {
      // TODO: remove from log output...
      console.warn('[FABRIC:KEYGEN]', 'GENERATED_SEED', '=', seed);
      console.warn('[FABRIC:KEYGEN]', 'Saving new wallet to path:', path);
      // console.warn('[FABRIC:KEYGEN]', 'Wallet password:', program.password);

      try {
        environment.makeStore();
      } catch (exception) {
        // console.error('[FABRIC:KEYGEN]', 'Could prepare wallet store:', exception);
      }

      fs.writeFileSync(file, JSON.stringify({
        '@type': 'WalletStore',
        '@data': seed
      }, null, '  ') + '\n');

      // TODO: replicate this program in C / ASM
      console.warn('[FABRIC:KEYGEN]', '[!!!]', 'WARNING!', 'TOXIC WASTE ABOVE', '[!!!]');
      console.warn('[FABRIC:KEYGEN]', '[!!!]', 'The above is PRIVATE KEY MATERIAL, which can be used to');
      console.warn('[FABRIC:KEYGEN]', '[!!!]', 'spend funds from this wallet & deanonymize historical transactions.');
      console.error('[FABRIC:KEYGEN]', '[!!!]', 'DO NOT DISTRIBUTE', '[!!!]');
    } else {
      console.warn('[FABRIC:KEYGEN]', 'Key file exists, no data will be written.  Use --force to override.');
      console.warn('[FABRIC:KEYGEN]', '[WARNING]', '--force DESTROYS ALL DATA: DOUBLE-CHECK YOUR BACKUPS!');
      console.warn('[FABRIC:KEYGEN]', 'EXISTING_XPUB_PUBLIC', '=', seed['@data'].xpub.public);
    }

    // prevent further execution
    process.exit();
  } else {
    // Configure Earning
    if (program.earn) {
      SETTINGS.earn = true;
    }

    // Load from Seed
    settings.key.seed = seed['@data'];
    settings.wallet.seed = seed['@data'];

    // Fabric CLI
    const chat = new CLI(settings);

    // ## Services
    // TODO: reconcile API wth @fabric/doorman as appears at: https://github.com/FabricLabs/doorman
    chat._registerService('bitcoin', Bitcoin);
    chat._registerService('matrix', Matrix);
    // chat._registerService('rpg', RPG);

    await chat.start();
  }
}

// Run Program
main().catch((exception) => {
  console.error('[SCRIPTS:CHAT]', 'Main process threw Exception:', exception);
});
