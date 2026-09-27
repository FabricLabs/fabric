type IdentityLockOptions = {
  timeoutMinutes?: number;
  timeoutMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

type IdentityLockSnapshot = {
  locked: boolean;
  timeoutMinutes: number;
  unlockedAt: number;
  remainingMs: number | null;
};

interface IdentityLockInstance {
  readonly locked: boolean;
  readonly timeoutMinutes: number;
  readonly timeoutMs: number;
  snapshot(): IdentityLockSnapshot;
  unlock(payload: unknown): IdentityLockInstance;
  lock(): IdentityLockInstance;
  touch(): IdentityLockInstance;
  peek(): unknown;
  setTimeoutMinutes(minutes: number): IdentityLockInstance;
}

declare const identityLock: {
  DEFAULT_LOCK_TIMEOUT_MINUTES: number;
  MIN_LOCK_TIMEOUT_MINUTES: number;
  MAX_LOCK_TIMEOUT_MINUTES: number;
  IdentityLock: new (opts?: IdentityLockOptions) => IdentityLockInstance;
  clampLockTimeoutMinutes: (minutes: unknown) => number;
  lockTimeoutMinutesToMs: (minutes: unknown) => number;
  [key: string]: unknown;
};

export = identityLock;
