'use strict';

const { TtfmApi } = require('ttfm');
const Entity = require('../types/entity');
const Service = require('../types/service');

class Turntable extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      login: null,
      password: null,
      rooms: ['604065be3f4bfc001be4c5eb'],
      autobop: false
    }, this.settings, settings, settings.turntable);

    // Internal Properties
    this.agent = null;
    this.rooms = {};
    this.timers = {};

    return this;
  }

  async start () {
    // TODO: await REST or GraphQL API?
    // if (!this.settings.login || !this.settings.password) return false;

    // Connect to TTFM
    this.agent = await TtfmApi.connect({
      email: this.settings.login,
      password: this.settings.password,
    });

    this.agent.onUserJoin(this._handleUserJoin.bind(this));
    this.agent.onUserLeave(this._handleUserLeave.bind(this));
    this.agent.onAddDj(this._handleNewDJ.bind(this));
    this.agent.onSpeak(this._handleChatMessage.bind(this));
    this.agent.onNewSong(this._handleNewSong.bind(this));

    for (let i = 0; i < this.settings.rooms.length; i++) {
      this.rooms[this.settings.rooms[i]] = await this.agent.joinRoom(this.settings.rooms[i]);
    }

    this.emit('ready', {
      id: 'foobar'
    });
  }

  async _send (message) {
    for (let i = 0; i < Object.keys(this.rooms).length; i++) {
      const id = Object.keys(this.rooms)[i];
      const msg = await this.rooms[id].say(message.object.content);
    }
  }

  async _upvoteCurrentTrack () {
    return this.rooms[this.settings.rooms[0]].upvote();
  }

  async _defer (method, params = [], delay = 30000) {
    if (this.timers['autobop']) clearTimeout(this.timers['autobop']);
    const self = this;
    const timer = setTimeout(() => {
      method.call(self, params);
    }, delay);

    return this.timers['autobop'] = timer;
  }

  async _handleUserJoin (data) {
    this.emit('message', `${data.user[0].name} has joined the room!`);
  }

  async _handleUserLeave (data) {
    this.emit('message', `${data.user[0].name} has left the room.`);
  }

  async _handleNewDJ (data) {
    this.emit('message', `New DJ on deck: ${data.name}`);
  }

  async _handleNewSong (data) {
    if (this.settings.autobop) this._defer(this._upvoteCurrentTrack, [], 60000 * Math.random());
    const entity = new Entity(data);
    this.emit('message', {
      actor: null,
      object: entity,
      target: '/plays'
    });
  }

  async _handleChatMessage (data) {
    this.emit('message', `${data.name}: ${data.text}`);
  }
}

module.exports = Turntable;
