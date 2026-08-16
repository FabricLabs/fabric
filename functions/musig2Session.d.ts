declare module '@fabric/core/functions/musig2Session' {
  import type { Buffer } from 'buffer';

  export const MUSIG_MAX_SIGNERS: number;
  export const MUSIG_MAX_MSG_BYTES: number;
  export const MUSIG_PUBNONCE_BYTES: number;

  export function packPubkeys (pubkeys: Array<Buffer | string>): Buffer;
  export function unpackPubkeys (packed: Buffer | string): Buffer[];
  export function challengeMessage (msg: Buffer | string): Buffer;
  export function xOnlyHex (pk: Buffer | string): string;
  export function signerIndex (pubkeys: Buffer[], signerXOnly: string): number;
  export function parseMusigBody (body: object): object | null;
  export function createLocalSession (opts: {
    sessionId?: Buffer | string;
    msg: Buffer | string;
    pubkeys: Array<Buffer | string> | Buffer;
    sk: Buffer | string;
    purpose?: string;
    initiator?: boolean;
  }): object;
  export function createFromStart (
    body: object,
    opts: { sk: Buffer | string; signerXOnly: string }
  ): { ok: true; session: object } | { ok: false; reason: string };
  export function recordPubnonce (
    session: object,
    signerXOnly: string,
    pubnonce: Buffer | string
  ): { ok: boolean; reason?: string };
  export function allPubnoncesPresent (session: object): boolean;
  export function computeAggNonce (session: object): Buffer | null;
  export function setAggNonce (
    session: object,
    claimed: Buffer | string
  ): { ok: boolean; reason?: string; aggnonce?: Buffer };
  export function createPartial (
    session: object,
    sk: Buffer | string
  ): { ok: true; psig: Buffer } | { ok: false; reason: string };
  export function recordPartial (
    session: object,
    signerXOnly: string,
    psig: Buffer | string
  ): { ok: boolean; reason?: string };
  export function allPartialsPresent (session: object): boolean;
  export function aggregatePartials (
    session: object
  ): { ok: true; signature: Buffer } | { ok: false; reason: string };
  export function verifyFinalSignature (
    session: object,
    signature: Buffer | string
  ): { ok: boolean; reason?: string };
  export function wipeSession (session: object): void;
  export function sessionPublicView (session: object): object | null;
  export function startFields (session: object): object;
}
