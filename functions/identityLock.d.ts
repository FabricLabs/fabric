declare const identityLock: {
  DEFAULT_LOCK_TIMEOUT_MINUTES: number;
  IdentityLock: new (...args: unknown[]) => unknown;
  clampLockTimeoutMinutes: (minutes: unknown) => number;
  lockTimeoutMinutesToMs: (minutes: unknown) => number;
  [key: string]: unknown;
};

export = identityLock;
