declare const fabricIdentitySchnorr: {
  fabricIdentityIdFromPubkeyHex: (pubkeyHex: string) => string;
  resolveFabricSigningIdentity: (input: unknown) => object;
  buildFabricIdentitySignedPayload: (input: unknown, message: string) => object;
  verifyIdentitySchnorr: (...args: unknown[]) => object;
  [key: string]: unknown;
};

export = fabricIdentitySchnorr;
