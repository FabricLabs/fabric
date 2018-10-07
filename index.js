/**
 * # Fabric: an experimental p2p framework
 * Providing an interface to Fabric network, this file defines the available
 * components and abstractions used when relying on this library.
 */
'use strict';

const Fabric = require('./fabric');

/**
 * Default interface to {@link Fabric}.  Provides immutable types for all
 * elements of the `components` option.
 * @property {Configuration} config Initial {@link Vector}.
 * @property {Map} config.components Transformation function of `Σ ⇒ Δ`.
 */
class App extends Fabric {
  /**
   * Create a new instance of the Fabric App.
   * @param  {Object} [config] Configuration object.
   * @param  {Object} [config.store] Path to local storage.
   * @param  {Object} [config.components] Map of components.
   * @param  {Object} [config.components.list] Name of "list" component.
   * @param  {Object} [config.components.view] Name of "view" component.
   * @return {App}
   */
  constructor (config) {
    super(config);

    // Store the configuration
    this.config = Object.assign({
      store: `./data/${this.constructor.name.toLowerCase()}`
    }, config);

    return this;
  }

  /**
   * Draw the application to canvas (display).
   * @return {Mixed}
   */
  render () {
    return `<Fabric />`;
  }
}

module.exports = App;
