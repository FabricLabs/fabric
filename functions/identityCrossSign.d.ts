declare const identityCrossSign: {
  CROSS_SIGN_PREFIX: string;
  REVOKE_PREFIX: string;
  SIGN_TYPE: string;
  REVOKE_TYPE: string;
  buildCrossSignMessage: (...args: unknown[]) => string | null;
  buildRevokeMessage: (...args: unknown[]) => string | null;
  parseCrossSignMessage: (...args: unknown[]) => object | null;
  parseRevokeMessage: (...args: unknown[]) => object | null;
  buildCrossSignObject: (...args: unknown[]) => object;
  buildRevokeObject: (...args: unknown[]) => object;
  isCrossSignType: (type: unknown) => boolean;
  [key: string]: unknown;
};

export = identityCrossSign;
