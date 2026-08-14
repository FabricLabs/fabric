'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const IDENTITY_ENV = [
  'NODE_ENV',
  'FABRIC_SEED',
  'FABRIC_MNEMONIC',
  'FABRIC_XPRV',
  'FABRIC_XPUB',
  'FABRIC_PASSWORD',
  'FABRIC_HUB_ADMIN_TOKEN',
  'FABRIC_HUB_ADMIN_TOKEN_FILE'
];

/**
 * Isolated `$HOME` + wallet path for Environment tests. Restores identity env.
 * @param {string} [prefix='fabric-env-']
 * @returns {{ home: string, store: string, walletPath: string, restore: function, clearIdentityEnv: function, leftoverWalletTemporaryFiles: function }}
 */
function withIsolatedHome (prefix = 'fabric-env-') {
  const prev = {};
  for (const key of IDENTITY_ENV) prev[key] = process.env[key];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = path.join(home, '.fabric');
  const walletPath = path.join(store, 'wallet.json');
  return {
    home,
    store,
    walletPath,
    clearIdentityEnv () {
      delete process.env.FABRIC_SEED;
      delete process.env.FABRIC_MNEMONIC;
      delete process.env.FABRIC_XPRV;
      delete process.env.FABRIC_XPUB;
      delete process.env.FABRIC_PASSWORD;
      delete process.env.FABRIC_HUB_ADMIN_TOKEN;
      delete process.env.FABRIC_HUB_ADMIN_TOKEN_FILE;
    },
    leftoverWalletTemporaryFiles () {
      try {
        const base = path.basename(walletPath);
        return fs.readdirSync(store).filter((name) => {
          return name.startsWith(base + '.') && name.endsWith('.tmp');
        });
      } catch (error) {
        if (error && error.code === 'ENOENT') return [];
        throw error;
      }
    },
    restore () {
      for (const key of IDENTITY_ENV) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  };
}

module.exports = { withIsolatedHome };
