type CrossSignKind = 'IdentityCrossSign' | 'IdentityCrossSignRevoke';

interface CrossSignRecord {
  type: CrossSignKind;
  '@type': CrossSignKind;
  localPubkey: string;
  peerPubkey: string;
  nonce: string;
  createdAt: string;
  signature: string | null;
  pubkeyHex: string | null;
  identity: object | null;
}

declare const identityCrossSignVerify: {
  signCrossSign: (
    identity: object,
    fields: { peerPubkey: string; nonce: string; createdAt?: string },
    kind?: CrossSignKind
  ) => CrossSignRecord;
  verifyCrossSignObject: (
    object: object,
    signerPubkey?: string
  ) => { ok: true; kind: CrossSignKind; record: CrossSignRecord } | { ok: false; error: string };
  pubkeysMatch: (a: string, b: string) => boolean;
};

export = identityCrossSignVerify;
