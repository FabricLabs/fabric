/**
 * OP_SETUP () : Configures the local Fabric environment.
 *
 * Interactive (TTY): lightweight Blessed TUI over {@link module:functions/fabricSetup}
 * — view public key data, backup, restore, generate / regenerate.
 * One-shot flags (`--no-tui`, `--json`, `--backup`, `--restore`, `--force`) skip the TUI.
 */

'use strict';

const fabricSetup = require('../functions/fabricSetup');
const SetupTui = require('../types/setup');

/**
 * @param {Object} [opts] Commander command options.
 * @returns {Promise<string>}
 */
async function OP_SETUP (opts = {}) {
  const globalOpts = (this.program && typeof this.program.opts === 'function')
    ? this.program.opts()
    : {};
  const merged = Object.assign({}, globalOpts, opts && typeof opts === 'object' ? opts : {});

  if (fabricSetup.shouldLaunchTui(merged, { stdout: process.stdout })) {
    const ui = new SetupTui(this.environment, {
      passphrase: merged.passphrase || '',
      password: merged.password || process.env.FABRIC_PASSWORD || '',
      walletFile: merged.wallet,
      force: !!merged.force
    });
    await ui.start();
    return JSON.stringify({
      wallet: this.environment.wallet && this.environment.wallet.id
    });
  }

  const result = await fabricSetup.runSetupCli(this.environment, merged);
  return JSON.stringify({
    ok: result && result.ok !== false,
    wallet: this.environment.wallet && this.environment.wallet.id,
    skipped: !!(result && result.skipped)
  });
}

module.exports = OP_SETUP;
