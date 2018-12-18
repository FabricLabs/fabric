'use strict';

const State = require('./state');

/**
 * Live instance of an ARC in Fabric.
 */
class Entity extends State {
  constructor (entity) {
    super(entity);

    if (!entity) return new Entity({ seed: Math.random() });

    Object.assign(this['@data'], entity['@data']);

    return this;
  }
}

module.exports = Entity;
