export class CliDocumentExchange {
  constructor (settings?: Record<string, unknown>);
  [key: string]: unknown;
}

export const DocumentOfferBook: unknown;
export function createDocumentPurchaseSession (...args: unknown[]): unknown;
export function findSession (...args: unknown[]): unknown;
export function isDuplicateSettlement (...args: unknown[]): boolean;
export function rememberSettlement (...args: unknown[]): unknown;
export function listRefundCandidates (...args: unknown[]): unknown[];
export const DOCUMENT_EXCHANGE_CLI_PACKS: readonly string[];
export function listDocumentExchangeCliContracts (): unknown[];
export function listDocumentExchangeCommands (): string[];
