declare const fabricIdentitySchnorr: {
  fabricIdentityIdFromPubkeyHex: (pubkeyHex: string) => string;
  resolveFabricSigningIdentity: (input: unknown) => {
    fabricKey: object;
    identityId: string;
    identity: object;
  };
  buildFabricIdentitySignedPayload: (input: unknown, message: string) => {
    signature: string;
    pubkeyHex: string;
    identity: { id: string; xpub: string };
  };
  verifyIdentitySchnorr: (
    message: string,
    signatureHex: string,
    pubkeyHex: string,
    identity: { id?: unknown; xpub: string }
  ) => { ok: true; key: object; identityId: string } | { ok: false; error: string };
};

export = fabricIdentitySchnorr;
