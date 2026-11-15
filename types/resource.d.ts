import Store = require('./store');

declare class Resource extends Store {
  constructor (definition?: Record<string, unknown>);
  remove (key: string): Promise<null>;
  [key: string]: unknown;
}

export = Resource;
