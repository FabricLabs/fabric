/**
 * Create a new {@link Object} with sorted properties.
 * @param {Object} [state] Object to sort.
 * @returns {Object} Re-sorted instance of `state` as provided.
 */
module.exports = function _sortKeys (state = {}) {
  // Sort the keys of the state object, and return a new object with the sorted keys.
  return Object.keys(state).sort().reduce((obj, key) => {
    // Add the key to the new object.
    obj[key] = state[key];
    // Return the new object.
    return obj;
  }, {});
};
