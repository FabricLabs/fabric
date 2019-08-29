'use strict';

const Circuit = require('./circuit');
const Script = require('./script');

class Program extends Circuit {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      instructions: []
    }, settings);

    this.circuit = new Circuit();
    this.script = new Script();

    this.state = {};

    return this;
  }

  step () {
    console.log('[FABRIC:PROGRAM]', 'Executing step...');
  }

  async start () {
    console.log('[FABRIC:PROGRAM]', 'Starting execution...');
  }
}

module.exports = Program;
