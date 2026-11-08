declare class Store {
  constructor (settings?: Record<string, unknown>);
  start (): Promise<this>;
  stop (): Promise<this>;
  /** Resolves `null` when nothing is stored at `key`. */
  get (key: string): Promise<unknown>;
  set (key: string, value: unknown): Promise<unknown>;
  /**
   * Remove `key` and everything beneath it, from Level and from memory. A
   * missing key is not an error; a reserved key or a non-index key under an
   * array rejects.
   */
  remove (key: string): Promise<null>;
  [key: string]: unknown;
}

export = Store;
