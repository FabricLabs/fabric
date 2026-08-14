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
 * Terminal UI: `setup` → {@link ../contracts/setup} → {@link ../types/setup} (lightweight Blessed
 * environment/key manager). Default command is `shell`/`chat` → {@link ../contracts/shell} →
 * {@link ../types/cli} (full Blessed TUI).
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

// Settings (operator local.js when present; else packaged local.example.js)
require('../functions/loadLocalSettings').loadLocalSettings();

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
  const argv = process.argv;

  environment.start();

  program.name('fabric');

  program.command('mount')
    .description('Mount a Fabric filesytem.')
    .action(COMMANDS.MOUNT.bind({ environment, program }));

  program.command('setup')
    .description('View and manage local environment keys (lightweight TUI).')
    .option('--no-tui', 'Skip the TUI (one-shot inspect / generate).')
    .option('--json', 'Print a public environment snapshot as JSON and exit.')
    .option('--backup [FILE]', 'Write a wallet backup and exit (default: ~/.fabric/backups/).')
    .option('--restore <FILE>', 'Restore wallet from a backup file and exit.')
    .option('--unlock', 'Unlock a password-protected wallet and exit.')
    .option('--lock', 'Lock the in-memory wallet and exit.')
    .option('--timeout <MINUTES>', 'Set idle auto-lock timeout (0 disables) and exit.')
    .action(COMMANDS.SETUP.bind({ environment, program }));

  program.command('verify')
    .description('Enables verification of key ownership.')
    .action(COMMANDS.VERIFY.bind({ environment, program }));

  program.command('start')
    .description('Initiate peer bootstrapping.')
    .action(COMMANDS.START.bind({ environment }));

  program.command('shell')
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

  // parseOptions() keeps node + script in operands; find a known subcommand in user args.
  const COMMAND_NAMES = Object.keys(COMMANDS).map((k) => k.toLowerCase());
  const requestedCommand = argv.slice(2).find((a) => COMMAND_NAMES.includes(a)) || null;
  const wantsHelp = argv.includes('--help') || argv.includes('-h');
  const wantsVersion = argv.includes('--version') || argv.includes('-V');
  const wantsReceive = argv.includes('--receive');

  // Help / version never require a wallet.
  if (wantsHelp || wantsVersion) {
    await program.parseAsync(argv);
    return;
  }

  const passwordFromArgv = (() => {
    const i = argv.indexOf('--password');
    if (i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('-')) return argv[i + 1];
    return process.env.FABRIC_PASSWORD || '';
  })();

  if (environment.walletLocked && passwordFromArgv) {
    try {
      environment.unlockWallet(passwordFromArgv);
    } catch (exception) {
      console.error('[FABRIC:CLI]', 'Unlock failed:', exception.message || exception);
      process.exit(1);
      return;
    }
  }

  if (!environment.wallet) {
    if (requestedCommand === 'setup') {
      await program.parseAsync(argv);
      return;
    }

    if (environment.walletLocked) {
      // Sealed wallet stays locked; shell /unlock or `fabric setup` can open it.
    } else if (environment.walletExists()) {
      console.error('[FABRIC:CLI]', `Wallet file exists but could not be loaded: ${environment.WALLET_FILE}`);
      console.error('[FABRIC:CLI]', 'Fix or remove the file, or run: fabric setup --force');
      console.error('[FABRIC:CLI]', '[WARNING]', '--force DESTROYS ALL DATA: DOUBLE-CHECK YOUR BACKUPS!');
      process.exit(1);
      return;
    } else {
      console.error('[FABRIC:CLI]', 'No wallet configured. Run: fabric setup');
      process.exit(1);
      return;
    }
  }

  const shouldDefaultShell = !requestedCommand && !wantsReceive;
  const parseArgv = shouldDefaultShell ? argv.concat(['shell']) : argv;
  await program.parseAsync(parseArgv);

  if (program.test) {
    console.log('[FABRIC:CLI]', 'Not yet implemented.');
    process.exit();
  } else if (program.receive) {
    const address = await environment.wallet.receiveAddress();

    console.log('[FABRIC:CLI]', '$BTC', 'Receive Address:', address.toString());
    process.exit();
  }
}

main().catch((exception) => {
  console.error('[FABRIC:CLI]', 'Main Process Exception:', exception);
});
