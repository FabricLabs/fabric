/**
 * Create a new {@link Object} with sorted properties.
 * @param {Object} [state] Object to sort.
 * @returns {Object} Re-sorted instance of `state` as provided.
 */
module.exports = function _sortKeys (state = {}) {
  return Object.keys(state).sort().reduce((obj, key) => {
    obj[key] = state[key];
    return obj;
  }, {});
};
