'use strict';

const Scribe = require('./scribe');

// TODO: re-define this class for Fabric messages
// Current code is specific to @fabric/doorman — should be a general-
// purpose Router, not for strings and triggers in chat messages.

/**
 * Process incoming messages.
 * @extends Scribe
 */
class Router extends Scribe {
  /**
   * Maintains a list of triggers ("commands") and their behaviors.
   * @param       {Object} map Map of command names => behaviors.
   */
  constructor (config) {
    super(config);

    this.settings = Object.assign({
      routes: {},
      handlers: {},
      trigger: '!'
    }, config);

    this.handlers = {};
    this.status = 'ready';

    return this;
  }

  /**
   * Assembles a list of possible responses to the incoming request.
   * @param  {String} msg Input message to route.
   * @return {Array}     List of outputs generated from the input string.
   */
  async route (msg) {
    if (!msg.actor || !msg.object || !msg.target) return null;
    if (typeof msg.object !== 'string') return null;

    let output = [];
    let parts = msg.object
      .split(/\s+/g)
      .filter(x => x.charAt(0) === this.settings.trigger)
      .map(x => x.substr(1));

    for (let i in parts) {
      let token = parts[i];
      let command = token.toLowerCase();
      let handler = this.handlers[command];
      let result = null;

      if (handler) {
        switch (typeof handler.value) {
          case 'string':
            result = handler.value;
            break;
          default:
            this.log('no such native trigger, calling...', command);
            // TODO: remove this.fabric.plugins call
            result = await handler.value.apply(this.fabric.plugins[handler.plugin], [msg]);
            break;
        }

        if (result) {
          output.push(result);
        }
      }
    }

    return output;
  }

  /**
   * Attaches a new handler to the router.
   * @param  {Plugin} plugin Instance of the plugin.
   * @param  {Plugin.name} name Name of the plugin.
   * @return {Router}        Configured instance of the router.
   */
  use (plugin) {
    if (!plugin.name) throw new Error('Cannot use plugin: no "name" attribute specified.');
    this.handlers[plugin.name] = plugin;
    return this;
  }
}

module.exports = Router;
