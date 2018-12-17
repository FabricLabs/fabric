'use strict';

const Stack = require('./stack');
const State = require('./state');

class Collection extends Stack {
  constructor (configuration) {
    super(configuration);

    this['@entity'].states = {};
    this['@states'] = {};

    return this;
  }

  push (data) {
    super.push(data);

    let state = new State(data);

    console.log('collection pushing:', data, this['@states'], this);

    this['@states'][this.id] = this['@data'];
    this['@states'][state.id] = state['@data'];

    try {
      this['@commit'] = this.commit();
    } catch (E) {
      console.error('Could not commit.', E);
    }

    this['@id'] = this.id;

    return this['@data'].length;
  }

  async populate () {
    return Promise.all(this['@data'].map(id => {
      return this['@states'][id.toString('hex')];
    }));
  }
}

module.exports = Collection;
