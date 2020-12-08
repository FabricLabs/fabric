#!/usr/bin/env node
// Configuration
const PORT = process.env.FABRIC_PORT;
const SEED = process.env.FABRIC_SEED;

// Settings
const defaults = require('../settings/default');
const playnet = require('../settings/playnet');

const path = process.env.HOME + '/.fabric';
const file = path + '/wallet.json';

// Dependencies
const fs = require('fs');
const { Command } = require('commander');

// Fabric Types
const Entity = require('../types/entity');
const Wallet = require('../types/wallet');
const Machine = require('../types/machine');
const Environment = require('../types/environment');

// Services
const Bitcoin = require('../services/bitcoin');
const Matrix = require('../services/matrix');

// Contracts
const OP_START = require('../contracts/node');
const OP_CHAT = require('../contracts/chat');

// Singletons
const wallet = new Wallet();
const environment = new Environment();

// ### [!!!] Toxic Waste [!!!]
let seed = null;

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
  if (!environment.walletExists()) {
    seed = await wallet._createSeed();
  } else {
    seed = environment.readWallet();
  }

  const COMMANDS = {
    'START': OP_START,
    'CHAT': OP_CHAT
  };

  // Argument Parsing
  const program = new Command();
  const machine = new Machine();

  // Configure Program
  program.name('fabric');

  program.command('start', { isDefault: true })
    .description('Initiate peer bootstrapping.')
    .action(COMMANDS['START'].bind(program));

  program.command('chat')
    .description('Open P2P chat.')
    .action(COMMANDS['CHAT'].bind(program));

  program.option('--earn', 'Enable earning.');
  program.option('--port <PORT NUMBER>', 'Specify the Fabric P2P communication port.');
  program.option('--seed <SEED PHRASE>', 'Load from mnemonic seed.');
  program.option('--xpub <XPUB>', 'Load from xpub.');
  program.option('--receive', 'Generate a fresh receiving address.');
  program.option('--trust <PUBKEY@host:port>', 'Generate a fresh receiving address.');
  program.option('--force', 'Force generation of new seed.');
  program.option('--password <PASSWORD>', 'Specify the encryption passphrase.');
  program.option('-n, --keygen', 'Generate a new seed.  Consider the privacy of your surroundings!');
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
  } else if (program.receive) {
    const wallet = new Wallet({
      key: {
        seed: seed['@data'].seed
      }
    });

    await wallet._load();
    const address = await wallet.wallet.receiveAddress();

    console.log('[FABRIC:WALLET]', '$BTC', 'Receive Address:', address.toString());
    process.exit();
  }
}

// Run Program
main().catch((exception) => {
  console.error('[SCRIPTS:CHAT]', 'Main process threw Exception:', exception);
});
