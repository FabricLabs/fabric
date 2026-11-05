'use strict';

/**
 * CLI **shell packs** — local contracts that implement the `cli.shell` interface.
 *
 * In Fabric, **contracts** means *all* agreements beyond the base peer protocol.
 * A contract is not tagged with a single `kind`; it advertises **interfaces**
 * (capabilities). Hub-registry published contracts (Hub first on the public
 * network) are the durable set; these packs are local TUI surfaces. See
 * `docs/CONTRACTS.md`.
 *
 * Each pack maps slash-commands → CLI handlers and can be enabled/disabled
 * without removing code (`/contracts enable|disable <id>`). Defaults match the
 * full TUI; `debug` is off for release.
 */

/**
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.title
 * @param {string} [spec.description]
 * @param {boolean} [spec.defaultEnabled=true]
 * @param {boolean} [spec.required=false] when true, cannot be disabled
 * @param {string[]} [spec.interfaces] extra interfaces beyond `cli.shell`
 * @param {Object.<string, string>} spec.commands command → method name on CLI
 * @returns {Readonly<object>}
 */
function defineContract (spec = {}) {
  if (!spec.id || typeof spec.id !== 'string') throw new Error('contract id is required');
  if (!spec.title || typeof spec.title !== 'string') throw new Error('contract title is required');
  if (!spec.commands || typeof spec.commands !== 'object') {
    throw new Error('contract commands map is required');
  }
  const extra = Array.isArray(spec.interfaces) ? spec.interfaces.map(String) : [];
  const interfaces = Object.freeze(['cli.shell'].concat(extra.filter((x) => x !== 'cli.shell')));
  return Object.freeze({
    id: String(spec.id),
    title: String(spec.title),
    description: String(spec.description || ''),
    defaultEnabled: spec.defaultEnabled !== false,
    required: spec.required === true,
    commands: Object.freeze(Object.assign({}, spec.commands)),
    interfaces,
    '@type': 'FabricCliContract'
  });
}

/** @deprecated use {@link defineContract} */
const defineApplication = defineContract;

/** Built-in CLI contract catalog (order = `/contracts` listing). */
const CLI_CONTRACTS = Object.freeze([
  defineContract({
    id: 'core',
    title: 'Core',
    description: 'Shell essentials + contract surface management (always on)',
    required: true,
    commands: {
      help: '_handleHelpRequest',
      quit: '_handleQuitRequest',
      exit: '_handleQuitRequest',
      clear: '_handleClearRequest',
      flush: '_handleFlushRequest',
      alias: '_handleAliasRequest',
      settings: '_handleSettingsRequest',
      set: '_handleSetRequest',
      get: '_handleGetRequest',
      identity: '_handleIdentityRequest',
      unlock: '_handleUnlockRequest',
      lock: '_handleLockRequest',
      contracts: '_handleContractsCommand'
    }
  }),
  defineContract({
    id: 'network',
    title: 'Network',
    description: 'Peers, connect/disconnect, service status',
    commands: {
      peers: '_handlePeerListRequest',
      rotate: '_handleRotateRequest',
      connect: '_handleConnectRequest',
      disconnect: '_handleDisconnectRequest',
      service: '_handleServiceCommand',
      channels: '_handleChannelRequest',
      join: '_handleJoinRequest'
    }
  }),
  defineContract({
    id: 'documents',
    title: 'Documents',
    description: 'Local library, consent file path, inventory catalog',
    commands: {
      import: '_handleImportCommand',
      publish: '_handlePublishCommand',
      request: '_handleRequestCommand',
      approve: '_handleApproveCommand',
      deny: '_handleDenyCommand',
      send: '_handleSendDocumentCommand',
      pending: '_handlePendingDocumentRequests',
      inventory: '_handleInventoryRequest',
      grant: '_handleGrantCommand'
    }
  }),
  defineContract({
    id: 'documents-market',
    title: 'Document Market',
    description: 'L1 offers, buy/confirm, claim watch, refunds, relay fees',
    interfaces: ['document-exchange', 'payment/escrow'],
    commands: {
      offers: '_handleOffersCommand',
      buy: '_handleBuyCommand',
      confirm: '_handleConfirmCommand',
      claimwatch: '_handleClaimWatchCommand',
      refund: '_handleRefundCommand',
      refunds: '_handleRefundsCommand',
      relayfees: '_handleRelayFeesCommand'
    }
  }),
  defineContract({
    id: 'wallet',
    title: 'Wallet',
    description: 'Wallet and funding',
    commands: {
      wallet: '_handleWalletCommand',
      fund: '_handleFundRequest',
      generate: '_handleGenerateRequest'
    }
  }),
  defineContract({
    id: 'execution',
    title: 'Contract Execution',
    description: 'Create, deploy, subscribe, accept — runtime contract ops',
    interfaces: ['program'],
    commands: {
      subscribe: '_handleSubscribeRequest',
      create: '_handleCreateRequest',
      deploy: '_handleDeployRequest',
      accept: '_handleAcceptRequest',
      state: '_handleStateRequest'
    }
  }),
  defineContract({
    id: 'bitcoin',
    title: 'Bitcoin',
    description: 'Bitcoin / Lightning service commands and chain sync',
    commands: {
      bitcoin: '_handleBitcoinRequest',
      lightning: '_handleLightningRequest',
      sync: '_handleChainSyncRequest',
      flushchain: '_handleFlushChainCli'
    }
  }),
  defineContract({
    id: 'explorer',
    title: 'Explorer',
    description: 'Block / tx / address explorer',
    commands: {
      block: '_handleBlockExplorerRequest',
      tx: '_handleTxExplorerRequest',
      address: '_handleAddressExplorerRequest',
      explorer: '_handleExplorerHelpRequest'
    }
  }),
  defineContract({
    id: 'debug',
    title: 'Debug',
    description: 'Developer diagnostics (quiet by default for release)',
    defaultEnabled: false,
    commands: {
      syncui: '_handleSyncUIRequest',
      listelements: '_handleListElementsRequest',
      testrpc: '_handleTestRPCRequest',
      createwallet: '_handleCreateWalletRequest',
      loadwallet: '_handleLoadWalletRequest',
      listwallets: '_handleListWalletsRequest',
      bitcoinhelp: '_handleBitcoinHelpRequest'
    }
  })
]);

/** @deprecated alias for {@link CLI_CONTRACTS} */
const APPLICATIONS = CLI_CONTRACTS;

/**
 * Resolve enabled flags from settings.
 *
 * Precedence:
 * 1. `defaultEnabled` / `required`
 * 2. `settings.cliContractsDisabled` (or legacy `applicationsDisabled`)
 * 3. `settings.cliContracts[id]` (or legacy `applications[id]`) boolean overrides
 *
 * @param {object} [settings]
 * @returns {Array<object>} contracts with `enabled` boolean
 */
function resolveEnabledContracts (settings = {}) {
  const disabled = new Set();
  const list = settings.cliContractsDisabled ||
    settings.contractsDisabled ||
    settings.applicationsDisabled ||
    settings.disabledApplications ||
    [];
  if (Array.isArray(list)) {
    for (const id of list) disabled.add(String(id));
  }
  const overrides = (settings.cliContracts && typeof settings.cliContracts === 'object')
    ? settings.cliContracts
    : ((settings.applications && typeof settings.applications === 'object')
      ? settings.applications
      : {});

  return CLI_CONTRACTS.map((contract) => {
    let enabled = contract.defaultEnabled;
    if (disabled.has(contract.id)) enabled = false;
    if (Object.prototype.hasOwnProperty.call(overrides, contract.id)) {
      enabled = !!overrides[contract.id];
    }
    if (contract.required) enabled = true;
    return Object.assign({}, contract, { enabled });
  });
}

/** @deprecated use {@link resolveEnabledContracts} */
const resolveEnabledApplications = resolveEnabledContracts;

/**
 * @param {string} id
 * @returns {object|null}
 */
function findCliContract (id) {
  const key = String(id || '').trim();
  return CLI_CONTRACTS.find((c) => c.id === key) || null;
}

/** @deprecated use {@link findCliContract} */
const findApplication = findCliContract;

module.exports = {
  defineContract,
  defineApplication,
  CLI_CONTRACTS,
  APPLICATIONS,
  resolveEnabledContracts,
  resolveEnabledApplications,
  findCliContract,
  findApplication
};
