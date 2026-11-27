'use strict';

/**
 * Load operator `settings/local.js` when present; otherwise the packaged
 * `settings/local.example.js` (env-backed defaults). Never throws for a missing
 * local overlay — npm installs do not ship gitignored `local.js`.
 *
 * @returns {object}
 */
function loadLocalSettings () {
  try {
    return require('../settings/local');
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  try {
    return require('../settings/local.example');
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  return {};
}

module.exports = { loadLocalSettings };
