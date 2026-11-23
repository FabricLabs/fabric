interface ExecutionRun {
  programHash: string;
  runCommitmentHex: string;
  contractId?: string | null;
}

declare class Program {
  constructor (settings?: Record<string, unknown>);
  static from (input?: Record<string, unknown>): Program;
  static readonly EXECUTION_RUN_SIGNING_KIND: string;
  static signingStringForExecutionRun (run: ExecutionRun): string;
  static executionRunCommitmentDigestHex (run: ExecutionRun): string;
  static buildFederationWitnessForExecutionRun (opts: ExecutionRun & { signKey: unknown; validators?: string[]; threshold?: number }): Record<string, unknown> | null;
  static verifyExecutionRunFederationWitness (run: ExecutionRun, federationWitness: unknown, validators: string[], threshold: number): boolean;
  compile (): { ok: boolean; error?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export = Program;
