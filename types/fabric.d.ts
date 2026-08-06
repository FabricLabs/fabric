/**
 * TypeScript surface for `@fabric/core`.
 * Runtime is CommonJS; leaf modules under `types/*.js` / `functions/*.js` are authoritative.
 * Prefer the frozen import map in PUBLIC_API.md over this facade.
 */
declare class Fabric {
  constructor (settings?: Record<string, unknown>);
  [key: string]: unknown;
}

export = Fabric;
