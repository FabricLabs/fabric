declare class Message {
  constructor (settings?: Record<string, unknown>);
  static fromVector (vector: unknown[]): Message;
  static fromBuffer (buffer: Buffer | Uint8Array): Message;
  signWithKey (key: unknown): Message;
  toBuffer (): Buffer;
  [key: string]: unknown;
}

export = Message;
