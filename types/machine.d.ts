declare class Machine {
  constructor (settings?: Record<string, unknown>);
  define (name: string, op: (...args: unknown[]) => unknown, definition?: Record<string, unknown>): unknown;
  loadProgram (program: unknown, opts?: { trusted?: boolean; genesis?: Record<string, unknown> }): Machine;
  runProgram (program: unknown, input?: unknown, opts?: {
    trusted?: boolean;
    genesis?: Record<string, unknown>;
    isolate?: boolean;
    inProcess?: boolean;
    workerUrl?: string;
    isolateTimeoutMs?: number;
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
