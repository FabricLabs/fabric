# Fabric CLI (terminal)
The Fabric TUI (`types/cli.js`) is a slash-command shell over a local Fabric peer,
optional Bitcoin/Lightning services, and contract-driven workflows (document
exchange, HTLCs, programs, …).

## Contracts (universal)
In Fabric, **contracts** means *all* agreements beyond the base peer protocol.
Contracts advertise **interfaces** (capabilities) — they are not tagged with a
single exclusive `kind`. Published contracts for the public network live in the
**Hub registry**; the **Hub contract is published first**. Canonical model:
**[CONTRACTS.md](CONTRACTS.md)**.

```text
/contracts                 # overview: sessions + shell packs + runtime
/contracts interfaces      # capability surfaces
/contracts sessions        # document-exchange / HTLC purchase sessions
/contracts shell           # local cli.shell packs
/contracts enable <id>
/contracts disable <id>
/contracts runtime
```

### Shell packs (`cli.shell` interface)
Composable CLI surfaces live in [`functions/cliContracts.js`](../functions/cliContracts.js)
(`@type: FabricCliContract`, `interfaces: ['cli.shell', …]`). Disabling a pack
only drops slash-commands; it does not cancel HTLCs, open sessions, or Hub
registry publishes.

**Document exchange** (`documents` + `documents-market`) is the Core-standard
operator surface: headless API in
[`functions/documentExchange.js`](../functions/documentExchange.js) /
[`functions/cliDocumentExchange.js`](../functions/cliDocumentExchange.js);
the Blessed TUI in `types/cli.js` only adapts results into the log. See
[`L1_DOCUMENT_EXCHANGE.md`](L1_DOCUMENT_EXCHANGE.md).

| Pack | Default | Role |
|------|---------|------|
| `core` | on (required) | help, quit, settings, `/contracts` |
| `network` | on | peers, connect, disconnect, services |
| `documents` | on | import/publish/request/approve/inventory |
| `documents-market` | on | offers, buy, confirm, claimwatch, **refunds**, refund, relayfees |
| `wallet` | on | wallet / fund / generate |
| `execution` | on | create, deploy, subscribe, accept, state |
| `bitcoin` | on | bitcoin / lightning / sync |
| `explorer` | on | block / tx / address |
| `debug` | **off** | RPC / UI diagnostics |

Settings:

```js
{
  cliContracts: { explorer: false, debug: true },
  cliContractsDisabled: ['wallet']
}
```

Legacy `applications` / `applicationsDisabled` keys are still honored.

## Refunds
```text
/refunds                   # outstanding = mature + failed + pending
/refunds mature
/refunds failed
/refunds pending
/refunds refunded
/refunds all
/refund <settlementId> [addr] [feeSats]
```

See [L1_DOCUMENT_EXCHANGE.md](L1_DOCUMENT_EXCHANGE.md).

## Verbosity (release defaults)
| Setting | Default | Effect |
|---------|---------|--------|
| `debug` | `false` | Peer/CLI debug lines; wallet tx chatter |
| `verbosity` | `1` | `≥3` shows bitcoin sync/log; `≥4` forces `_appendDebug` |

## Related
- [CONTRACTS.md](CONTRACTS.md)
- [PAYMENTS_DOCUMENT_BINDING.md](PAYMENTS_DOCUMENT_BINDING.md)
- [DEVELOPERS.md](../DEVELOPERS.md)
