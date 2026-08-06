declare const sidechainState: {
  SIDECHAIN_STATE_PATH: string;
  SIDECHAIN_SNAPSHOTS_PATH: string;
  SIDECHAIN_JOURNAL_PATH: string;
  createInitialState: (...args: unknown[]) => unknown;
  stateDigest: (...args: unknown[]) => string;
  applyPatchesToState: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

export = sidechainState;
