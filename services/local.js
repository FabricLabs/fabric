'use strict';

const Service = require('../lib/service');

class Local extends Service {
  handler (message) {
    this.emit('message', {
      actor: message.user,
      target: message.channel,
      object: message.text
    });
  }
}

module.exports = Local;
