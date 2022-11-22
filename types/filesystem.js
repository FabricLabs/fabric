'use strict';

// Dependencies
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Tree = require('./tree');

/**
 * Interact with a local filesystem.
 */
class Filesystem extends Actor {
  /**
   * Synchronize an {@link Actor} with a local filesystem.
   * @param {Object} [settings] Configuration for the Fabric filesystem.
   * @param {Object} [settings.path] Path of the local filesystem.
   * @returns {Filesystem} Instance of the Fabric filesystem.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      encoding: 'utf8',
      path: './'
    }, this.settings, settings);

    this.tree = new Tree({
      leaves: []
    });

    this._state = {
      actors: {},
      content: {
        files: []
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
      return Hash256.digest(self.readFile(f));
    });
  }

  get files () {
    return this.ls();
  }

  get leaves () {
    const self = this;
    return self.files.map(f => {
      const hash = Hash256.digest(self.readFile(f));
      const key = [f, hash].join(':');
      return Hash256.digest(key);
    });
  }

  get documents () {
    return this._state.documents;
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
      } catch (err) {
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
    const file = path.join(this.path, name);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  /**
   * Write a file by name.
   * @param {String} name Name of the file to write.
   * @param {Buffer} content Content of the file.
   * @returns {Boolean} `true` if the write succeeded, `false` if it did not.
   */
  writeFile (name, content) {
    const file = path.join(this.path, name);

    try {
      fs.writeFileSync(file, content);
      return true;
    } catch (exception) {
      this.emit('error', `Could not write file: ${content}`);
      return false;
    }
  }

  /**
   * Load Filesystem state from disk.
   * @returns {Promise} Resolves with Filesystem instance.
   */
  _loadFromDisk () {
    const self = this;
    return new Promise((resolve, reject) => {
      try {
        const files = fs.readdirSync(self.path);
        self._state.content = { files };
        self.commit();

        resolve(self);
      } catch (exception) {
        self.emit('error', exception);
        reject(exception);
      }
    });
  }

  async ingest (document, name = null) {
    if (typeof document !== 'string') {
      document = JSON.stringify(document);
    }

    const actor = new Actor(document);
    const hash = Hash256.digest(document);

    this._state.documents[hash] = document;

    return {
      id: actor.id
    };
  }

  async publish (name, document) {
    if (typeof document !== 'string') {
      document = JSON.stringify(document, null, '  ');
    }

    const actor = new Actor(document);
    const hash = Hash256.digest(document);

    this._state.actors[actor.id] = actor;
    this._state.documents[hash] = document;

    this.writeFile(name, document);

    await this.sync();

    return {
      id: actor.id,
      document: hash
    };
  }

  async start () {
    this.touchDir(this.path); // ensure exists
    await this.sync();
    return this;
  }

  async stop () {
    this.commit();
    return this;
  }

  /**
   * Syncronize state from the local filesystem.
   * @returns {Filesystem} Instance of the Fabric filesystem.
   */
  async sync () {
    await this._loadFromDisk();
    this.commit();
    return this;
  }
}

module.exports = Filesystem;
