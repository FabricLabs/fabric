declare const sealedBlob: {
  SEAL_SCHEME: string;
  SEAL_TYPE: string;
  SEAL_VERSION: number;
  DEFAULT_ITERATIONS: number;
  PASSWORD_MIN_LENGTH: number;
  sealJson: (...args: unknown[]) => unknown;
  openSealedJson: (...args: unknown[]) => unknown;
  extractEnvelope: (...args: unknown[]) => unknown;
  isSealedEnvelope: (...args: unknown[]) => boolean;
  isPasswordProtectedDocument: (...args: unknown[]) => boolean;
  [key: string]: unknown;
};

export = sealedBlob;
