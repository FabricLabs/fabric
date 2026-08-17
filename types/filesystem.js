'use strict';

const { tryParsePersistedJson } = require('../functions/wireJson');

// Dependencies
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
//const chokidar = require('chokidar');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Key = require('./key');
const Message = require('./message');
const Tree = require('./tree');

/**
 * Interact with a local filesystem.
 */
class Filesystem extends Actor {
  /**
   * Synchronize an {@link Actor} with a local filesystem.
   * @param {Object} [settings] Configuration for the Fabric filesystem.
   * @param {Object} [settings.path] Path of the local filesystem.
   * @param {Object} [settings.key] Signing key for the filesystem.
   * @returns {Filesystem} Instance of the Fabric filesystem.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      encoding: 'utf8',
      path: './',
      key: null
    }, this.settings, settings);

    // Ensure path is absolute
    this.settings.path = path.resolve(this.settings.path);

    // Initialize signing key
    this.key = this.settings.key ? new Key(this.settings.key) : new Key();
    this.pubkey = this.key.pubkey;

    this.tree = new Tree({
      leaves: []
    });

    this._state = {
      actors: {},
      content: {
        files: [],
        parent: null,
        status: 'INITIALIZED'
      },
      documents: {}
    };

    return this;
  }

  get path () {
    return this.settings.path;
  }

  get hashes () {
    const self = this;
    return self.files.map(f => {
      const content = self.readFile(f);
      if (!content) return null;
      return Hash256.digest(content);
    }).filter(hash => hash !== null);
  }

  get files () {
    return this.ls().filter(file => file !== '.fabric');
  }

  get leaves () {
    const self = this;
    return self.files.map(f => {
      const content = self.readFile(f);
      if (!content) return null;
      const hash = Hash256.digest(content);
      const key = [f, hash].join(':');
      return Hash256.digest(key);
    }).filter(leaf => leaf !== null);
  }

  get documents () {
    return this._state.documents;
  }

  /**
   * Resolve `name` under this store root. `null` when it would escape.
   * Does not follow a final symlink (`O_NOFOLLOW` remains deferred).
   * @param {string} name
   * @returns {string|null}
   * @private
   */
  _resolveContained (name) {
    const base = this.path;
    const file = path.resolve(base, String(name || ''));
    const prefix = base.endsWith(path.sep) ? base : base + path.sep;
    if (file === base || file.startsWith(prefix)) return file;
    return null;
  }

  delete (name) {
    const file = this._resolveContained(name);
    if (!file) return false;
    if (fs.existsSync(file)) fs.rmSync(file);
    return true;
  }

  /**
   * Get the list of files.
   * @returns {Array} List of files.
   */
  ls () {
    return this._state.content.files;
  }

  touch (path) {
    if (!fs.existsSync(path)) {
      const time = new Date();

      try {
        fs.utimesSync(path, time, time);
      } catch {
        fs.closeSync(fs.openSync(path, 'w'));
      }
    }

    return true;
  }

  touchDir (path) {
    if (!fs.existsSync(path)) mkdirp.sync(path);
    return true;
  }

  /**
   * Read a file by name.
   * @param {String} name Name of the file to read.
   * @returns {Buffer} Contents of the file.
   */
  readFile (name) {
    const file = this._resolveContained(name);
    if (!file || !fs.existsSync(file)) return null;

    // Skip directories
    if (fs.statSync(file).isDirectory()) return null;

    return fs.readFileSync(file);
  }

  /**
   * Write a file by name.
   * @param {String} name Name of the file to write.
   * @param {Buffer} content Content of the file.
   * @returns {Boolean} `true` if the write succeeded, `false` if it did not.
   */
  writeFile (name, content) {
    const file = this._resolveContained(name);
    if (!file) {
      const msg = `Could not write file ${name}: path escapes filesystem root`;
      if (this.listenerCount('error') > 0) this.emit('error', msg);
      else this.emit('warning', msg);
      return false;
    }

    try {
      // Ensure parent directory exists
      const parentDir = path.dirname(file);
      if (!fs.existsSync(parentDir)) {
        mkdirp.sync(parentDir);
      }

      this.touch(file);
      fs.writeFileSync(file, content);

      // Emit file update event
      this._handleDiskChange('change', name);

      return true;
    } catch (exception) {
      const msg = `Could not write file ${name}: ${exception}`;
      if (this.listenerCount('error') > 0) this.emit('error', msg);
      else this.emit('warning', msg);
      return false;
    }
  }

  _handleDiskChange (type, filename) {
    this.emit('file:update', {
      name: filename,
      type: type
    });

    // TODO: only sync changed files
    // this._loadFromDisk();

    return this;
  }

  /**
   * Load Filesystem state from disk.
   * @returns {Promise} Resolves with Filesystem instance.
   */
  _loadFromDisk () {
    return new Promise((resolve, reject) => {
      try {
        // Check for STATE file in .fabric directory
        const statePath = path.join(this.path, '.fabric', 'STATE');
        if (fs.existsSync(statePath)) {
          const stateHex = fs.readFileSync(statePath, 'utf8').trim();
          if (stateHex.length > 0) {
            try {
              const stateBuffer = Buffer.from(stateHex, 'hex');
              const stateStr = stateBuffer.toString('utf8');
              if (stateStr.length > 0) {
                const pr = tryParsePersistedJson(stateStr);
                if (pr.ok) this._state.content = pr.value;
                else throw pr.error;
              }
            } catch (parseErr) {
              // STATE file is empty, truncated, or corrupted; use default state
              if (this.settings.debug) {
                console.debug('[FILESYSTEM]', 'STATE file invalid, using default:', parseErr.message);
              }
            }
          }
        }

        const files = fs.readdirSync(this.path);
        this._state.content.files = files.filter(file => file !== '.fabric');
        this.commit();

        resolve(this);
      } catch (exception) {
        this.emit('error', exception);
        reject(exception);
      }
    });
  }

  async ingest (document, _name = null) {
    if (typeof document !== 'string') {
      document = JSON.stringify(document);
    }

    const actor = new Actor(document);

    return {
      id: actor.id
    };
  }

  /**
   * Remember a published path in the top-level file list without re-reading the tree.
   * Nested paths only add the first segment (same as `readdir` of `this.path`).
   * @param {string} name
   * @returns {void}
   */
  _notePublishedName (name) {
    const top = String(name || '').split(/[/\\]/).filter(Boolean)[0];
    if (!top || top === '.fabric') return;
    if (!Array.isArray(this._state.content.files)) this._state.content.files = [];
    const files = this._state.content.files;
    if (!files.includes(top)) {
      files.push(top);
      files.sort();
    }
  }

  async publish (name, document) {
    const content = typeof document === 'string' ? document : JSON.stringify(document, null, '  ');
    const actor = new Actor(document);
    const hash = Hash256.digest(content);

    if (!this.writeFile(name, content)) {
      throw new Error(`Could not publish ${name}`);
    }
    this._notePublishedName(name);

    return {
      id: actor.id,
      document: hash
    };
  }

  async start () {
    if (this.settings.debug) console.debug('[FILESYSTEM]', 'Starting filesystem:', this.path);
    this._state.content.status = 'STARTING';

    // Create .fabric directory
    const fabricPath = path.join(this.path, '.fabric');
    this.touchDir(fabricPath);

    this.touchDir(this.path); // ensure exists

    // Load from disk
    await this._loadFromDisk();

    // Watch for changes in the filesystem
    /* chokidar.watch(this.path, {
      ignoreInitial: true,
      persistent: false,
      ignored: /(^|[/\\])\.fabric([/\\]|$)/ // ignore .fabric directory
    }).on('all', (event, filePath) => {
      this._handleDiskChange(event, filePath);
    }); */

    this._state.content.status = 'STARTED';
    this.commit();

    return this;
  }

  async stop () {
    this.commit();
    return this;
  }

  /**
   * Synchronize state from the local filesystem.
   * @returns {Filesystem} Instance of the Fabric filesystem.
   */
  async synchronize () {
    await this._loadFromDisk();
    this.commit();
    return this;
  }

  async addToChain (message) {
    if (!message) throw new Error('Message is required');

    // Convert message to buffer
    const buffer = message.toBuffer();

    // Convert buffer to hex
    const hex = buffer.toString('hex');

    // Write hex to CHAIN in .fabric directory
    const chainPath = path.join(this.path, '.fabric', 'CHAIN');
    const result = await this.writeFile(chainPath, hex);

    if (!result) {
      this.emit('error', 'Failed to write message to chain');
      return false;
    }

    this.emit('chain:update', {
      message: message,
      hex: hex
    });

    return true;
  }

  commit () {
    const content = this._state.content || {};
    const serialized = JSON.stringify(content);

    // Write state to STATE file using absolute path
    const statePath = path.resolve(this.path, '.fabric', 'STATE');
    const stateHex = Buffer.from(serialized).toString('hex');
    this.writeFile(statePath, stateHex);
    this.writeFile(statePath + '.json', serialized);

    const commit = Message.fromVector(['COMMIT', serialized]);
    commit.signatures = commit.signatures || [];

    // Only sign if we have a key with private key component
    if (this.key && this.key.xprv) {
      // Sign the commit message using the configured key
      const signature = this.key.sign(commit);
      commit.signatures.push(signature);
    }

    this.emit('commit', commit);
  }

  /**
   * Synchronize the filesystem with the local state.
   * @returns {Promise} Resolves with Filesystem instance.
   */
  sync () {
    return new Promise((resolve, reject) => {
      try {
        this.synchronize().then(() => {
          resolve(this);
        });
      } catch (exception) {
        this.emit('error', exception);
        reject(exception);
      }
    });
  }
}

module.exports = Filesystem;
