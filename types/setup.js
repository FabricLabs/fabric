'use strict';

/**
 * Lightweight Blessed TUI for `fabric setup`.
 *
 * Shows the current environment (paths, identity, XPUB) and offers view,
 * backup, restore, generate, unlock, lock, idle timeout, and encrypt. Does not
 * start a Peer, Bitcoin, or Lightning service — that is the full shell
 * (`types/cli.js`).
 *
 * @fileoverview Thin Blessed adapter over {@link module:functions/fabricSetup}.
 */

const fabricSetup = require('../functions/fabricSetup');

const MENU = [
  { id: 'generate', label: 'Generate / regenerate wallet…' },
  { id: 'unlock', label: 'Unlock wallet…' },
  { id: 'lock', label: 'Lock wallet now' },
  { id: 'timeout', label: 'Set idle lock timeout…' },
  { id: 'encrypt', label: 'Encrypt existing plaintext wallet…' },
  { id: 'reveal', label: 'Reveal seed (toxic waste)' },
  { id: 'backup', label: 'Backup wallet…' },
  { id: 'restore-file', label: 'Restore from backup file…' },
  { id: 'restore-seed', label: 'Restore from seed phrase…' },
  { id: 'refresh', label: 'Refresh public config' },
  { id: 'quit', label: 'Quit' }
];

/**
 * @param {Environment} environment
 * @param {Object} [settings]
 * @param {boolean} [settings.render=true]
 * @param {string} [settings.passphrase]
 * @class SetupTui
 */
class SetupTui {
  constructor (environment, settings = {}) {
    this.environment = environment;
    this.settings = Object.assign({
      render: true,
      passphrase: '',
      password: '',
      force: false
    }, settings);
    this.screen = null;
    this.elements = {};
    this._busy = false;
  }

  /**
   * @returns {Promise<object>} Public snapshot after the session ends.
   */
  async start () {
    if (this.settings.walletFile) {
      fabricSetup.applyWalletFileOption(this.environment, this.settings.walletFile);
    }
    if (this.settings.password && this.environment.walletLocked) {
      try {
        this.environment.unlockWallet(this.settings.password);
      } catch (_) { /* TUI can prompt */ }
    }
    if (!this.settings.render) {
      return fabricSetup.snapshotEnvironment(this.environment);
    }
    const blessed = require('blessed');
    return this._run(blessed);
  }

  /**
   * @param {object} blessed
   * @returns {Promise<object>}
   * @private
   */
  _run (blessed) {
    const self = this;
    return new Promise((resolve, reject) => {
      try {
        self.screen = blessed.screen({
          smartCSR: true,
          title: 'Fabric Setup',
          fullUnicode: true,
          input: self.settings.input,
          output: self.settings.output,
          terminal: self.settings.terminal
        });
      } catch (exception) {
        reject(exception);
        return;
      }

      self.elements.header = blessed.box({
        parent: self.screen,
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        tags: true,
        border: { type: 'line' },
        label: ' Fabric Setup ',
        content: ' Local environment · keys · backup '
      });

      self.elements.config = blessed.box({
        parent: self.screen,
        top: 3,
        left: 0,
        right: 0,
        height: '50%-3',
        tags: true,
        keys: true,
        vi: true,
        mouse: true,
        scrollable: true,
        alwaysScroll: true,
        border: { type: 'line' },
        label: ' Public configuration ',
        scrollbar: { ch: ' ', inverse: true }
      });

      self.elements.menu = blessed.list({
        parent: self.screen,
        top: '50%',
        left: 0,
        right: 0,
        bottom: 3,
        keys: true,
        vi: true,
        mouse: true,
        tags: true,
        border: { type: 'line' },
        label: ' Actions ',
        items: MENU.map((item) => item.label),
        style: {
          selected: { bg: 'white', fg: 'black' },
          item: { fg: 'white' }
        }
      });

      self.elements.status = blessed.box({
        parent: self.screen,
        bottom: 0,
        left: 0,
        right: 0,
        height: 3,
        tags: true,
        border: { type: 'line' },
        content: ' arrows/j/k  enter  q quit'
      });

      const onIdleLock = () => {
        self._setStatus('Wallet locked after idle timeout.');
        self._paint();
      };
      if (self.environment.lockSession && typeof self.environment.lockSession.on === 'function') {
        self.environment.lockSession.on('lock', onIdleLock);
      }

      const finish = () => {
        try {
          if (self.environment.lockSession && typeof self.environment.lockSession.removeListener === 'function') {
            self.environment.lockSession.removeListener('lock', onIdleLock);
          }
        } catch (_) { /* ignore */ }
        try {
          self.screen.destroy();
        } catch (_) { /* already torn down */ }
        resolve(fabricSetup.snapshotEnvironment(self.environment));
      };

      self.screen.key(['q', 'C-c'], () => {
        if (self._busy) return;
        finish();
      });

      self.elements.menu.on('select', async (_item, index) => {
        if (self._busy) return;
        const action = MENU[index];
        if (!action) return;
        if (action.id === 'quit') {
          finish();
          return;
        }
        self._busy = true;
        try {
          await self._handle(action.id);
          if (self.environment.lockSession && typeof self.environment.lockSession.touch === 'function') {
            self.environment.lockSession.touch();
          }
        } catch (exception) {
          self._setStatus(exception.message || String(exception), true);
        }
        self._busy = false;
        self._paint();
        self.elements.menu.focus();
        self.screen.render();
      });

      self._paint();
      self.elements.menu.focus();
      self.screen.render();
    });
  }

  /**
   * @private
   */
  _paint () {
    const snapshot = fabricSetup.snapshotEnvironment(this.environment);
    const body = fabricSetup.formatSnapshot(snapshot);
    if (this.elements.config) this.elements.config.setContent(body);
    if (this.elements.header) {
      const label = snapshot.status === 'unlocked'
        ? '{green-fg}unlocked{/green-fg}'
        : snapshot.status === 'locked'
          ? '{yellow-fg}locked{/yellow-fg}'
          : snapshot.status === 'unreadable'
            ? '{red-fg}unreadable{/red-fg}'
            : '{yellow-fg}no wallet{/yellow-fg}';
      this.elements.header.setContent(` Local environment · keys · backup   status: ${label}`);
    }
    if (this.screen) this.screen.render();
  }

  /**
   * @param {string} message
   * @param {boolean} [error]
   * @private
   */
  _setStatus (message, error) {
    if (!this.elements.status) return;
    const prefix = error ? '{red-fg}error{/red-fg}  ' : '';
    this.elements.status.setContent(prefix + String(message || ''));
    if (this.screen) this.screen.render();
  }

  /**
   * @param {string} label
   * @param {string} [initial]
   * @returns {Promise<string|null>}
   * @private
   */
  _ask (label, initial = '') {
    const self = this;
    const blessed = require('blessed');
    return new Promise((resolve) => {
      const prompt = blessed.prompt({
        parent: self.screen,
        border: 'line',
        height: 9,
        width: '80%',
        top: 'center',
        left: 'center',
        label: ' Fabric Setup ',
        tags: true,
        keys: true,
        vi: true
      });
      prompt.input(label, initial, (err, value) => {
        try {
          prompt.destroy();
        } catch (_) { /* ignore */ }
        self.screen.render();
        if (err || value == null) return resolve(null);
        resolve(String(value));
      });
      self.screen.render();
    });
  }

  /**
   * Censored password prompt (does not echo).
   * @param {string} label
   * @returns {Promise<string|null>}
   * @private
   */
  _askSecret (label) {
    const self = this;
    const blessed = require('blessed');
    return new Promise((resolve) => {
      const box = blessed.box({
        parent: self.screen,
        border: 'line',
        height: 7,
        width: '80%',
        top: 'center',
        left: 'center',
        label: ' Fabric Setup ',
        tags: true,
        content: String(label || 'Password:')
      });
      const input = blessed.textbox({
        parent: box,
        top: 3,
        left: 2,
        right: 2,
        height: 1,
        censor: true,
        keys: true,
        inputOnFocus: true
      });
      const done = (value) => {
        try {
          box.destroy();
        } catch (_) { /* ignore */ }
        self.screen.render();
        resolve(value);
      };
      input.on('submit', (value) => done(value == null ? '' : String(value)));
      input.on('cancel', () => done(null));
      input.key(['escape'], () => done(null));
      input.focus();
      self.screen.render();
    });
  }

  /**
   * @param {Object} [opts]
   * @param {boolean} [opts.required=true]
   * @param {boolean} [opts.confirm=true]
   * @param {string} [opts.label]
   * @returns {Promise<string|null>}
   * @private
   */
  async _askEncryptionPassword (opts = {}) {
    const required = opts.required !== false;
    const confirm = opts.confirm !== false;
    const password = await this._askSecret(opts.label || 'Encryption password (min 8):');
    if (password == null) return null;
    if (!String(password).trim()) {
      if (required) {
        this._setStatus('Encryption password required.', true);
        return null;
      }
      return '';
    }
    if (String(password).length < fabricSetup.PASSWORD_MIN_LENGTH) {
      this._setStatus(`Password must be at least ${fabricSetup.PASSWORD_MIN_LENGTH} characters.`, true);
      return null;
    }
    if (confirm) {
      const again = await this._askSecret('Confirm encryption password:');
      if (again !== password) {
        this._setStatus('Passwords did not match.', true);
        return null;
      }
    }
    return password;
  }

  /**
   * @param {string} message
   * @returns {Promise<boolean>}
   * @private
   */
  async _confirm (message) {
    const value = await this._ask(`${message}  Type yes to continue.`, 'no');
    if (value == null) return false;
    return /^y(es)?$/i.test(value.trim());
  }

  /**
   * @param {string} title
   * @param {string} body
   * @returns {Promise<void>}
   * @private
   */
  _showModal (title, body) {
    const self = this;
    const blessed = require('blessed');
    return new Promise((resolve) => {
      const box = blessed.box({
        parent: self.screen,
        label: ` ${title} `,
        content: body,
        top: 'center',
        left: 'center',
        width: '90%',
        height: '70%',
        border: { type: 'line' },
        tags: true,
        keys: true,
        vi: true,
        mouse: true,
        scrollable: true,
        alwaysScroll: true,
        style: {
          border: { fg: 'red' }
        }
      });
      const done = () => {
        try {
          box.destroy();
        } catch (_) { /* ignore */ }
        self.elements.menu.focus();
        self.screen.render();
        resolve();
      };
      box.key(['enter', 'escape', 'q', 'space'], done);
      box.focus();
      self.screen.render();
    });
  }

  /**
   * @param {string} id
   * @returns {Promise<void>}
   * @private
   */
  async _handle (id) {
    switch (id) {
      case 'refresh':
        this._setStatus('Refreshed public configuration.');
        return;
      case 'unlock':
        await this._unlock();
        return;
      case 'lock':
        this.environment.lockWallet();
        this._setStatus('Wallet locked.');
        return;
      case 'timeout':
        await this._timeout();
        return;
      case 'encrypt':
        await this._encrypt();
        return;
      case 'reveal':
        await this._reveal();
        return;
      case 'backup':
        await this._backup();
        return;
      case 'restore-file':
        await this._restoreFile();
        return;
      case 'restore-seed':
        await this._restoreSeed();
        return;
      case 'generate':
        await this._generate();
        return;
      default:
        return;
    }
  }

  /**
   * @private
   */
  async _unlock () {
    const password = await this._askEncryptionPassword({
      required: true,
      confirm: false,
      label: 'Encryption password:'
    });
    if (password == null || !String(password).trim()) {
      this._setStatus('Unlock cancelled.');
      return;
    }
    try {
      this.environment.unlockWallet(password);
      this.settings.password = password;
      this._setStatus('Wallet unlocked. Idle lock is armed.');
    } catch (exception) {
      this._setStatus(exception.message || String(exception), true);
    }
  }

  /**
   * @private
   */
  async _timeout () {
    const current = this.environment.lockSession
      ? this.environment.lockSession.timeoutMinutes
      : 30;
    const value = await this._ask('Idle lock timeout in minutes (0 disables):', String(current));
    if (value == null) {
      this._setStatus('Timeout unchanged.');
      return;
    }
    this.environment.setLockTimeoutMinutes(value);
    const n = this.environment.lockSession.timeoutMinutes;
    this._setStatus(n === 0 ? 'Idle lock disabled.' : `Idle lock: ${n} minutes.`);
  }

  /**
   * @private
   */
  async _encrypt () {
    if (this.environment.walletLocked) {
      this._setStatus('Unlock the wallet before encrypting.', true);
      return;
    }
    if (!this.environment.wallet) {
      this._setStatus('No wallet loaded.', true);
      return;
    }
    const password = await this._askEncryptionPassword({
      required: true,
      confirm: true,
      label: 'New encryption password (min 8):'
    });
    if (password == null || !String(password).trim()) {
      this._setStatus('Encrypt cancelled.');
      return;
    }
    try {
      this.environment.encryptWallet(password);
      this.settings.password = password;
      this._setStatus('Wallet encrypted at rest.');
    } catch (exception) {
      this._setStatus(exception.message || String(exception), true);
    }
  }

  /**
   * @private
   */
  async _reveal () {
    const ok = await this._confirm('Show the seed phrase on screen? Anyone who can see this terminal can steal funds.');
    if (!ok) {
      this._setStatus('Reveal cancelled.');
      return;
    }
    const secrets = fabricSetup.revealSecrets(this.environment);
    if (!secrets.ok) {
      this._setStatus(secrets.error, true);
      return;
    }
    const lines = [
      '{red-fg}{bold}TOXIC WASTE{/bold}{/red-fg}',
      'The seed phrase is private key material. Write it down offline.',
      'Do not screenshot, paste into chat, or store in cloud-synced folders.',
      '',
      secrets.seed || '(no mnemonic on this wallet — xprv only)',
      '',
      'Press enter to hide.'
    ];
    await this._showModal('Seed (toxic waste)', lines.join('\n'));
    this._setStatus('Seed hidden. It is not written to disk by this view.');
  }

  /**
   * @private
   */
  async _backup () {
    const suggested = fabricSetup.defaultBackupPath(this.environment);
    const dest = await this._ask('Backup file path:', suggested);
    if (dest == null || !String(dest).trim()) {
      this._setStatus('Backup cancelled.');
      return;
    }
    const result = fabricSetup.backupWallet(this.environment, dest.trim());
    if (!result.ok) {
      this._setStatus(result.error, true);
      return;
    }
    this._setStatus('Backup written: ' + result.path);
  }

  /**
   * @private
   * @returns {boolean}
   */
  _needsForce () {
    return !!(this.environment.wallet || this.environment.walletExists());
  }

  /**
   * @private
   */
  async _restoreFile () {
    const src = await this._ask('Restore from backup file:', '');
    if (src == null || !String(src).trim()) {
      this._setStatus('Restore cancelled.');
      return;
    }
    if (this._needsForce()) {
      const ok = await this._confirm('Overwrite the current wallet from this backup? This DESTROYS local key material.');
      if (!ok) {
        this._setStatus('Restore cancelled.');
        return;
      }
    }
    const password = await this._askEncryptionPassword({
      required: false,
      confirm: false,
      label: 'Encryption password (unlock sealed backup, or seal a plaintext restore):'
    });
    if (password == null) {
      this._setStatus('Restore cancelled.');
      return;
    }
    const result = fabricSetup.restoreWalletFromFile(this.environment, src.trim(), {
      force: true,
      passphrase: this.settings.passphrase || '',
      password: password
    });
    if (!result.ok) {
      this._setStatus(result.error, true);
      return;
    }
    if (password) this.settings.password = password;
    this._setStatus('Wallet restored. id: ' + result.walletId);
  }

  /**
   * @private
   */
  async _restoreSeed () {
    const phrase = await this._ask('BIP39 seed phrase (12–24 words):', '');
    if (phrase == null || !String(phrase).trim()) {
      this._setStatus('Restore cancelled.');
      return;
    }
    if (this._needsForce()) {
      const ok = await this._confirm('Overwrite the current wallet from this seed? This DESTROYS local key material.');
      if (!ok) {
        this._setStatus('Restore cancelled.');
        return;
      }
    }
    const passphrase = await this._ask('BIP39 passphrase (empty for none):', this.settings.passphrase || '');
    const password = await this._askEncryptionPassword({
      required: true,
      confirm: true,
      label: 'Encryption password (min 8, required):'
    });
    if (password == null || !String(password).trim()) {
      this._setStatus('Restore cancelled (encryption password required).');
      return;
    }
    const result = fabricSetup.restoreWalletFromSeed(this.environment, phrase.trim(), {
      force: true,
      passphrase: passphrase == null ? '' : passphrase,
      password: password
    });
    if (!result.ok) {
      this._setStatus(result.error, true);
      return;
    }
    this.settings.password = password;
    this._setStatus('Wallet restored from seed. id: ' + result.walletId);
  }

  /**
   * @private
   */
  async _generate () {
    const exists = this._needsForce();
    if (exists) {
      const ok = await this._confirm('Regenerate DESTROYS the current wallet. Type yes only after you have a backup.');
      if (!ok) {
        this._setStatus('Generate cancelled.');
        return;
      }
    }
    const passphrase = await this._ask('BIP39 passphrase (empty for none):', this.settings.passphrase || '');
    const password = await this._askEncryptionPassword({
      required: true,
      confirm: true,
      label: 'Encryption password (min 8, required):'
    });
    if (password == null || !String(password).trim()) {
      this._setStatus('Generate cancelled (encryption password required).');
      return;
    }
    const result = fabricSetup.generateWallet(this.environment, {
      force: true,
      passphrase: passphrase == null ? '' : passphrase,
      password: password
    });
    if (!result.ok) {
      this._setStatus(result.error, true);
      return;
    }
    const lines = [
      '{red-fg}{bold}TOXIC WASTE — write this down offline{/bold}{/red-fg}',
      'Anyone with this seed can spend funds and deanonymize history.',
      '',
      result.seed,
      '',
      'Wallet id: ' + result.walletId,
      'Saved to: ' + this.environment.WALLET_FILE,
      '',
      'Press enter to hide the seed and return to setup.'
    ];
    await this._showModal('New seed (toxic waste)', lines.join('\n'));
    this.settings.password = password;
    this._setStatus('Wallet saved. Next: quit, then run `fabric` to open the shell.');
  }
}

module.exports = SetupTui;
