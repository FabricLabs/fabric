#!/usr/bin/env node
'use strict';

/**
 * Fabric CLI harness — official `fabric` binary entry (see package.json `bin`).
 *
 * Distribution models:
 *   • **Development** — run via `node scripts/fabric.js` / `npm run chat`; uses system Node.
 *   • **Bundled** — `npm run make:binary` (pkg): embeds a Node-compatible runtime + this script;
 *     native `fabric.node` is not inside the pkg blob; load optional acceleration from disk
 *     (`FABRIC_ADDON_PATH`) or ship without it (pure JS fallbacks).
 *
 * Terminal UI: default command is `shell`/`chat` → {@link ../contracts/shell} → {@link ../types/cli} (Blessed TUI).
 *
 * Optional C acceleration (narrow API): {@link ../functions/fabricNativeAccel}
 */

if (process.env.FABRIC_DEBUG_NATIVE === '1' || process.env.FABRIC_DEBUG_NATIVE === 'true') {
  try {
    const n = require('../functions/fabricNativeAccel');
    console.error('[FABRIC:NATIVE]', n.status());
  } catch (e) {
    console.error('[FABRIC:NATIVE]', e.message);
  }
}

// Constants
const {
  BITCOIN_GENESIS
} = require('../constants');

// Settings (load for env-backed defaults used by Environment / CLI)
require('../settings/local');

// Paths
const path = process.env.HOME + '/.fabric';
const file = path + '/wallet.json';

// Dependencies
const { Command } = require('commander');

// Fabric Types
const Environment = require('../types/environment');

// Contracts
const OP_START = require('../contracts/node');
const OP_SHELL = require('../contracts/shell');
const OP_EXCHANGE = require('../contracts/exchange');
const OP_MOUNT = require('../contracts/mount');
const OP_SETUP = require('../contracts/setup');
const OP_VERIFY = require('../contracts/verify');
const OP_TEST = require('../contracts/test');

const COMMANDS = {
  START: OP_START,
  SHELL: OP_SHELL,
  CHAT: OP_SHELL,
  EXCHANGE: OP_EXCHANGE,
  MOUNT: OP_MOUNT,
  SETUP: OP_SETUP,
  VERIFY: OP_VERIFY,
  TEST: OP_TEST
};

async function main () {
  const environment = new Environment(process.wallet);
  const program = new Command();

  environment.start();

  program.name('fabric');

  program.command('mount')
    .description('Mount a Fabric filesytem.')
    .action(COMMANDS.MOUNT.bind({ environment, program }));

  program.command('setup')
    .description('Ensures your environment configuration.')
    .action(COMMANDS.SETUP.bind({ environment, program }));

  program.command('verify')
    .description('Enables verification of key ownership.')
    .action(COMMANDS.VERIFY.bind({ environment, program }));

  program.command('start')
    .description('Initiate peer bootstrapping.')
    .action(COMMANDS.START.bind({ environment }));

  program.command('shell', { isDefault: true })
    .description('Open the interactive Fabric shell (Blessed TUI).')
    .action(COMMANDS.SHELL.bind({ environment }));

  program.command('chat')
    .description('Alias for `fabric shell`.')
    .action(COMMANDS.CHAT.bind({ environment }));

  program.command('exchange')
    .description('Runs a local exchange node.')
    .action(COMMANDS.EXCHANGE.bind({ environment }));

  program.command('test')
    .description('Run the test chain.')
    .action(COMMANDS.TEST.bind({ environment }));

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

  await program.parseAsync(process.argv);

  if (!environment.wallet) {
    if (environment.walletExists() && !program.force) {
      console.warn('[FABRIC:CLI]', 'Wallet file exists, no data will be written.  Use --force to override.');
      console.warn('[FABRIC:CLI]', '[WARNING]', '--force DESTROYS ALL DATA: DOUBLE-CHECK YOUR BACKUPS!');
      console.warn('[FABRIC:CLI]', 'EXISTING_XPUB_PUBLIC', '=', environment.wallet.key.xpub);
    } else {
      await OP_SETUP.apply({ environment, program });
    }

    process.exit();
  } else if (program.test) {
    console.log('[FABRIC:CLI]', 'Not yet implemented.');
    process.exit();
  } else if (program.receive) {
    const address = await environment.wallet.receiveAddress();

    console.log('[FABRIC:CLI]', '$BTC', 'Receive Address:', address.toString());
    process.exit();
  }

  return this;
}

main().catch((exception) => {
  console.error('[FABRIC:CLI]', 'Main Process Exception:', exception);
});
