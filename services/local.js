'use strict';

const Service = require('../types/service');

class Local extends Service {
  constructor (config) {
    super(config);
    this.config = Object.assign({
      path: './stores/local'
    }, config);
    return this;
  }

  handler (message) {
    this.log('[LOCAL:HANDLER]', 'handling message:', message);
    let data = Object.assign({
      actor: message.user,
      target: message.channel,
      object: message.text,
      origin: {
        type: 'Link',
        name: 'Internal'
      }
    }, message);
    this.emit('message', data);
  }

  async start () {
    this.log('[LOCAL:START]', 'starting...');
    return super.start();
  }
}

module.exports = Local;
