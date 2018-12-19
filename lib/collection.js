'use strict';

const Stack = require('./stack');
const State = require('./state');

/**
 * The {@link Collection} type maintains an ordered list of {@link State} items.
 * @property {Object} @entity Fabric-bound entity object.
 */
class Collection extends Stack {
  constructor (configuration) {
    super(configuration);

    this['@entity']['@type'] = 'Collection';
    this['@entity'].states = {};

    if (configuration) {
      super.push(configuration);
    }

    return this;
  }

  push (data) {
    super.push(data);

    let state = new State(data);

    if (!this['@entity'].states) this['@entity'].states = {};

    this['@entity'].states[this.id] = this['@data'];
    this['@entity'].states[state.id] = state['@data'];

    try {
      this['@commit'] = this.commit();
    } catch (E) {
      console.error('Could not commit.', E);
    }

    this['@entity']['@data'] = this['@data'].map(x => x.toString());
    this['@data'] = this['@entity']['@data'];
    this['@id'] = this.id;

    this.commit();

    return this['@data'].length;
  }

  async populate () {
    return Promise.all(this['@entity']['@data'].map(id => {
      return this['@entity'].states[id.toString('hex')];
    }));
  }
}

module.exports = Collection;
