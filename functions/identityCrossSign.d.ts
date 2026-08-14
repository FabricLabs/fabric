interface CrossSignRecordFields {
  localPubkey?: string;
  peerPubkey?: string;
  nonce?: string;
  createdAt?: string;
  signature?: string | null;
  pubkeyHex?: string | null;
  identity?: object | null;
}

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

declare const identityCrossSign: {
  CROSS_SIGN_PREFIX: string;
  REVOKE_PREFIX: string;
  SIGN_TYPE: 'IdentityCrossSign';
  REVOKE_TYPE: 'IdentityCrossSignRevoke';
  buildCrossSignMessage: (nonce: string, localPubkey: string, peerPubkey: string) => string | null;
  buildRevokeMessage: (nonce: string, localPubkey: string, peerPubkey: string) => string | null;
  parseCrossSignMessage: (msg: string) => {
    nonce: string;
    localPubkey: string;
    peerPubkey: string;
  } | null;
  parseRevokeMessage: (msg: string) => {
    nonce: string;
    localPubkey: string;
    peerPubkey: string;
  } | null;
  buildCrossSignObject: (fields?: CrossSignRecordFields) => CrossSignRecord & {
    type: 'IdentityCrossSign';
    '@type': 'IdentityCrossSign';
  };
  buildRevokeObject: (fields?: CrossSignRecordFields) => CrossSignRecord & {
    type: 'IdentityCrossSignRevoke';
    '@type': 'IdentityCrossSignRevoke';
  };
  isCrossSignType: (type: unknown) => boolean;
};

export = identityCrossSign;
