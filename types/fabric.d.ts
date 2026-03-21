/**
 * Minimal TypeScript surface for `@fabric/core`.
 * Runtime is CommonJS (`types/fabric.js`); leaf modules under `types/*.js` are authoritative.
 * Expand declarations incrementally as coverage grows (see REMAINING_WORK.md).
 */
declare class Fabric {
  constructor (settings?: Record<string, unknown>);
  [key: string]: unknown;
}

export = Fabric;
