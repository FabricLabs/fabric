'use strict';

// Constants
const {
  FIXTURE_SEED
} = require('../constants');
const { tryParsePersistedJson } = require('../functions/wireJson');
const {
  sealJson,
  openSealedJson,
  isPasswordProtectedDocument,
  SEAL_SCHEME
} = require('../functions/sealedBlob');
const {
  IdentityLock,
  clampLockTimeoutMinutes,
  DEFAULT_LOCK_TIMEOUT_MINUTES
} = require('../functions/identityLock');

// Dependencies
const fs = require('fs');
const path = require('path');
const os = require('os');
const merge = require('lodash.merge');

// Fabric Types
const Actor = require('./actor');
const Entity = require('./entity');
const Wallet = require('./wallet');
const Identity = require('./identity');

// Filters
const any = (candidate => (candidate && typeof candidate !== 'undefined'));

/**
 * Interact with the user's Environment.
 */
class Environment extends Entity {
  /**
   * Create an instance of {@link Environment}.
   * @param {Object} [settings] Settings for the Fabric environment.
   * @returns {Environment} Instance of the Environment.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      home: process.env.HOME,
      path: process.env.HOME + '/.fabric/wallet.json',
      state: {
        status: 'INITIALIZED'
      },
      store: process.env.HOME + '/.fabric'
    }, this.settings, settings);

    this.local = null;
    this.wallet = null;
    this.walletPublic = null;
    this.walletLocked = false;
    this.lockSession = new IdentityLock({
      timeoutMinutes: this._defaultLockTimeoutMinutes(),
      timeoutMs: Number.isFinite(this.settings.lockTimeoutMs) ? this.settings.lockTimeoutMs : undefined
    });
    this.bitcoinConfig = null;

    this._state = {
      status: this.settings.state.status,
      content: this.settings.state,
      variables: process.env
    };

    return this;
  }

  get state () {
    return JSON.parse(JSON.stringify(this._state.content));
  }

  get status () {
    return this._state.status;
  }

  get SEED_FILE () {
    return '.FABRIC_SEED';
  }

  get WALLET_FILE () {
    return this.settings.path;
  }

  /**
   * @returns {number}
   * @private
   */
  _defaultLockTimeoutMinutes () {
    if (this.settings.lockTimeoutMinutes != null) {
      return clampLockTimeoutMinutes(this.settings.lockTimeoutMinutes);
    }
    if (process.env.FABRIC_LOCK_TIMEOUT_MINUTES != null && process.env.FABRIC_LOCK_TIMEOUT_MINUTES !== '') {
      return clampLockTimeoutMinutes(process.env.FABRIC_LOCK_TIMEOUT_MINUTES);
    }
    return DEFAULT_LOCK_TIMEOUT_MINUTES;
  }

  /**
   * Public (non-secret) fields derived from an unlocked wallet.
   * @param {Wallet} wallet
   * @returns {object}
   * @private
   */
  _publicRecordFromWallet (wallet) {
    const record = {
      id: wallet && wallet.id ? String(wallet.id) : null,
      xpub: (wallet && (wallet.xpub || (wallet.key && wallet.key.xpub))) || null,
      identity: null,
      pubkey: null,
      derivation: null
    };
    try {
      if (wallet && wallet.key) {
        const identity = new Identity(wallet.key);
        const network = this.settings.network || process.env.FABRIC_NETWORK || 'regtest';
        identity._state.content.network = String(network);
        record.identity = identity.toString();
        record.pubkey = identity.pubkey || null;
        record.derivation = identity.derivation || null;
      }
    } catch (_) { /* public record is best-effort */ }
    return record;
  }

  /**
   * @param {object} document
   * @private
   */
  _writeWalletDocument (document) {
    const content = JSON.stringify(document, null, '  ') + '\n';
    const target = this.WALLET_FILE;
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(temporary, 0o600);
    } catch (_) { /* best-effort */ }
    try {
      fs.renameSync(temporary, target);
    } catch (exception) {
      try { fs.unlinkSync(temporary); } catch (_) { /* ignore */ }
      throw exception;
    }
    try {
      fs.chmodSync(target, 0o600);
    } catch (_) { /* best-effort */ }
  }

  /**
   * Bind the idle-lock wipe handler without dropping other `lock` listeners
   * (shell warnings, setup TUI).
   * @private
   */
  _installWalletLockHandler () {
    if (this._walletLockHandler) {
      this.lockSession.removeListener('lock', this._walletLockHandler);
    }
    this._walletLockHandler = () => {
      if (this.wallet && this.wallet.key && typeof this.wallet.key.secure === 'function') {
        try { this.wallet.key.secure(); } catch (_) { /* wipe is best-effort */ }
      }
      this.wallet = false;
      this.walletLocked = true;
    };
    this.lockSession.on('lock', this._walletLockHandler);
  }

  /**
   * @returns {object|null}
   */
  readWalletDocument () {
    if (!this.walletExists()) return null;
    const data = this.readWallet();
    const text = typeof data === 'string' ? data : String(data ?? '');
    if (text.trim() === '') return null;
    const pr = tryParsePersistedJson(text);
    if (!pr.ok) throw pr.error;
    return pr.value;
  }

  /**
   * Drop in-memory secrets; public snapshot remains.
   * @returns {Environment}
   */
  lockWallet () {
    if (this.wallet && this.wallet.key && typeof this.wallet.key.secure === 'function') {
      try {
        this.wallet.key.secure();
      } catch (_) { /* wipe is best-effort */ }
    }
    this.wallet = false;
    this.walletLocked = !!(this.walletPublic && (this.walletPublic.xpub || this.walletPublic.id));
    this.lockSession.lock();
    return this;
  }

  /**
   * Decrypt a password-protected wallet into memory and start the idle timer.
   * @param {string} password
   * @returns {Environment}
   */
  unlockWallet (password) {
    const input = this.readWalletDocument();
    if (!input) throw new Error('No wallet file to unlock.');
    if (!isPasswordProtectedDocument(input)) {
      throw new Error('Wallet is not password-protected.');
    }
    const inner = openSealedJson(input, password);
    if (!inner || (!inner.xprv && !inner.seed)) {
      throw new Error('Sealed wallet is missing key material.');
    }
    this.wallet = new Wallet({
      key: {
        seed: inner.seed,
        xprv: inner.xprv,
        xpub: inner.xpub
      },
      version: input.walletVersion
    });
    this.wallet.start();
    this.walletLocked = false;
    this.walletPublic = (input.object && typeof input.object === 'object')
      ? Object.assign({}, input.object)
      : this._publicRecordFromWallet(this.wallet);
    if (input.lockTimeoutMinutes != null) {
      this.lockSession.setTimeoutMinutes(clampLockTimeoutMinutes(input.lockTimeoutMinutes));
    }
    this._installWalletLockHandler();
    this.lockSession.unlock({ unlocked: true });
    return this;
  }

  /**
   * Persist idle-lock timeout on the wallet document (public field).
   * @param {number} minutes
   * @returns {Environment}
   */
  setLockTimeoutMinutes (minutes) {
    const n = clampLockTimeoutMinutes(minutes);
    this.lockSession.setTimeoutMinutes(n);
    if (!this.walletExists()) return this;
    try {
      const doc = this.readWalletDocument();
      if (!doc) return this;
      doc.lockTimeoutMinutes = n;
      this._writeWalletDocument(doc);
    } catch (_) { /* timeout is still applied in-memory */ }
    return this;
  }

  /**
   * Encrypt a legacy plaintext wallet file in place.
   * @param {string} password
   * @returns {Environment}
   */
  encryptWallet (password) {
    if (!this.wallet || !this.wallet.key) {
      throw new Error('Unlock or load a plaintext wallet before encrypting.');
    }
    return this.setWallet(this.wallet, true, { password: password, encrypt: true });
  }

  get XPRV_FILE () {
    return '.FABRIC_XPRV';
  }

  get XPUB_FILE () {
    return '.FABRIC_XPUB';
  }

  get passphrase () {
    return this.readVariable('PASSPHRASE');
  }

  get seed () {
    // Precedence: settings / env only. CWD `.FABRIC_SEED` (`this.local`) is opt-in
    // via `settings.allowCwdSeed` so a planted file cannot outrank `~/.fabric/wallet.json`.
    const explicit = [
      this.settings.seed,
      this['FABRIC_SEED'],
      this.readVariable('FABRIC_SEED')
    ];
    if (this.settings.allowCwdSeed === true) {
      explicit.push(this.local);
    }
    const normalized = explicit.map((candidate) => (
      typeof candidate === 'string' ? candidate.trim() : candidate
    ));
    if (process.env.NODE_ENV === 'test') {
      normalized.push(FIXTURE_SEED);
    }
    return normalized.find(any);
  }

  get xprv () {
    return [
      // FIXTURE_XPRV,
      this.settings.xprv,
      this['FABRIC_XPRV'],
      this.readVariable('FABRIC_XPRV'),
      this.wallet && this.wallet.xprv
    ].find(any);
  }

  get xpub () {
    return [
      // FIXTURE_XPUB,
      this.settings.xpub,
      this['FABRIC_XPUB'],
      this.readVariable('FABRIC_XPUB'),
      this.wallet && this.wallet.xpub
    ].find(any);
  }

  get bitcoinSettings () {
    if (!this.bitcoinConfig) return {};
    return this._toFabricSettings(this.bitcoinConfig);
  }

  /**
   * Read and parse Bitcoin configuration from bitcoin.conf file
   * @param {String} [configPath] Optional path to bitcoin.conf, defaults to ~/.bitcoin/bitcoin.conf
   * @returns {Object} Parsed Bitcoin configuration object
   */
  _getDefaultBitcoinDatadir () {
    switch (os.platform()) {
      case 'darwin': // macOS
        return path.join(os.homedir(), 'Library', 'Application Support', 'Bitcoin');
      case 'win32': // Windows
        return path.join(os.homedir(), 'AppData', 'Roaming', 'Bitcoin');
      default: // Linux and other Unix-like systems
        return path.join(os.homedir(), '.bitcoin');
    }
  }

  _readBitcoinConf (configPath = null) {
    // Default path if not provided
    if (!configPath) {
      configPath = path.join(this._getDefaultBitcoinDatadir(), 'bitcoin.conf');
    }

    const config = {
      found: false,
      path: configPath,
      rpc: {},
      network: {},
      general: {}
    };

    try {
      // Check if file exists
      if (!fs.existsSync(configPath)) {
        return config;
      }

      // Read the file
      const fileContent = fs.readFileSync(configPath, 'utf8');
      config.found = true;

      // Parse the configuration
      const lines = fileContent.split('\n');

      for (const line of lines) {
        // Skip empty lines and comments
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
          continue;
        }

        // Split key=value pairs
        const equalIndex = trimmedLine.indexOf('=');
        if (equalIndex === -1) {
          // Lines without = are treated as boolean flags (set to true)
          config.general[trimmedLine] = true;
          continue;
        }

        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();

        // Categorize configuration options
        if (key.startsWith('rpc') || ['server', 'rpcbind', 'rpcallowip'].includes(key)) {
          config.rpc[key] = this._parseConfigValue(value);
        } else if (['testnet', 'testnet4', 'regtest', 'signet', 'mainnet'].includes(key)) {
          config.network[key] = this._parseConfigValue(value);
        } else {
          config.general[key] = this._parseConfigValue(value);
        }
      }

      // Infer network from flags
      if (config.network.testnet) {
        config.network.active = 'testnet';
      } else if (config.network.testnet4) {
        config.network.active = 'testnet4';
      } else if (config.network.regtest) {
        config.network.active = 'regtest';
      } else if (config.network.signet) {
        config.network.active = 'signet';
      } else {
        config.network.active = 'mainnet';
      }

      // Set default RPC port based on network if not specified
      if (!config.rpc.rpcport) {
        switch (config.network.active) {
          case 'mainnet':
            config.rpc.rpcport = 8332;
            break;
          case 'testnet':
            config.rpc.rpcport = 18332;
            break;
          case 'regtest':
            config.rpc.rpcport = 18443;
            break;
          case 'signet':
            config.rpc.rpcport = 38332;
            break;
          case 'testnet4':
            config.rpc.rpcport = 48332;
            break;
          default:
            config.rpc.rpcport = 8332;
        }
      }

      // Default RPC host
      if (!config.rpc.rpcbind && !config.rpc.rpcconnect) {
        config.rpc.host = '127.0.0.1';
      } else {
        config.rpc.host = this._normalizeRPCHost(config.rpc.rpcbind || config.rpc.rpcconnect || '127.0.0.1');
      }

    } catch (error) {
      config.error = error.message;
    }

    return config;
  }

  /**
   * Parse configuration value to appropriate type
   * @param {String} value The raw configuration value
   * @returns {*} Parsed value (string, number, or boolean)
   */
  _parseConfigValue (value) {
    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    // Parse numbers
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    if (/^\d*\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    // Parse booleans
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true' || lowerValue === '1') {
      return true;
    }
    if (lowerValue === 'false' || lowerValue === '0') {
      return false;
    }

    // Return as string
    return value;
  }

  /**
   * True when `host` is `name:port` with exactly one colon and a numeric port (IPv4 or hostname).
   * Bare IPv6 literals (`::1`, `2001:db8::1`) have multiple colons — do not treat as host:port.
   * @param {string} host
   * @returns {boolean}
   */
  _hasSingleNumericPortSuffix (host) {
    const s = String(host).trim();
    const first = s.indexOf(':');
    const last = s.lastIndexOf(':');
    if (first === -1 || first !== last) return false;
    const tail = s.slice(last + 1);
    return /^\d+$/.test(tail);
  }

  _normalizeRPCHost (value) {
    if (!value) return '127.0.0.1';
    const host = String(value).trim();
    if (!host) return '127.0.0.1';

    // Bracketed IPv6 (e.g. rpcconnect=[::1]:8332): host only, port via _extractRPCPort.
    if (host.startsWith('[')) {
      const close = host.indexOf(']');
      if (close !== -1) return host.slice(0, close + 1);
      return host;
    }

    // bitcoin.conf: `host:port` only when a single colon separates a numeric port (not bare IPv6).
    if (this._hasSingleNumericPortSuffix(host)) {
      return host.slice(0, host.lastIndexOf(':'));
    }

    return host;
  }

  _extractRPCPort (value) {
    if (!value) return null;
    const endpoint = String(value).trim();
    if (!endpoint.includes(':')) return null;
    if (endpoint.startsWith('[')) {
      const close = endpoint.indexOf(']');
      if (close === -1) return null;
      const tail = endpoint.slice(close + 1);
      const m = /^:(\d+)$/.exec(tail);
      return m ? Number(m[1]) : null;
    }
    if (!this._hasSingleNumericPortSuffix(endpoint)) return null;
    return Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
  }

  _defaultRPCPortForNetwork (network = 'mainnet') {
    switch (network) {
      case 'testnet':
        return 18332;
      case 'testnet4':
        return 48332;
      case 'regtest':
        return 18443;
      case 'signet':
        return 38332;
      default:
        return 8332;
    }
  }

  _getChainSubdirectory (network) {
    switch (network) {
      case 'testnet':
        return 'testnet3';
      case 'testnet4':
        return 'testnet4';
      case 'regtest':
        return 'regtest';
      case 'signet':
        return 'signet';
      default:
        return '';
    }
  }

  _readAuthCookie (baseDatadir, network) {
    const chainSubdir = this._getChainSubdirectory(network);
    const cookiePath = chainSubdir
      ? path.join(baseDatadir, chainSubdir, '.cookie')
      : path.join(baseDatadir, '.cookie');

    try {
      if (!fs.existsSync(cookiePath)) return null;
      const content = fs.readFileSync(cookiePath, 'utf8').trim();
      if (!content.includes(':')) return null;
      const [username, password] = content.split(':');
      if (!username || !password) return null;
      return { username, password };
    } catch {
      return null;
    }
  }

  getBitcoinRPCCandidates (baseSettings = {}) {
    const candidates = [];
    const seen = new Set();
    const defaultDatadir = this._getDefaultBitcoinDatadir();
    const conf = this.bitcoinConfig || this._readBitcoinConf();
    const confNetwork = conf.network ? conf.network.active : null;
    const preferredHost = this._normalizeRPCHost(baseSettings.host || '127.0.0.1');

    const pushCandidate = (candidate) => {
      if (!candidate || !candidate.host || !candidate.rpcport) return;
      const normalized = {
        ...candidate,
        host: this._normalizeRPCHost(candidate.host),
        rpcport: Number(candidate.rpcport)
      };
      if (!Number.isFinite(normalized.rpcport)) return;
      const key = [
        normalized.host,
        normalized.rpcport,
        normalized.network || '',
        normalized.username || '',
        normalized.password || ''
      ].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(normalized);
    };

    if (baseSettings.host && baseSettings.rpcport) {
      pushCandidate({
        source: 'settings',
        host: baseSettings.host,
        rpcport: baseSettings.rpcport,
        network: baseSettings.network,
        username: baseSettings.username,
        password: baseSettings.password,
        secure: baseSettings.secure === true
      });
    }

    let confDatadir = defaultDatadir;
    if (conf.found) {
      const confHost = this._normalizeRPCHost(conf.rpc.rpcconnect || conf.rpc.rpcbind || conf.rpc.host || preferredHost);
      const network = confNetwork || baseSettings.network || 'mainnet';
      const port = Number(conf.rpc.rpcport || this._extractRPCPort(conf.rpc.rpcconnect || conf.rpc.rpcbind) || this._defaultRPCPortForNetwork(network));
      confDatadir = conf.general && conf.general.datadir
        ? (path.isAbsolute(conf.general.datadir) ? conf.general.datadir : path.resolve(path.dirname(conf.path), conf.general.datadir))
        : defaultDatadir;

      pushCandidate({
        source: 'bitcoin.conf',
        host: confHost,
        rpcport: port,
        network,
        username: conf.rpc.rpcuser,
        password: conf.rpc.rpcpassword,
        secure: false
      });

      const cookieAuth = this._readAuthCookie(confDatadir, network);
      if (cookieAuth) {
        pushCandidate({
          source: 'bitcoin.conf.cookie',
          host: confHost,
          rpcport: port,
          network,
          username: cookieAuth.username,
          password: cookieAuth.password,
          secure: false
        });
      }
    }

    const allNetworks = ['mainnet', 'testnet', 'signet', 'regtest', 'testnet4'];
    const preferredNetworks = [];
    if (baseSettings.network) preferredNetworks.push(baseSettings.network);
    if (confNetwork && !preferredNetworks.includes(confNetwork)) preferredNetworks.push(confNetwork);
    for (const network of allNetworks) {
      if (!preferredNetworks.includes(network)) preferredNetworks.push(network);
    }

    const datadirs = [baseSettings.datadir, confDatadir, defaultDatadir].filter(Boolean);
    for (const network of preferredNetworks) {
      const rpcport = this._defaultRPCPortForNetwork(network);

      if (baseSettings.username && baseSettings.password) {
        pushCandidate({
          source: 'settings.credentials',
          host: preferredHost,
          rpcport,
          network,
          username: baseSettings.username,
          password: baseSettings.password,
          secure: baseSettings.secure === true
        });
      }

      for (const datadir of datadirs) {
        const cookieAuth = this._readAuthCookie(datadir, network);
        if (!cookieAuth) continue;
        pushCandidate({
          source: `cookie:${network}`,
          host: preferredHost,
          rpcport,
          network,
          username: cookieAuth.username,
          password: cookieAuth.password,
          secure: false
        });
      }

      pushCandidate({
        source: `localhost:${network}`,
        host: preferredHost,
        rpcport,
        network,
        username: baseSettings.username,
        password: baseSettings.password,
        secure: baseSettings.secure === true
      });
    }

    return candidates;
  }

  /**
   * Convert bitcoin.conf configuration to Fabric Bitcoin service settings
   * @param {Object} bitcoinConf The parsed bitcoin.conf configuration
   * @returns {Object} Settings object compatible with Fabric Bitcoin service
   */
  _toFabricSettings (bitcoinConf) {
    if (!bitcoinConf.found) {
      return {};
    }

    const settings = {
      mode: 'rpc',
      network: bitcoinConf.network.active || 'mainnet',
      host: this._normalizeRPCHost(bitcoinConf.rpc.host || '127.0.0.1'),
      rpcport: Number(bitcoinConf.rpc.rpcport),
      secure: false
    };

    // Add authentication if available
    if (bitcoinConf.rpc.rpcuser && bitcoinConf.rpc.rpcpassword) {
      settings.username = bitcoinConf.rpc.rpcuser;
      settings.password = bitcoinConf.rpc.rpcpassword;
    }

    // Keep authority credential-free to avoid accidental secret disclosure.
    settings.authority = `http://${settings.host}:${settings.rpcport}`;

    return settings;
  }

  storeExists () {
    return fs.existsSync(this.settings.store);
  }

  walletExists () {
    return fs.existsSync(this.settings.path);
  }

  makeContractStore () {
    fs.mkdirSync(this.settings.store);
  }

  makeStore () {
    if (this.storeExists()) return true;

    try {
      fs.mkdirSync(this.settings.store);
    } catch (exception) {
      if (this.emit) this.emit('error', `Could not make store: ${exception.message || exception}`);
      return false;
    }

    return this;
  }

  touchWallet () {
    const time = new Date();
    this.makeStore();

    try {
      fs.utimesSync(this.settings.path, time, time);
    } catch {
      try {
        fs.closeSync(fs.openSync(this.settings.path, 'wx'));
      } catch (exception) {
        if (!exception || exception.code !== 'EEXIST') throw exception;
      }
    }

    return true;
  }

  loadBitcoinConfig () {
    this.bitcoinConfig = this._readBitcoinConf();

    if (this.bitcoinConfig.found) {
      this.emit('debug', '[FABRIC:ENV]', `Bitcoin configuration loaded from: ${this.bitcoinConfig.path}`);
      const settings = this.bitcoinSettings;
      this.emit('debug', '[FABRIC:ENV]', `Network: ${settings.network}, RPC: ${settings.host}:${settings.rpcport}`);
    } else {
      this.emit('debug', '[FABRIC:ENV]', 'No bitcoin.conf found, using default settings');
    }

    return this;
  }

  loadWallet (opts = {}) {
    if (this.seed) {
      this.wallet = new Wallet({
        key: {
          seed: this.seed,
          passphrase: this.passphrase
        }
      });
      this.walletLocked = false;
      this.walletPublic = this._publicRecordFromWallet(this.wallet);
    } else if (this.xprv) {
      this.wallet = new Wallet({
        key: {
          xprv: this.xprv
        }
      });
      this.walletLocked = false;
      this.walletPublic = this._publicRecordFromWallet(this.wallet);
    } else if (this.xpub) {
      this.wallet = new Wallet({
        key: {
          xpub: this.xpub
        }
      });
      this.walletLocked = false;
      this.walletPublic = this._publicRecordFromWallet(this.wallet);
    } else if (this.walletExists()) {
      try {
        const data = this.readWallet();
        const text = typeof data === 'string' ? data : String(data ?? '');

        if (text.trim() === '') {
          if (this.emit) {
            this.emit('warning', `[FABRIC:KEYGEN] Wallet file is empty (${this.settings.path}); remove it or regenerate with fabric setup`);
          }
          this.wallet = false;
          this.walletLocked = false;
          this.walletPublic = null;
          return this;
        }

        const pr = tryParsePersistedJson(text);
        if (!pr.ok) throw pr.error;
        const input = pr.value;

        if (isPasswordProtectedDocument(input)) {
          this.wallet = false;
          this.walletLocked = true;
          this.walletPublic = (input.object && typeof input.object === 'object')
            ? Object.assign({}, input.object)
            : {};
          if (input.lockTimeoutMinutes != null) {
            this.lockSession.setTimeoutMinutes(clampLockTimeoutMinutes(input.lockTimeoutMinutes));
          }
          const password = opts.password || this.readVariable('FABRIC_PASSWORD');
          if (password) {
            try {
              this.unlockWallet(password);
            } catch (exception) {
              if (this.emit) {
                this.emit('warning', `[FABRIC:KEYGEN] Wallet is locked (unlock failed): ${exception.message || exception}`);
              }
            }
          }
          return this;
        }

        if (!input.object || !input.object.xprv) {
          throw new Error(`Corrupt or out-of-date wallet: ${this.settings.path}`);
        }

        this.wallet = new Wallet({
          key: {
            seed: input.object.seed,
            xprv: input.object.xprv,
            xpub: input.object.xpub
          }
        });
        this.walletLocked = false;
        this.walletPublic = this._publicRecordFromWallet(this.wallet);
      } catch (exception) {
        // Recoverable user-data issue; do not emit "error" (EventEmitter kills the process with no listeners).
        if (this.emit) this.emit('warning', `[FABRIC:KEYGEN] Could not load wallet data: ${exception.message || exception}`);
        this.wallet = false;
        this.walletLocked = false;
      }
    } else {
      this.wallet = false;
      this.walletLocked = false;
      this.walletPublic = null;
    }

    return this;
  }

  destroyWallet () {
    try {
      fs.unlinkSync(this.WALLET_FILE);
      return true;
    } catch {
      if (this.emit) this.emit('warning', '[FABRIC:ENVIRONMENT] Wallet already destroyed or unavailable.');
      return false;
    }
  }

  readContracts () {
    const prefix = `${__dirname}/..`;
    return fs.readdirSync(`${prefix}/contracts`).filter((x) => {
      const parts = x.split('.');
      return (parts[parts.length - 1] === 'js');
    }).map((x) => {
      const contract = fs.readFileSync(`${prefix}/contracts/${x}`);
      const entity = new Entity(contract);
      return {
        '@id': entity.id,
        '@data': entity.data
      };
    });
  }

  /**
   * Read a variable from the environment.
   * @param {String} name Variable name to read.
   * @returns {String} Value of the variable (or an empty string).
   */
  readVariable (name) {
    return process.env[name] || '';
  }

  readWallet () {
    return fs.readFileSync(this.WALLET_FILE, {
      encoding: 'utf8'
    });
  }

  /**
   * Configure the Environment to use a Fabric {@link Wallet}.
   * New wallets default to a password-sealed JSON document (`seal` blob).
   * Pass `{ encrypt: false }` only for tests / explicit plaintext.
   * @param {Wallet} wallet Wallet to attach.
   * @param {Boolean} force Force existing wallets to be destroyed.
   * @param {Object} [opts]
   * @param {string} [opts.password] Encryption password (required unless `encrypt` is false).
   * @param {boolean} [opts.encrypt=true]
   * @returns {Environment} The Fabric Environment.
   */
  setWallet (wallet, force = false, opts = {}) {
    if (opts && typeof opts === 'object' && opts.force) force = true;
    const encrypt = opts.encrypt !== false;
    const password = opts.password != null ? String(opts.password) : '';

    if (this.walletExists() && !force) throw new Error('Wallet file already exists.');

    const previousWallet = this.wallet;
    const previousPublic = this.walletPublic;
    const previousLocked = this.walletLocked;
    const preexisting = this.walletExists();

    // Attach before saving
    this.wallet = wallet;

    if (!this.touchWallet()) {
      this.wallet = previousWallet;
      throw new Error('Could not touch wallet.  Check permissions, disk space.');
    }

    try {
      const exported = wallet.export();
      const publicRecord = this._publicRecordFromWallet(wallet);

      if (encrypt) {
        const seal = sealJson(exported.object, password);
        this._writeWalletDocument({
          type: 'FabricWallet',
          format: SEAL_SCHEME,
          version: 2,
          walletVersion: exported.version,
          passwordProtected: true,
          lockTimeoutMinutes: this.lockSession.timeoutMinutes,
          object: publicRecord,
          seal: seal
        });
        this.walletPublic = publicRecord;
        this.walletLocked = false;
        this._installWalletLockHandler();
        this.lockSession.unlock({ unlocked: true });
      } else {
        const document = Object.assign({
          type: 'FabricWallet',
          format: 'plaintext',
          version: exported.version,
          passwordProtected: false
        }, exported);
        this._writeWalletDocument(document);
        this.walletPublic = publicRecord;
        this.walletLocked = false;
      }
    } catch (exception) {
      this.wallet = previousWallet;
      this.walletPublic = previousPublic;
      this.walletLocked = previousLocked;
      if (!preexisting) {
        try { fs.unlinkSync(this.WALLET_FILE); } catch (_) { /* best-effort */ }
      }
      if (this.emit) this.emit('warning', `[FABRIC:ENV] Could not write wallet file: ${exception.message || exception}`);
      throw exception;
    }

    return this;
  }

  readSeedFile () {
    const path = `${process.cwd()}/${this.SEED_FILE}`;
    if (fs.existsSync(path)) return fs.readFileSync(path, { encoding: 'utf8' });
    return false;
  }

  /**
   * Start the Environment.
   * @returns {Environment} The Fabric Environment.
   */
  start () {
    this._state.status = 'STARTING';
    this.local = this.readSeedFile();

    // Load Bitcoin configuration from bitcoin.conf
    this.loadBitcoinConfig();

    this.loadWallet();

    if (this.wallet) this.wallet.start();

    this._state.status = 'STARTED';
    return this;
  }

  stop () {
    this._state.status = 'STOPPING';
    // lockWallet() wipes seed/xprv/plaintext keys even when the idle-lock
    // handler was never installed (loadWallet does not bind it on those paths).
    this.lockWallet();
    this._state.status = 'STOPPED';
    return this;
  }

  verify () {
    const state = new Actor(this.state);
    if (state.id !== '3c141a17b967d9d50770ebcc3beac9f3bd695f728e8f4fb8988d913794998078') throw new Error(`Incorrect state: ${state.id}`);

    if (![
      'INITIALIZED',
      'STARTED',
      'STARTING',
      'STOPPED',
      'STOPPING'
    ].includes(this.status)) throw new Error(`Invalid status: ${this.status}`);

    return true;
  }
}

module.exports = Environment;
