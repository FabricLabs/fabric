declare module '@fabric/core/functions/musig2' {
  import type { Buffer } from 'buffer';

  export class InvalidContributionError extends Error {
    signer: number | null;
    contrib: string;
  }
  export class ValueError extends Error {}

  export function musig2IsNOfN (threshold: number, n: number): boolean;
  export function individualPk (seckey: Buffer | string): Buffer;
  export function keySort (pubkeys: Array<Buffer | Uint8Array | string>): Buffer[];
  export function keyAgg (pubkeys: Array<Buffer | Uint8Array | string>): {
    Q: object;
    gacc: bigint;
    tacc: bigint;
  };
  export function getXonlyPk (keyaggCtx: { Q: object }): Buffer;
  export function applyTweak (
    keyaggCtx: { Q: object; gacc: bigint; tacc: bigint },
    tweak: Buffer | string,
    isXonly: boolean
  ): { Q: object; gacc: bigint; tacc: bigint };
  export function keyAggAndTweak (
    pubkeys: Array<Buffer | string>,
    tweaks: Array<Buffer | string>,
    isXonly: boolean[]
  ): { Q: object; gacc: bigint; tacc: bigint };
  export function nonceGen (
    sk: Buffer | null,
    pk: Buffer | string,
    aggpk: Buffer | string | null,
    msg: Buffer | string | null,
    extraIn: Buffer | string | null
  ): { secnonce: Buffer; pubnonce: Buffer };
  export function nonceGenInternal (
    rand_: Buffer | string,
    sk: Buffer | string | null,
    pk: Buffer | string,
    aggpk: Buffer | string | null,
    msg: Buffer | string | null,
    extraIn: Buffer | string | null
  ): { secnonce: Buffer; pubnonce: Buffer };
  export function nonceAgg (pubnonces: Array<Buffer | string>): Buffer;
  export function sessionContext (
    aggnonce: Buffer | string,
    pubkeys: Array<Buffer | string>,
    tweaks: Array<Buffer | string>,
    isXonly: boolean[],
    msg: Buffer | string
  ): object;
  export function getSessionValues (sessionCtx: object): object;
  export function sign (secnonce: Buffer, sk: Buffer | string, sessionCtx: object): Buffer;
  export function partialSigVerify (
    psig: Buffer | string,
    pubnonces: Array<Buffer | string>,
    pubkeys: Array<Buffer | string>,
    tweaks: Array<Buffer | string>,
    isXonly: boolean[],
    msg: Buffer | string,
    i: number
  ): boolean;
  export function partialSigAgg (psigs: Array<Buffer | string>, sessionCtx: object): Buffer;
  export function deterministicSign (
    sk: Buffer | string,
    aggothernonce: Buffer | string,
    pubkeys: Array<Buffer | string>,
    tweaks: Array<Buffer | string>,
    isXonly: boolean[],
    msg: Buffer | string,
    rand: Buffer | string | null
  ): { pubnonce: Buffer; psig: Buffer };
  export function aggregateXonly (
    pubkeys: Array<Buffer | string>,
    opts?: { sort?: boolean }
  ): Buffer;
  export function verifyAggregatedSchnorr (
    message: Buffer | string,
    signature: Buffer | string,
    pubkeys: Array<Buffer | string>,
    claimedAggregate?: Buffer | string
  ): boolean;
}
