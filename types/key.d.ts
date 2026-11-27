interface FabricAccountKeys {
  readonly ARGON2_MASTER: boolean;
  readonly ACCOUNT_NETWORKS: readonly string[];
  readonly ACCOUNT_VAULT_TYPE: string;
  readonly ACCOUNT_VAULT_VERSION: number;
  readonly WALLET_GAP_LIMIT: number;
  normalizeAccountNetwork (network: string): string;
  extendedKeyForNetwork (base58: string, network: string): string;
  shareableAccountXpub (base58: string, network: string): string;
  generateMnemonic (strength?: number): string;
  importSeed (mnemonic: string, passphrase?: string): string;
  normalizeMasterXprv (master: unknown): string;
  deriveAccount (master: unknown, options?: Record<string, unknown>): Record<string, unknown>;
  walletDescriptors (wallet: Record<string, unknown>): Record<string, unknown>;
  walletAddress (params?: Record<string, unknown>): string;
  walletReceiveAddress (wallet: Record<string, unknown>, network: string, index?: number): string;
  walletChangeAddress (wallet: Record<string, unknown>, network: string, index?: number): string;
  cosignerProof (cosignerKey: unknown, params?: Record<string, unknown>): string;
  verifyCosignerProof (params?: Record<string, unknown>): boolean;
  sealMaster (master: unknown, lockPassword: string): Record<string, unknown>;
  unsealMaster (blob: Record<string, unknown>, lockPassword: string): string;
  accountPublicView (derived: Record<string, unknown>, label?: string): Record<string, unknown>;
  vaultAccountKey (account: number, network: string): string;
  createAccountVault (params?: Record<string, unknown>): Record<string, unknown>;
  checkCachedAccount (key: string, cached: Record<string, unknown>, master: unknown): Record<string, unknown>;
  verifyVaultAccounts (vault: Record<string, unknown>, master: unknown): Record<string, unknown>;
  openAccountVault (vault: Record<string, unknown>, lockPassword: string): string;
  selectVaultAccount (vault: Record<string, unknown>, params?: Record<string, unknown>): Record<string, unknown>;
  currentVaultAccount (vault: Record<string, unknown>, master?: unknown): Record<string, unknown> | null;
}

interface FabricOperatorKeys {
  exclusiveOperatorKeySettings (bag?: Record<string, unknown>): Record<string, unknown> | null;
  resolveFabricOperatorKeySettings (env?: Record<string, string | undefined>, opts?: Record<string, unknown>): { source: string; key: Record<string, unknown> } | null;
}

declare class Key {
  constructor (settings?: Record<string, unknown>);
  static readonly Accounts: FabricAccountKeys;
  static readonly Operator: FabricOperatorKeys;
  static normalizeAccountNetwork: FabricAccountKeys['normalizeAccountNetwork'];
  static deriveAccount: FabricAccountKeys['deriveAccount'];
  static importSeed: FabricAccountKeys['importSeed'];
  static generateMnemonic: FabricAccountKeys['generateMnemonic'];
  static exclusiveOperatorKeySettings: FabricOperatorKeys['exclusiveOperatorKeySettings'];
  static resolveFabricOperatorKeySettings: FabricOperatorKeys['resolveFabricOperatorKeySettings'];
  [key: string]: unknown;
}

export = Key;
