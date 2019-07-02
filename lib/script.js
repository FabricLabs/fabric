'use strict';

const Stack = require('./stack');

// addresses of known operators
const known = {
  'OP_0': '0x5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9',
  'OP_1': '0x6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b'
};

class Script extends Stack {
  /**
   * Compose a {@link Script} for inclusion within a {@link Contract}.
   * @param  {Mixed} config Configuration options for the script.
   * @return {Script}        Instance of the {@link Script}, ready for use.
   */
  constructor (config) {
    super(config);
    this.stack = new Stack();
    this['@data'] = this.stack['@data'];
    return this;
  }

  compile () {
    return this.stack.map(x => {
      return known[x] || x;
    });
  }

  render () {
    return this.stack.join(' ');
  }
}

module.exports = Script;
