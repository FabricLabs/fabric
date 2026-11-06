type HeaderField = 'magic' | 'version' | 'parent' | 'author' | 'type' | 'size' | 'hash' | 'preimage' | 'signature';

interface FrameAuthorResult {
  ok: boolean;
  reason?: string;
  author?: string;
  type?: number;
  body?: Buffer;
  hash?: string;
  parent?: string;
}

type LegacyBodyParse =
  | { ok: true; value: Record<string, unknown>; encoding: 'json' | 'fields' }
  | { ok: false; error: Error };

declare class Message {
  constructor (settings?: Record<string, unknown>);
  static fromVector (vector: unknown[]): Message;
  static fromBuffer (buffer: Buffer | Uint8Array): Message;

  static readonly HEADER_OFFSETS: Readonly<Record<HeaderField, readonly [number, number]>>;
  static readonly ZERO_PARENT: string;
  static isZeroParent (value: unknown): boolean;
  static normalizeParent (value: unknown): string;
  static parentHexOf (message?: unknown): string;
  static frameIdOf (messageOrBuffer: unknown): string | null;
  static setMessageParent<T> (message: T, parent: unknown): T;
  static padDigits (number: number | string, digits: number): string;
  static verifyFrameAuthor (frame: Buffer | string): FrameAuthorResult;

  static readonly LEGACY_BODY_TYPES: readonly string[];
  static encodeLegacyBody (type: string | number, body: Record<string, unknown>): Record<string, unknown>;
  static decodeLegacyBody (type: string | number, fields: Record<string, unknown>): Record<string, unknown> | null;
  static fromLegacyBody (type: string | number, body: Record<string, unknown>, opts?: Record<string, unknown>): Message;
  static tryParseLegacyBody (message: Message): LegacyBodyParse;
  static canonicalPeeringObject (obj: Record<string, unknown>, omit?: string[]): Record<string, unknown>;

  signWithKey (key: unknown): Message;
  toBuffer (): Buffer;
  [key: string]: unknown;
}

export = Message;
