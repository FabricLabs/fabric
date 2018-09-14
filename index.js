/**
 * # Fabric: an experimental p2p framework
 * Providing an interface to Fabric network, this file defines the available
 * components and abstractions when relying on this library.
 */
'use strict';

const Fabric = require('./fabric');

/**
 * Default interface to {@link Fabric}.  Exposes immutable types for all
 * requisite {@link Component} elements of the `components` option.
 * @property {Configuration} config Initial {@link Vector}.
 * @property {Map} config.components Transformation function of `© ⇒ Δ`.
 */
export default class App extends Fabric {
  /**
   * Create a new instance of the Fabric App.
   * @param  {Object} config Configuration object.
   * @param  {Object} config.store Path to local storage.
   * @return {App}
   */
  constructor (config) {
    super(config);
    this.config = Object.assign({
      store: './data/api'
    }, config);
    return this;
  }

  render () {
    return (
      Fabric
    );
  }
}

module.exports = App;
