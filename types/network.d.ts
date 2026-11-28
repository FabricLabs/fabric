import type { Buffer } from 'buffer';

export interface GossipTypeRow {
  name: string;
  opcode: number;
  policy: string;
  role: string;
  aliases: ReadonlyArray<string>;
}

export const GOSSIP_NETWORK_TYPES: ReadonlyArray<GossipTypeRow>;
export const RELAY_AS_IS_TYPES: ReadonlySet<string>;
export const RELAY_AS_IS_NUMERIC: ReadonlySet<number>;
export const FIRST_CLASS_OPCODE_ONLY_TYPES: ReadonlySet<string>;

export function lookupGossipType (type: string | number | null | undefined): GossipTypeRow | null;
export function classifyGossipWireType (type: string | number | null | undefined): string;
export function isPublicGossipFloodType (type: string | number | null | undefined): boolean;
export function isRelayAsIsWireType (type: string | number | null | undefined): boolean;
export function isFirstClassOpcodeOnlyType (type: string | null | undefined): boolean;
export function listPublicGossipFloodNames (): string[];
export function validateGossipFrame (
  buffer: Buffer | Uint8Array,
  opts?: { maxBodySize?: number }
): {
  ok: boolean;
  type?: string;
  policy?: string;
  flood?: boolean;
  signerPubkeyHex?: string;
  error?: string;
};
export function gossipRelayPeerSettings (overrides?: object): object;

/** CommonJS export is this constructor. The catalog is also copied onto it. */
export declare class Network {
  constructor (settings?: Record<string, unknown>);
  static GOSSIP_NETWORK_TYPES: ReadonlyArray<GossipTypeRow>;
  static RELAY_AS_IS_TYPES: ReadonlySet<string>;
  static RELAY_AS_IS_NUMERIC: ReadonlySet<number>;
  static FIRST_CLASS_OPCODE_ONLY_TYPES: ReadonlySet<string>;
  static lookupGossipType: typeof lookupGossipType;
  static classifyGossipWireType: typeof classifyGossipWireType;
  static isPublicGossipFloodType: typeof isPublicGossipFloodType;
  static isRelayAsIsWireType: typeof isRelayAsIsWireType;
  static isFirstClassOpcodeOnlyType: typeof isFirstClassOpcodeOnlyType;
  static listPublicGossipFloodNames: typeof listPublicGossipFloodNames;
  static validateGossipFrame: typeof validateGossipFrame;
  static gossipRelayPeerSettings: typeof gossipRelayPeerSettings;
}
