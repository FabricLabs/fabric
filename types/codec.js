'use strict';

// Dependencies
const merge = require('lodash.merge');

// Fabric Types
const Label = require('./label');
const Key = require('./key');
const Actor = require('./actor');

class Codec {
  constructor (settings = {}) {
    this.settings = merge({
      type: 'FabricCodec',
      version: 0,
      key: {
        seed: null,
        private: null,
        public: null
      },
      buffer: true
    }, this.settings, settings);

    this.key = new Key(this.settings.key);
    this._state = {
      actors: {},
      labels: {}
    };

    return this;
  }

  get type () {
    return this.settings.type;
  }

  get buffer () {
    return this.settings.buffer;
  }

  _registerActor (actor) {
    this._state.actors[actor.id] = actor;
    return this._state.actors[actor.id];
  }

  _registerLabel (label) {
    this._state.labels[label._id] = label;
    return this._state.labels[label._id];
  }

  encode (data) {
    if (typeof data !== 'string') data = JSON.stringify(data);
    try {
      const actor = new Actor(data);
      const label = new Label(`${this.key.pubkey}/${actor.id}`);
      const blob = this.key.encrypt(data);
      this._registerActor(actor);
      this._registerLabel(label);
      return blob;
    } catch (exception) {
      console.error('err:', exception);
    }
  }

  decode (blob) {
    try {
      const actor = new Actor(blob);
      const label = new Label(`${this.key.pubkey}/${actor.id}`);
      const data = this.key.decrypt(blob);
      this._registerActor(actor);
      this._registerLabel(label);
      return data;
    } catch (exception) {
      console.error('err:', exception);
    }
  }
}

module.exports = Codec;
