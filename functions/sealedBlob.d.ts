declare const sealedBlob: {
  SEAL_SCHEME: string;
  sealJson: (...args: unknown[]) => unknown;
  openSealedJson: (...args: unknown[]) => unknown;
  isPasswordProtectedDocument: (...args: unknown[]) => boolean;
  [key: string]: unknown;
};

export = sealedBlob;
