'use strict';

const Actor = require('../types/actor');
const Filesystem = require('../types/filesystem');
const Hash256 = require('../types/hash256');

class History extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      fs: {
        path: './stores/history'
      }
    }, this.settings, settings);

    this.fs = new Filesystem(this.settings.fs);
    this._state = {
      clock: 0,
      content: {},
      documents: {},
      files: {},
      history: [],
      notices: [],
      status: 'PAUSED'
    };

    return this;
  }

  get clock () {
    return this._state.clock;
  }

  set clock (value) {
    this._state.clock = value;
  }

  get path () {
    return this.fs.path;
  }

  commit () {
    const state = new Actor(this.state);
    const commit = new Actor({
      type: 'Commit',
      object: {
        content: JSON.stringify(state.toGenericMessage()),
        state: state.id
      }
    });

    return commit;
  }

  async acceptEvent (event) {
    const now = new Date();
    const message = {
      type: 'HistoryEvent',
      published: now.toISOString(),
      object: {
        content: event
      }
    };

    const actor = new Actor(message);

    this._state.documents[actor.id] = message;
    this._state.history.push(actor.id);

    const commit = this.commit();

    this.fs.publish(now.toISOString() + '.json', JSON.stringify(commit.toObject()));

    ++this.clock;

    return this;
  }

  async replay (log = []) {
    for (let i = 0; i < log.length; i++) {
      this.acceptEvent(log[i]);
    }
  }

  async start () {
    this._state.status = 'STARTING';

    try {
      await this.fs.start();
      await this._syncFiles();
      this._state.status = 'STARTED';
    } catch (exception) {
      this._state.status = 'ERROR';
      this._state.notices.push(exception);
    }

    return this;
  }

  async _syncFiles () {
    for (let i = 0; i < this.fs.files.length; i++) {
      const name = this.fs.files[i];
      const content = this.fs.readFile(name);

      this._state.files[name] = {
        name: name,
        content: content,
        hash: Hash256.digest(content)
      };
    }

    return this._state.files;
  }
}

module.exports = History;
