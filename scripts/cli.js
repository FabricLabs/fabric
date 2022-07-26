#!/usr/bin/env node

// Constants
const {
  BITCOIN_GENESIS
} = require('../constants');

// Settings
const settings = require('../settings/local');

// Paths
const path = process.env.HOME + '/.fabric';
const file = path + '/wallet.json';

// Dependencies
const { Command } = require('commander');

// Fabric Types
const Wallet = require('../types/wallet');
const Machine = require('../types/machine');
const Environment = require('../types/environment');

// Contracts
const OP_START = require('../contracts/node');
const OP_CHAT = require('../contracts/chat');
const OP_EXCHANGE = require('../contracts/exchange');
const OP_SETUP = require('../contracts/setup');
const OP_TEST = require('../contracts/test');

const COMMANDS = {
  'START': OP_START,
  'CHAT': OP_CHAT,
  'EXCHANGE': OP_EXCHANGE,
  'SETUP': OP_SETUP,
  'TEST': OP_TEST
};

// Define Main Program
async function main (input = {}) {
  // Environment
  const environment = new Environment(process.wallet);

  // Argument Parsing
  const program = new Command();
  const machine = new Machine({
    content: {},
    environment: environment
  });

  // Read Environment
  environment.start();

  // Configure Program
  program.name('fabric');

  // Declare Commands
  // Configure the environment.
  program.command('setup')
    .description('Ensures your environment configuration.')
    .action(COMMANDS['SETUP'].bind(environment));

  // Run the basic node.
  program.command('start')
    .description('Initiate peer bootstrapping.')
    .action(COMMANDS['START'].bind(environment));

  // Loads the terminal-based UI.
  program.command('chat', { isDefault: true })
    .description('Open P2P chat.')
    .action(COMMANDS['CHAT'].bind(environment));

  // Load the file exchange.
  program.command('exchange')
    .description('Runs a local exchange node.')
    .action(COMMANDS['EXCHANGE'].bind(environment));

  // Run the test chain.
  program.command('test')
    .description('Run the test chain.')
    .action(COMMANDS['TEST'].bind(environment));

  // Options
  program.option('--earn', 'Enable earning.', false);
  program.option('--port <PORT NUMBER>', 'Specify the Fabric P2P communication port.', 7777);
  program.option('--seed <SEED PHRASE>', 'Specify the BIP 39 seed phrase (12 or 24 words).');
  program.option('--xpub <XPUB>', 'Load from xpub.');
  program.option('--anchor <GENESIS>', 'Specify the anchor chain.', BITCOIN_GENESIS);
  program.option('--receive', 'Generate a fresh receiving address.', false);
  program.option('--trust <PUBKEY@host:port>', 'Explicit trust of events from this peer.');
  program.option('--force', 'Force dangerous behavior.', false);
  program.option('--noclobber', 'Test dangerous behavior.', true);
  program.option('--passphrase <PASSPHRASE>', 'Specify the BIP 39 passphrase.', '');
  program.option('--password <PASSWORD>', 'Specify the encryption password.', '');
  program.option('--wallet <FILE>', 'Load wallet from file.', file);
  program.option('-n, --keygen', 'Generate a new seed.  Consider the privacy of your surroundings!');

  // Parse Arguments
  program.parse(process.argv);

  // TODO: read & test contracts
  // const contracts = environment.readContracts();
  // console.log('contracts:', contracts);

  // Behaviors
  if (program.keygen || !environment.wallet) {
    if (environment.walletExists() && !program.force) {
      console.warn('[FABRIC:CLI]', 'Wallet file exists, no data will be written.  Use --force to override.');
      console.warn('[FABRIC:CLI]', '[WARNING]', '--force DESTROYS ALL DATA: DOUBLE-CHECK YOUR BACKUPS!');
      console.warn('[FABRIC:CLI]', 'EXISTING_XPUB_PUBLIC', '=', environment.wallet.key.xpub);
    } else {
      const seed = Wallet.createSeed(program.passphrase);
      const wallet = Wallet.fromSeed(seed);
      const object = wallet.export();

      switch (object.type) {
        case 'FabricWallet':
          try {
            const encrypted = Object.assign({
              type: 'FabricWallet',
              version: object.version
            }, object);

            const content = JSON.stringify(encrypted, null, '  ') + '\n';
            fs.writeFileSync(file, content);
          } catch (exception) {
            console.error('[FABRIC:CLI]', 'Could not create wallet:', exception);
            process.exit(1);
          }
          break;
        default:
          console.error('[FABRIC:CLI]', 'Unexpected wallet type:', object.type, object['@type']);
          process.exit(1);
      }

      // TODO: replicate this program in C / ASM
      console.warn('[FABRIC:CLI]', 'No wallet found!  Generating new seed...');
      console.warn('[FABRIC:CLI]', '---');
      console.warn('[FABRIC:CLI]', '[!!!]', 'WARNING!', 'TOXIC WASTE BELOW', '[!!!]');
      console.warn('[FABRIC:CLI]', '[!!!]', 'The below is PRIVATE KEY MATERIAL, which can be used to');
      console.warn('[FABRIC:CLI]', '[!!!]', 'spend funds from this wallet & deanonymize historical transactions.');
      console.warn('[FABRIC:CLI]', '[!!!]', 'DO NOT DISTRIBUTE', '[!!!]');
      console.warn('[FABRIC:CLI]', '---');

      // ### [!!!] Toxic Waste [!!!]
      // TODO: remove from log output...
      console.warn('[FABRIC:CLI]', `Your seed phrase:\n\n${seed.phrase}\n`);
      console.warn('[FABRIC:CLI]', `Your master key: ${seed.master}`);
      console.warn('[FABRIC:CLI]', `Your master xprv: ${seed.xprv}`);

      console.warn('[FABRIC:CLI]', `The private key for your seed phrase has been saved to your wallet: ${file}`);
      console.warn('[FABRIC:CLI]', 'All done!  You can now run the `fabric` command to launch your node.');
    }

    // prevent further execution
    process.exit();
  } else if (program.test) {
    console.log('[FABRIC:CLI]', 'Not yet implemented.');
    process.exit();
  } else if (program.receive) {
    const address = await environment.wallet.receiveAddress();

    console.log('[FABRIC:CLI]', '$BTC', 'Receive Address:', address.toString());
    process.exit();
  }
}

// Run Program
main(settings).catch((exception) => {
  console.error('[FABRIC:CLI]', 'Main Process Exception:', exception);
});
