declare class Peer {
  constructor (settings?: Record<string, unknown>);
  start (): Promise<this> | this;
  stop ?: () => Promise<this> | this;
  on (event: string, listener: (...args: unknown[]) => void): this;
  /**
   * Source-route via nested P2P_FORWARD. path[0] = immediate TCP peer pubkey;
   * path[last] = final deliverer. Returns false if wrap fails or first hop missing.
   */
  sendOnion (path: Array<Buffer | string>, payload: unknown): boolean;
  [key: string]: unknown;
}

declare namespace Peer {
  class Swarm {
    constructor (settings?: Record<string, unknown>);
    [key: string]: unknown;
  }
}

export = Peer;
