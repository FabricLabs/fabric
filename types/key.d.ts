declare class Key {
  constructor (settings?: Record<string, unknown>);
  [key: string]: unknown;
}

export = Key;
