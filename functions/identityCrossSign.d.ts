declare const identityCrossSign: {
  CROSS_SIGN_PREFIX: string;
  REVOKE_PREFIX: string;
  SIGN_TYPE: string;
  REVOKE_TYPE: string;
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
  buildCrossSignObject: (fields?: object) => object;
  buildRevokeObject: (fields?: object) => object;
  isCrossSignType: (type: unknown) => boolean;
};

export = identityCrossSign;
