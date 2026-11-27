declare module '@fabric/core/functions/fabricOnion' {
  import type { Buffer } from 'buffer';

  export const P2P_FORWARD: number;
  export const P2P_FORWARD_MAX_HOPS: number;
  export const SCHEMA_P2P_FORWARD: ReadonlyArray<{ name: string; type: string }>;

  export function toXOnlyPeerId(value: Buffer | string | Uint8Array | null | undefined): Buffer;
  export function xOnlyFromKey(keyLike: object): Buffer;
  export function xOnlyEquals(a: Buffer, b: Buffer): boolean;
  export function toInnerBuffer(messageOrBuffer: object | Buffer | Uint8Array): Buffer;
  export function wrapForwardLayer(opts: {
    nextPeer: Buffer | string;
    inner: object | Buffer;
    key: object;
    ttl?: number;
  }): object;
  export function wrapOnionPath(opts: {
    path: Array<Buffer | string>;
    payload: object | Buffer;
    key: object;
    maxHops?: number;
  }): object;
  export function tryDecodeForward(message: object): {
    nextPeer: Buffer;
    ttl: number;
    inner: Buffer;
  } | null;
}
