'use strict';

/**
 * Re-export of {@link Contract.Journal.queue}.
 * @deprecated Require `@fabric/core/types/contract` and use `Contract.Journal`.
 * @module functions/contractMessageQueue
 */

module.exports = require('../types/contract').Journal.queue;
