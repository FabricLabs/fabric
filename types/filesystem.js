'use strict';

// Dependencies
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Tree = require('./tree');

// 
class Filesystem extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      encoding: 'utf8',
      path: './'
    }, this.settings, settings);

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
    if (!fs.existsSync(path)) mkdirp(path);
    return true;
  }

  readFile (name) {
    const file = path.join(this.path, name);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  writeFile (name, content) {
    const file = path.join(this.path, name);
    return fs.writeFileSync(file, content);
  }

  async ingest (document) {
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
      id: actor.id
    };
  }

  async start () {
    this.touchDir(this.path); // ensure exists

    await this.sync();

    return this;
  }

  async sync () {
    const files = fs.readdirSync(this.path);
    this._state.content = { files };
  }
}

module.exports = Filesystem;
