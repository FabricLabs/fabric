/**
 * Minimal TypeScript surface for `@fabric/core`.
 * Primary implementation and API remain in `types/fabric.js` (JSDoc).
 * Expand this file incrementally as types are formalized.
 */
declare class Fabric {
  constructor (settings?: Record<string, unknown>);
  [key: string]: unknown;
}

export = Fabric;
