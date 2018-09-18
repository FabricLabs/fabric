'use strict';

const Service = require('../lib/service');

class Local extends Service {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
  }

  handler (message) {
    this.log('[LOCAL:HANDLER]', 'handling message:', message);
    let data = Object.assign({
      actor: message.user,
      target: message.channel,
      object: message.text
    }, message);
    this.emit('message', data);
  }

  async start () {
    this.log('[LOCAL:START]', 'starting...');
    return super.start();
  }
}

module.exports = Local;
