declare class Program {
  constructor (settings?: Record<string, unknown>);
  static from (input?: Record<string, unknown>): Program;
  compile (): { ok: boolean; error?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export = Program;
