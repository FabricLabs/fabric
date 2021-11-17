/**
 * Parse input to a JSON string.
 * @param {Object} [input] Any input object.
 * @returns {String}
 */
module.exports = function (input) {
  return JSON.stringify(input, null, '  ');
};
