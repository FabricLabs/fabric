'use strict';

/**
 * Re-export of {@link Contract.Journal.commit}.
 * @deprecated Require `@fabric/core/types/contract` and use `Contract.Journal`.
 * @module functions/contractMessageCommit
 */

module.exports = require('../types/contract').Journal.commit;
