'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Environment = require('../types/environment');
const SetupTui = require('../types/setup');
const fabricSetup = require('../functions/fabricSetup');

const TEST_PASSWORD = 'test-pass-ok!';

function isolatedEnv () {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-setup-'));
  const store = path.join(home, '.fabric');
  const walletPath = path.join(store, 'wallet.json');
  const environment = new Environment({ home, path: walletPath, store, lockTimeoutMinutes: 0 });
  environment.start();
  return { home, store, walletPath, environment };
}

function withEnv (overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe('@fabric/core/functions/fabricSetup', function () {
  this.timeout(20000);

  let prevNodeEnv;
  let prevSeed;
  let prevXprv;
  let prevXpub;

  beforeEach(function () {
    prevNodeEnv = process.env.NODE_ENV;
    prevSeed = process.env.FABRIC_SEED;
    prevXprv = process.env.FABRIC_XPRV;
    prevXpub = process.env.FABRIC_XPUB;
    process.env.NODE_ENV = 'production';
    delete process.env.FABRIC_SEED;
    delete process.env.FABRIC_XPRV;
    delete process.env.FABRIC_XPUB;
  });

  afterEach(function () {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevSeed === undefined) delete process.env.FABRIC_SEED;
    else process.env.FABRIC_SEED = prevSeed;
    if (prevXprv === undefined) delete process.env.FABRIC_XPRV;
    else process.env.FABRIC_XPRV = prevXprv;
    if (prevXpub === undefined) delete process.env.FABRIC_XPUB;
    else process.env.FABRIC_XPUB = prevXpub;
  });

  describe('resolveSetupPath', function () {
    it('rejects empty, null-byte, and oversize paths', function () {
      assert.strictEqual(fabricSetup.resolveSetupPath(''), null);
      assert.strictEqual(fabricSetup.resolveSetupPath('foo\0bar'), null);
      assert.strictEqual(fabricSetup.resolveSetupPath('x'.repeat(fabricSetup.SETUP_PATH_MAX_LEN + 1)), null);
    });

    it('resolves relative paths against cwd', function () {
      const cwd = os.tmpdir();
      const abs = fabricSetup.resolveSetupPath('wallet-backup.json', { cwd });
      assert.strictEqual(abs, path.normalize(path.join(cwd, 'wallet-backup.json')));
    });

    it('accepts absolute paths', function () {
      const abs = path.join(os.tmpdir(), 'fabric-usb', 'wallet.json');
      assert.strictEqual(fabricSetup.resolveSetupPath(abs), path.normalize(abs));
    });
  });

  describe('shouldLaunchTui', function () {
    const tty = { isTTY: true };

    it('is true on a TTY without one-shot flags', function () {
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: tty }), true);
      });
    });

    it('is false without a TTY', function () {
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: { isTTY: false } }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: {} }), false);
      });
    });

    it('is false for json, force, backup, restore, --no-tui, and CI', function () {
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({ json: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ force: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ backup: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ backup: '/tmp/w.json' }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ unlock: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ lock: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ timeout: '15' }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ noTui: true }, { stdout: tty }), false);
        assert.strictEqual(fabricSetup.shouldLaunchTui({ tui: false }, { stdout: tty }), false);
      });
      withEnv({ CI: '1', FABRIC_SETUP_TUI: undefined }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: tty }), false);
      });
      withEnv({ CI: undefined, FABRIC_SETUP_TUI: '0' }, () => {
        assert.strictEqual(fabricSetup.shouldLaunchTui({}, { stdout: tty }), false);
      });
    });
  });

  describe('snapshot / generate / backup / restore', function () {
    it('snapshots a missing wallet without secrets', function () {
      const { home, environment } = isolatedEnv();
      try {
        const snapshot = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(snapshot.status, 'missing');
        assert.strictEqual(snapshot.walletLoaded, false);
        assert.strictEqual(snapshot.identity, null);
        const text = fabricSetup.formatSnapshot(snapshot);
        assert.ok(text.includes('missing'));
        assert.ok(!/xprv[A-Za-z0-9]{20,}/i.test(text), 'snapshot text must not contain an xprv payload');
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('generates, snapshots public fields, and refuses a second generate without force', function () {
      const { home, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { passphrase: '', password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        assert.ok(created.seed && created.seed.split(' ').length >= 12);
        assert.ok(environment.walletExists());

        const snapshot = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(snapshot.status, 'unlocked');
        assert.strictEqual(snapshot.passwordProtected, true);
        assert.ok(snapshot.identity && snapshot.identity.startsWith('id'));
        assert.ok(snapshot.pubkey);
        assert.ok(snapshot.xpub && snapshot.xpub.startsWith('xpub'));
        const text = fabricSetup.formatSnapshot(snapshot);
        assert.ok(!text.includes(created.seed));
        assert.ok(!/xprv[A-Za-z0-9]/i.test(text));

        const blocked = fabricSetup.generateWallet(environment);
        assert.strictEqual(blocked.ok, false);
        assert.ok(/already configured/i.test(blocked.error));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('backs up and restores a wallet file', function () {
      const { home, store, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        const identity = fabricSetup.snapshotEnvironment(environment).identity;
        const backupPath = path.join(store, 'backups', 'roundtrip.json');
        const backed = fabricSetup.backupWallet(environment, backupPath);
        assert.strictEqual(backed.ok, true);
        assert.ok(fs.existsSync(backupPath));

        environment.destroyWallet();
        environment.wallet = false;
        environment.walletLocked = false;
        environment.walletPublic = null;

        const restored = fabricSetup.restoreWalletFromFile(environment, backupPath, { password: TEST_PASSWORD });
        // file is gone so restore should succeed without force
        assert.strictEqual(restored.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).identity, identity);

        environment.destroyWallet();
        environment.wallet = false;
        environment.walletLocked = false;
        environment.walletPublic = null;
        const badPassword = fabricSetup.restoreWalletFromFile(environment, backupPath, {
          force: true,
          password: 'wrong-password-xx'
        });
        assert.strictEqual(badPassword.ok, false);
        assert.ok(badPassword.error);

        const again = fabricSetup.restoreWalletFromFile(environment, backupPath);
        assert.strictEqual(again.ok, false);

        const forced = fabricSetup.restoreWalletFromFile(environment, backupPath, { force: true, password: TEST_PASSWORD });
        assert.strictEqual(forced.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).identity, identity);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('restores from a seed phrase', function () {
      const { home, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        const phrase = created.seed;
        const identity = fabricSetup.snapshotEnvironment(environment).identity;

        environment.destroyWallet();
        environment.wallet = false;
        environment.walletLocked = false;
        environment.walletPublic = null;

        const restored = fabricSetup.restoreWalletFromSeed(environment, phrase, { password: TEST_PASSWORD });
        assert.strictEqual(restored.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).identity, identity);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('rejects an invalid seed phrase', function () {
      const { home, environment } = isolatedEnv();
      try {
        const result = fabricSetup.restoreWalletFromSeed(environment, 'not a mnemonic at all');
        assert.strictEqual(result.ok, false);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('reveals seed only on demand', function () {
      const { home, environment } = isolatedEnv();
      try {
        assert.strictEqual(fabricSetup.revealSecrets(environment).ok, false);
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        const secrets = fabricSetup.revealSecrets(environment);
        assert.strictEqual(secrets.ok, true);
        assert.strictEqual(secrets.seed, created.seed);
        assert.ok(secrets.xprv && secrets.xprv.startsWith('xprv'));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('refuses generate without an encryption password', function () {
      const { home, environment } = isolatedEnv();
      try {
        const result = fabricSetup.generateWallet(environment);
        assert.strictEqual(result.ok, false);
        assert.ok(/password/i.test(result.error));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('locks, unlocks, and persists idle timeout', function () {
      const { home, environment } = isolatedEnv();
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).status, 'unlocked');

        environment.lockWallet();
        const locked = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(locked.status, 'locked');
        assert.strictEqual(locked.passwordProtected, true);
        assert.ok(locked.xpub && locked.xpub.startsWith('xpub'));
        assert.strictEqual(fabricSetup.revealSecrets(environment).ok, false);

        environment.unlockWallet(TEST_PASSWORD);
        assert.strictEqual(fabricSetup.snapshotEnvironment(environment).status, 'unlocked');
        assert.strictEqual(fabricSetup.revealSecrets(environment).seed, created.seed);

        environment.setLockTimeoutMinutes(15);
        const snap = fabricSetup.snapshotEnvironment(environment);
        assert.strictEqual(snap.lockTimeoutMinutes, 15);
        const doc = JSON.parse(fs.readFileSync(environment.WALLET_FILE, 'utf8'));
        assert.strictEqual(doc.lockTimeoutMinutes, 15);
        assert.ok(doc.seal && doc.seal.ciphertext);
        assert.ok(!JSON.stringify(doc.object).includes('xprv'));
      } finally {
        environment.setLockTimeoutMinutes(0);
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('runSetupCli', function () {
    it('prints JSON snapshot for --json', async function () {
      const { home, environment } = isolatedEnv();
      const logs = [];
      const orig = console.log;
      console.log = function () { logs.push(Array.from(arguments).join(' ')); };
      try {
        const result = await fabricSetup.runSetupCli(environment, { json: true });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.snapshot.status, 'missing');
        const parsed = JSON.parse(logs.join('\n'));
        assert.strictEqual(parsed.status, 'missing');
        assert.ok(!parsed.seed);
        assert.ok(!parsed.xprv);
      } finally {
        console.log = orig;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('writes a backup via --backup', async function () {
      const { home, store, environment } = isolatedEnv();
      const origLog = console.log;
      console.log = function () {};
      try {
        const created = fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
        assert.strictEqual(created.ok, true);
        const dest = path.join(store, 'cli-backup.json');
        const result = await fabricSetup.runSetupCli(environment, { backup: dest });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.path, dest);
        assert.ok(fs.existsSync(dest));
      } finally {
        console.log = origLog;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('rejects a non-numeric --timeout', async function () {
      const { home, environment } = isolatedEnv();
      const origErr = console.error;
      console.error = function () {};
      try {
        const result = await fabricSetup.runSetupCli(environment, { timeout: 'abc' });
        assert.strictEqual(result.ok, false);
        assert.match(result.error, /integer/i);
      } finally {
        console.error = origErr;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });
});

describe('@fabric/core/types/setup', function () {
  this.timeout(20000);

  it('returns a public snapshot when render is false', async function () {
    const prev = {
      NODE_ENV: process.env.NODE_ENV,
      FABRIC_SEED: process.env.FABRIC_SEED,
      FABRIC_XPRV: process.env.FABRIC_XPRV,
      FABRIC_XPUB: process.env.FABRIC_XPUB
    };
    process.env.NODE_ENV = 'production';
    delete process.env.FABRIC_SEED;
    delete process.env.FABRIC_XPRV;
    delete process.env.FABRIC_XPUB;
    const { home, environment } = isolatedEnv();
    try {
      fabricSetup.generateWallet(environment, { password: TEST_PASSWORD });
      const ui = new SetupTui(environment, { render: false });
      const snapshot = await ui.start();
      assert.strictEqual(snapshot.status, 'unlocked');
      assert.ok(snapshot.identity && snapshot.identity.startsWith('id'));
      assert.ok(!snapshot.seed);
    } finally {
      for (const k of Object.keys(prev)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails closed on an invalid --wallet path before opening the TUI', async function () {
    const { home, environment } = isolatedEnv();
    try {
      const ui = new SetupTui(environment, { render: false, walletFile: 'bad\0path.json' });
      await assert.rejects(() => ui.start(), /Invalid --wallet path/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
