declare const cliPasswordArgv: {
  readCliPasswordFromArgv: (argv: unknown, env?: unknown) => string;
  [key: string]: unknown;
};

export = cliPasswordArgv;
