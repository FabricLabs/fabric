declare const identityCrossSignVerify: {
  signCrossSign: (...args: unknown[]) => object;
  verifyCrossSignObject: (...args: unknown[]) => object;
  pubkeysMatch: (a: unknown, b: unknown) => boolean;
  [key: string]: unknown;
};

export = identityCrossSignVerify;
