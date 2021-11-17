/**
 * Parse input to an HTML string.
 * @param {Object} [input] Any input object.
 * @returns {String}
 */
module.exports = function html (input) {
  'use strict';
  // @author: Fabric Labs
  // @access private
  const Actor = require('@fabric/core/types/actor');
  try {
    const actor = new Actor(input);
    return actor.toHTML();
  } catch (exception) {
    return '<html>Error!</html>\n';
  }
};
