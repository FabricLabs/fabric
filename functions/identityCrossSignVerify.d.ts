declare const identityCrossSignVerify: {
  signCrossSign: (identity: object, fields: object, kind?: string) => object;
  verifyCrossSignObject: (
    object: object,
    signerPubkey?: string
  ) => { ok: true; kind: string; record: object } | { ok: false; error: string };
  pubkeysMatch: (a: string, b: string) => boolean;
};

export = identityCrossSignVerify;
