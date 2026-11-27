'use strict';

/**
 * Re-export of {@link Contract.Journal.accumulate}.
 * @deprecated Require `@fabric/core/types/contract` and use `Contract.Journal`.
 * @module functions/contractMessageAccumulate
 */

module.exports = require('../types/contract').Journal.accumulate;
