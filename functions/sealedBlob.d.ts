type SealOptions = {
  iterations?: number;
  type?: string;
  version?: number;
};

type SealedEnvelope = {
  type?: string;
  version?: number;
  encryption?: string;
  format?: string;
  kdf: {
    name?: string;
    hash?: string;
    iterations?: number;
    salt?: string;
    [key: string]: unknown;
  };
  iv?: string;
  nonce?: string;
  ciphertext: string;
  [key: string]: unknown;
};

type CreatedSealedEnvelope = SealedEnvelope & {
  type: string;
  version: number;
  encryption: string;
  iv: string;
  kdf: SealedEnvelope['kdf'] & {
    name: string;
    hash: string;
    iterations: number;
    salt: string;
  };
};

declare const sealedBlob: {
  SEAL_SCHEME: string;
  SEAL_TYPE: string;
  SEAL_VERSION: number;
  DEFAULT_ITERATIONS: number;
  PASSWORD_MIN_LENGTH: number;
  sealJson: (plaintext: unknown, password: string, opts?: SealOptions) => CreatedSealedEnvelope;
  openSealedJson: (document: object, password: string) => unknown;
  extractEnvelope: (obj: unknown) => SealedEnvelope | null;
  isSealedEnvelope: (obj: unknown) => boolean;
  isPasswordProtectedDocument: (parsed: unknown) => boolean;
  [key: string]: unknown;
};

export = sealedBlob;
