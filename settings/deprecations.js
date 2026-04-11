'use strict';

const FabricState = require('../types/state');

/**
 * Deprecated 2021-11-06 — use {@link FabricState} (<code>types/state</code>). <code>Scribe</code> was merged into <code>State</code>.
 * @deprecated
 */
class Scribe extends FabricState {}

module.exports = {
  Scribe
};
