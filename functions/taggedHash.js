'use strict';

/**
 * BIP-340 tagged hash. Implementation: {@link Hash256.tagged} (`types/hash256.js`).
 *
 * @module functions/taggedHash
 */

const Hash256 = require('../types/hash256');

module.exports = Hash256.tagged;
