'use strict';

/**
 * A disk {@link Store} that records events in arrival order.
 * {@link Store#acceptEvent} and {@link Store#replay} are the log.
 */

const Hash256 = require('./hash256');
const Filesystem = require('./filesystem');

class History extends Filesystem {
  /**
   * @param {Object} [settings]
   * @param {Object} [settings.fs]
   * @param {string} [settings.fs.path]
   */
  constructor (settings = {}) {
    const fsSettings = (settings && settings.fs) || {};
    super(Object.assign({}, settings, {
      path: fsSettings.path || settings.path || './stores/history'
    }));
  }

  async start () {
    this._state.status = 'STARTING';

    try {
      await super.start();
      await this._syncFiles();
      this._state.status = 'STARTED';
    } catch (exception) {
      this._state.status = 'ERROR';
      if (!Array.isArray(this._state.notices)) this._state.notices = [];
      this._state.notices.push(exception);
    }

    return this;
  }

  async _syncFiles () {
    this._state.files = this._state.files || {};
    const names = this.files || [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const content = this.readFile(name);
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
