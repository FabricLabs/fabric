/**
 * TypeScript surface for `@fabric/core`.
 * Runtime is CommonJS; leaf modules under `types/*.js` / `functions/*.js` are authoritative.
 * Prefer the frozen import map in PUBLIC_API.md over this facade.
 */
import StoreClass = require('./store');
import ResourceClass = require('./resource');

declare class Fabric {
  constructor (settings?: Record<string, unknown>);
  static Store: typeof StoreClass;
  static Resource: typeof ResourceClass;
  [key: string]: unknown;
}

export = Fabric;
