type Bytes = Buffer | Uint8Array | string;

interface HtlcSettings {
  network?: string;
  claimPubkey: Bytes;
  refundPubkey: Bytes;
  paymentHash: Bytes;
  refundLocktime: number;
}

type HtlcOfferVerdict =
  | { ok: true; htlc: Htlc }
  | { ok: false; error: string; expectedAddress?: string; htlc?: Htlc };

interface HtlcSpend {
  txHex: string;
  txid: string;
}

interface HtlcPreimageResult {
  ok: boolean;
  preimage32?: Buffer;
  preimageHex?: string;
  vin?: number;
  error?: string;
}

declare class Htlc {
  constructor (settings: HtlcSettings);
  networkName: string;
  network: unknown;
  address: string;
  output: Buffer;
  claimScript: Buffer;
  refundScript: Buffer;
  paymentHash: Buffer;
  readonly paymentHashHex: string;
  refundLocktime: number;
  claimPubkeyHex: string;
  refundPubkeyHex: string;
  merkleRootHex: string | null;
  controlBlock (leaf: 'claim' | 'refund'): Buffer;
  findVout (tx: unknown): number;
  fundingHints (opts?: { amountSats?: number, label?: string }): { amountBtc: string, bitcoinUri: string, label?: string };
  prepareClaim (opts: Record<string, unknown>): Record<string, unknown>;
  prepareRefund (opts: Record<string, unknown>): Record<string, unknown>;
  toJSON (): Record<string, unknown>;

  static DUST_SATS: number;
  static signerFromPriv32 (priv32: Bytes): unknown;
  static randomPreimage (): Buffer;
  static sha256 (buf: Buffer): Buffer;
  static toXOnly (pk: Bytes | null | undefined): string | null;
  static pubkeysMatchXOnly (a: Bytes | null | undefined, b: Bytes | null | undefined): boolean;
  static findVout (tx: unknown, paymentAddress: string, network: unknown): number;
  static controlBlockFor (claimScript: Bytes, refundScript: Bytes, leafScript: Bytes): Buffer;
  static fundingHints (opts: { paymentAddress: string, amountSats: number, label?: string }): { amountBtc: string, bitcoinUri: string, label?: string };
  static prepareClaimPsbt (opts: Record<string, unknown>): Record<string, unknown>;
  static signClaim (bundle: Record<string, unknown>, priv32: Bytes): HtlcSpend;
  static prepareRefundPsbt (opts: Record<string, unknown>): Record<string, unknown>;
  static signRefund (bundle: Record<string, unknown>, priv32: Bytes): HtlcSpend;
  static extractPreimageFromWitness (witness: Bytes[] | undefined, paymentHash32: Bytes): Buffer | null;
  static extractPreimage (txHexOrTx: unknown, paymentHashHex: Bytes): HtlcPreimageResult;
  static refundMature (tipHeight: number, refundLocktimeHeight: number): boolean;
  static validateOffer (opts: HtlcSettings & { paymentAddress?: string }): HtlcOfferVerdict;
}

export = Htlc;
