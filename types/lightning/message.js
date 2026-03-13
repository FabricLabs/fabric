'use strict';

const FabricMessage = require('../message');

class LightningMessage extends FabricMessage {
  constructor (settings = {}) {
    super(settings);
  }
}

module.exports = LightningMessage;
