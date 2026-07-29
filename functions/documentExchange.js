'use strict';

/**
 * Public catalog for Fabric **CLI document exchange** (L1 inventory HTLC +
 * DocumentOffer book + purchase sessions).
 *
 * Prefer this module (or `cliDocumentExchange`) over ad-hoc Peer/Wallet wiring
 * when adding operator tooling. Hub HTTP 402 and Beacon sidechain reward
 * "DocumentOffer" rows are **not** this surface — see docs for naming.
 *
 * @module functions/documentExchange
 * @see docs/L1_DOCUMENT_EXCHANGE.md
 * @see docs/FABRIC_DOCUMENT_OFFER.md
 */

const {
  CliDocumentExchange,
  DocumentOfferBook,
  createDocumentPurchaseSession,
  findSession,
  isDuplicateSettlement,
  rememberSettlement,
  listRefundCandidates
} = require('./cliDocumentExchange');

const { findCliContract } = require('./cliContracts');

/** Shell packs that implement document exchange in the Fabric CLI. */
const DOCUMENT_EXCHANGE_CLI_PACKS = Object.freeze(['documents', 'documents-market']);

/**
 * @returns {Array<object>} Catalog descriptors for document-exchange shell packs.
 */
function listDocumentExchangeCliContracts () {
  return DOCUMENT_EXCHANGE_CLI_PACKS
    .map((id) => findCliContract(id))
    .filter(Boolean);
}

/**
 * Slash-command names owned by document-exchange shell packs.
 * @returns {string[]}
 */
function listDocumentExchangeCommands () {
  const out = [];
  for (const pack of listDocumentExchangeCliContracts()) {
    for (const cmd of Object.keys(pack.commands || {})) {
      out.push(cmd);
    }
  }
  return out;
}

module.exports = {
  CliDocumentExchange,
  DocumentOfferBook,
  createDocumentPurchaseSession,
  findSession,
  isDuplicateSettlement,
  rememberSettlement,
  listRefundCandidates,
  DOCUMENT_EXCHANGE_CLI_PACKS,
  listDocumentExchangeCliContracts,
  listDocumentExchangeCommands
};
