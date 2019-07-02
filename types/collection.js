'use strict';

const Stack = require('./stack');
const State = require('./state');

/**
 * The {@link Collection} type maintains an ordered list of {@link State} items.
 * @property {Object} @entity Fabric-bound entity object.
 */
class Collection extends Stack {
  constructor (configuration = []) {
    super(configuration);

    this.settings = Object.assign({
      key: 'id'
    });

    this['@entity']['@type'] = 'Collection';

    return this;
  }

  _setKey (name) {
    this.settings.key = name;
  }

  /**
   * Adds an {@link Entity} to the {@link Collection}.
   * @param  {Mixed} data {@link Entity} to add.
   * @return {Number}      Length of the collection.
   */
  push (data) {
    super.push(data);

    let state = new State(data);

    this['@entity'].states[this.id] = this['@data'];
    this['@entity'].states[state.id] = state['@data'];

    this['@entity']['@data'] = this['@data'].map(x => x.toString());
    this['@data'] = this['@entity']['@data'];

    this['@id'] = this.id;

    try {
      this['@commit'] = this.commit();
    } catch (E) {
      console.error('Could not commit.', E);
    }

    return this['@data'].length;
  }

  async populate () {
    return Promise.all(this['@entity']['@data'].map(id => {
      return this['@entity'].states[id.toString('hex')];
    }));
  }
}

module.exports = Collection;
