declare class Machine {
  constructor (settings?: Record<string, unknown>);
  define (name: string, op: (...args: unknown[]) => unknown, definition?: Record<string, unknown>): unknown;
  loadProgram (program: unknown, opts?: { trusted?: boolean }): Machine;
  runProgram (program: unknown, input?: unknown, opts?: {
    trusted?: boolean;
    isolate?: boolean;
    maxSteps?: number;
    maxStack?: number;
    maxDepth?: number;
    maxTrace?: number;
  }): Promise<{
    ok: boolean;
    stack?: unknown[];
    tip?: unknown;
    runCommitmentHex?: string | null;
    error?: string;
    [key: string]: unknown;
  }>;
  parseManifest (raw: unknown, program?: unknown): { ok: boolean; error?: string; manifest?: unknown };
  [key: string]: unknown;
}

export = Machine;
